import { afterEach, describe, it, expect, vi } from "vitest";
import { createResumableStreamContext } from "../generic";
import { resumeStream } from "../runtime";
import type { Publisher, Subscriber } from "../types";
import { createInMemoryPubSubForTesting } from "../../testing-utils/in-memory-pubsub";
import { streamToBuffer, createTestingStream } from "../../testing-utils/testing-stream";

function createResumeStreamTestContext(
  get: Publisher["get"] = async () => "1",
  autoAcknowledge = true
) {
  let onMessage: ((message: string) => void) | undefined;
  const unsubscribe = vi.fn(async () => {});
  const subscriber: Subscriber = {
    connect: async () => {},
    subscribe: async (_channel, callback) => {
      onMessage = callback;
    },
    unsubscribe,
  };
  const publisher: Publisher = {
    connect: async () => {},
    publish: async () => {
      if (autoAcknowledge) {
        onMessage?.("");
      }
      return 1;
    },
    set: async () => "OK",
    get,
    incr: async () => 1,
  };

  return {
    ctx: {
      keyPrefix: "test-resume",
      waitUntil: () => {},
      subscriber,
      publisher,
      doneWatchdogIntervalMs: 10,
    } satisfies Parameters<typeof resumeStream>[0],
    unsubscribe,
    acknowledge: () => onMessage?.(""),
  };
}

