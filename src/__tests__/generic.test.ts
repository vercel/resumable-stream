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

  it("should throw error if publisher is not provided", () => {
    expect(() => {
      createResumableStreamContext({
        waitUntil: null,
        // @ts-expect-error - intentionally not providing publisher/subscriber to test error
      });
    }).toThrow();
  });
});