describe("generic interface", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should subscribe before making a new stream resumable", async () => {
    const { publisher, subscriber } = createInMemoryPubSubForTesting();
    const operations: string[] = [];
    const ctx = createResumableStreamContext({
      waitUntil: null,
      publisher: {
        ...publisher,
        set: async (key, value, options) => {
          operations.push("set");
          return publisher.set(key, value, options);
        },
      },
      subscriber: {
        ...subscriber,
        subscribe: async (channel, callback) => {
          const result = await subscriber.subscribe(channel, callback);
          operations.push("subscribe");
          return result;
        },
      },
      keyPrefix: "test-subscribe-before-sentinel",
    });
    const { readable, writer } = createTestingStream();

    const stream = await ctx.createNewResumableStream("test-stream", () => readable);

    expect(operations).toEqual(["subscribe", "set"]);
    writer.close();
    await streamToBuffer(stream);
  });

  it("should work with custom publisher/subscriber implementations", async () => {
    const { publisher, subscriber } = createInMemoryPubSubForTesting();

    const ctx = createResumableStreamContext({
      waitUntil: null,
      publisher,
      subscriber,
      keyPrefix: "test-generic-" + crypto.randomUUID(),
    });

    const { readable, writer } = createTestingStream();
    const stream = await ctx.resumableStream("test-stream", () => readable);

    writer.write("Hello ");
    writer.write("World!");
    writer.close();

    expect(stream).not.toBeNull();
    const result = await streamToBuffer(stream!);
    expect(result).toBe("Hello World!");
  });

  it("should resume streams with custom implementations", async () => {
    const { publisher, subscriber } = createInMemoryPubSubForTesting();

    const ctx = createResumableStreamContext({
      waitUntil: null,
      publisher,
      subscriber,
      keyPrefix: "test-generic-" + crypto.randomUUID(),
    });

    const { readable, writer } = createTestingStream();
    // Create initial stream
    const stream1 = await ctx.resumableStream("test-stream-2", () => readable);

    // Resume the same stream immediately
    const stream2 = await ctx.resumableStream("test-stream-2", () => {
      throw new Error("Should not be called");
    });

    writer.write("Part 1 ");
    writer.write("Part 2");
    writer.close();

    expect(stream1).not.toBeNull();
    expect(stream2).not.toBeNull();

    const result1 = await streamToBuffer(stream1!);
    const result2 = await streamToBuffer(stream2!);
    expect(result1).toBe("Part 1 Part 2");
    expect(result2).toBe("Part 1 Part 2");
  });

  it("should return null if stream is done", async () => {
    const { publisher, subscriber } = createInMemoryPubSubForTesting();

    const ctx = createResumableStreamContext({
      waitUntil: null,
      publisher,
      subscriber,
      keyPrefix: "test-generic-" + crypto.randomUUID(),
    });

    const { readable, writer } = createTestingStream();
    const stream = await ctx.resumableStream("test-stream-3", () => readable);

    writer.write("Done");
    writer.close();

    await streamToBuffer(stream!);

    // Try to resume after stream is done
    const doneStream = await ctx.resumableStream("test-stream-3", () => {
      throw new Error("Should not be called");
    });

    expect(doneStream).toBeNull();
  });

  it(
    "closes resumed streams via the done watchdog when the DONE pub/sub message is lost",
    { timeout: 5000 },
    async () => {
      const { publisher, subscriber } = createInMemoryPubSubForTesting();

      // Pub/sub is fire-and-forget; simulate the DONE control message getting lost in transit
      // (e.g. subscriber reconnect) while durable writes (the sentinel SET) still go through.
      const lossyPublisher: typeof publisher = {
        ...publisher,
        publish: async (channel: string, message: string) => {
          if (message.includes("DONE_SENTINEL")) {
            return 0;
          }
          return publisher.publish(channel, message);
        },
      };

      const ctx = createResumableStreamContext({
        waitUntil: null,
        publisher: lossyPublisher,
        subscriber,
        keyPrefix: "test-generic-" + crypto.randomUUID(),
        doneWatchdogIntervalMs: 25,
      });

      const { readable, writer } = createTestingStream();
      const producerStream = await ctx.resumableStream("test-stream-watchdog", () => readable);
      const resumedStream = await ctx.resumableStream("test-stream-watchdog", () => {
        throw new Error("Should not be called");
      });

      writer.write("Hello ");
      writer.write("World!");
      writer.close();

      expect(await streamToBuffer(producerStream!)).toBe("Hello World!");
      // Without the watchdog this hangs forever: the consumer never receives the DONE message.
      expect(await streamToBuffer(resumedStream!)).toBe("Hello World!");
    }
  );

  it("cleans up the done watchdog when subscription setup fails", async () => {
    vi.useFakeTimers();
    const get = vi.fn(async () => "1");
    const { ctx, unsubscribe } = createResumeStreamTestContext(get);
    ctx.subscriber.subscribe = async () => {
      throw new Error("subscribe failed");
    };

    await expect(resumeStream(ctx, "failed-subscription")).rejects.toThrow("subscribe failed");
    await vi.advanceTimersByTimeAsync(1000);

    expect(get).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("cleans up the done watchdog when the resumed stream is cancelled", async () => {
    vi.useFakeTimers();
    const get = vi.fn(async () => "1");
    const { ctx, unsubscribe } = createResumeStreamTestContext(get);
    const stream = await resumeStream(ctx, "cancelled-stream");

    await stream!.cancel();
    await vi.advanceTimersByTimeAsync(1000);

    expect(get).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not start the done watchdog before the initial ack", async () => {
    vi.useFakeTimers();
    const get = vi.fn(async () => "1");
    const { ctx, acknowledge } = createResumeStreamTestContext(get, false);
    const streamPromise = resumeStream(ctx, "delayed-ack");

    await vi.advanceTimersByTimeAsync(100);
    expect(get).not.toHaveBeenCalled();

    acknowledge();
    const stream = await streamPromise;
    await stream!.cancel();
  });

  it("does not overlap done watchdog checks when Redis is slow", async () => {
    vi.useFakeTimers();
    let resolveGet: (value: string) => void;
    const get = vi.fn(() => {
      return new Promise<string>((resolve) => {
        resolveGet = resolve;
      });
    });
    const { ctx } = createResumeStreamTestContext(get);
    const stream = await resumeStream(ctx, "slow-redis");

    vi.advanceTimersByTime(10);
    expect(get).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(35);
    expect(get).toHaveBeenCalledOnce();

    resolveGet("1");
    await Promise.resolve();
    await stream!.cancel();
  });

  describe("publishing to resumed listeners", () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Wraps a publisher so that publishes to chunk channels take `delayMs(n)` for the n-th call,
    // and records how many publishes per channel are in flight at once.
    function createSlowPublisher(publisher: Publisher, delayMs: (n: number) => number) {
      let calls = 0;
      let maxInFlight = 0;
      const inFlight = new Map<string, number>();
      const slowPublisher: Publisher = {
        ...publisher,
        publish: async (channel, message) => {
          if (!channel.includes(":chunk:")) {
            return publisher.publish(channel, message);
          }
          const count = (inFlight.get(channel) ?? 0) + 1;
          inFlight.set(channel, count);
          maxInFlight = Math.max(maxInFlight, count);
          try {
            await sleep(delayMs(calls++));
            return await publisher.publish(channel, message);
          } finally {
            inFlight.set(channel, inFlight.get(channel)! - 1);
          }
        },
      };
      return { publisher: slowPublisher, maxInFlight: () => maxInFlight };
    }

    it("does not throttle reading the source by publish latency", async () => {
      const { publisher, subscriber } = createInMemoryPubSubForTesting();
      const slow = createSlowPublisher(publisher, () => 50);
      const ctx = createResumableStreamContext({
        waitUntil: null,
        publisher: slow.publisher,
        subscriber,
        keyPrefix: "test-generic-" + crypto.randomUUID(),
      });

      const { readable, writer } = createTestingStream();
      const producerStream = await ctx.resumableStream("test-slow-publish", () => readable);
      const resumedStream = await ctx.resumableStream("test-slow-publish", () => {
        throw new Error("Should not be called");
      });

      const parts = Array.from({ length: 20 }, (_, i) => `${i} `);
      const start = Date.now();
      for (const part of parts) {
        writer.write(part);
      }
      writer.close();

      expect(await streamToBuffer(producerStream!)).toBe(parts.join(""));
      // Awaiting a 50ms publish per chunk would take about a second.
      expect(Date.now() - start).toBeLessThan(250);
      expect(await streamToBuffer(resumedStream!)).toBe(parts.join(""));
    });

    it("keeps chunks in order when publishes complete out of order", async () => {
      const { publisher, subscriber } = createInMemoryPubSubForTesting();
      // Alternate slow and fast publishes, like concurrent HTTP requests that overtake each other.
      const slow = createSlowPublisher(publisher, (n) => (n % 2 === 0 ? 30 : 1));
      const ctx = createResumableStreamContext({
        waitUntil: null,
        publisher: slow.publisher,
        subscriber,
        keyPrefix: "test-generic-" + crypto.randomUUID(),
      });

      const { readable, writer } = createTestingStream();
      const producerStream = await ctx.resumableStream("test-ordering", () => readable);
      writer.write("buffered ");
      await sleep(5);
      const resumedStream = await ctx.resumableStream("test-ordering", () => {
        throw new Error("Should not be called");
      });

      const parts = Array.from({ length: 10 }, (_, i) => `${i} `);
      for (const part of parts) {
        writer.write(part);
        await sleep(5);
      }
      writer.close();

      const expected = "buffered " + parts.join("");
      expect(await streamToBuffer(producerStream!)).toBe(expected);
      expect(await streamToBuffer(resumedStream!)).toBe(expected);
      expect(slow.maxInFlight()).toBe(1);
    });

    it("contains publish errors and still finishes the stream", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { publisher, subscriber } = createInMemoryPubSubForTesting();
        const ctx = createResumableStreamContext({
          waitUntil: null,
          publisher: {
            ...publisher,
            publish: async (channel, message) => {
              if (message === "fail ") {
                throw new Error("publish failed");
              }
              return publisher.publish(channel, message);
            },
          },
          subscriber,
          keyPrefix: "test-generic-" + crypto.randomUUID(),
        });

        const { readable, writer } = createTestingStream();
        const producerStream = await ctx.resumableStream("test-publish-error", () => readable);
        const resumedStream = await ctx.resumableStream("test-publish-error", () => {
          throw new Error("Should not be called");
        });

        writer.write("fail ");
        await sleep(5);
        writer.write("ok");
        writer.close();

        expect(await streamToBuffer(producerStream!)).toBe("fail ok");
        expect(await streamToBuffer(resumedStream!)).toBe("ok");
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining("failed to publish"),
          expect.any(Error)
        );
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  it("should throw error if publisher is not provided", () => {
    expect(() => {
      createResumableStreamContext({
        waitUntil: null,
        // @ts-expect-error - intentionally not providing publisher/subscriber to test error
      });
    }).toThrow();
  });
});
