import type { Redis } from "ioredis";
import { _Private, Publisher, Subscriber } from "./types";
import { CreateResumableStreamContextOptions } from "./types";
import { ResumableStreamContext } from "./types";
import { createPublisherAdapter, createSubscriberAdapter } from "./ioredis-adapters";

interface CreateResumableStreamContext {
  keyPrefix: string;
  waitUntil: (promise: Promise<unknown>) => void;
  subscriber: Subscriber;
  publisher: Publisher;
}

export function createResumableStreamContextFactory(defaults: _Private.RedisDefaults) {
  return function createResumableStreamContext(
    options: CreateResumableStreamContextOptions
  ): ResumableStreamContext {
    const waitUntil = options.waitUntil || (async (p) => await p);
    const ctx = {
      keyPrefix: `${options.keyPrefix || "resumable-stream"}:rs`,
      waitUntil,
      subscriber: options.subscriber,
      publisher: options.publisher,
    } as CreateResumableStreamContext;
    let initPromises: Promise<unknown>[] = [];

    // Check if user has passed a raw ioredis instance
    if (options.subscriber && (options.subscriber as Redis).defineCommand) {
      ctx.subscriber = createSubscriberAdapter(options.subscriber as Redis);
    }
    if (options.publisher && (options.publisher as Redis).defineCommand) {
      ctx.publisher = createPublisherAdapter(options.publisher as Redis);
    }

    // If user has passed undefined, initialize with defaults
    if (!ctx.subscriber) {
      ctx.subscriber = defaults.subscriber();
      initPromises.push(ctx.subscriber.connect());
    }
    if (!ctx.publisher) {
      ctx.publisher = defaults.publisher();
      initPromises.push(ctx.publisher.connect());
    }

    return {
      resumeExistingStream: async (
        streamId: string,
        skipCharacters?: number
      ): Promise<ReadableStream<string> | null | undefined> => {
        return resumeExistingStream(
          Promise.all(initPromises),
          ctx as CreateResumableStreamContext,
          streamId,
          skipCharacters
        );
      },
      createNewResumableStream: async (
        streamId: string,
        makeStream: () => ReadableStream<string>,
        skipCharacters?: number,
        cancellationController?: AbortController
      ): Promise<ReadableStream<string> | null> => {
        const initPromise = Promise.all(initPromises);
        await initPromise;
        await ctx.publisher.set(`${ctx.keyPrefix}:sentinel:${streamId}`, "1", {
          EX: 24 * 60 * 60,
        });

        return createNewResumableStream(
          initPromise,
          ctx as CreateResumableStreamContext,
          streamId,
          makeStream,
          cancellationController
        );
      },
      resumableStream: async (
        streamId: string,
        makeStream: () => ReadableStream<string>,
        skipCharacters?: number,
        cancellationController?: AbortController
      ): Promise<ReadableStream<string> | null> => {
        return createResumableStream(
          Promise.all(initPromises),
          ctx as CreateResumableStreamContext,
          streamId,
          makeStream,
          skipCharacters,
          cancellationController
        );
      },
      hasExistingStream: async (streamId: string): Promise<null | true | "DONE"> => {
        const state = await ctx.publisher.get(`${ctx.keyPrefix}:sentinel:${streamId}`);
        if (state === null) {
          return null;
        }
        if (state === DONE_VALUE) {
          return DONE_VALUE;
        }
        return true;
      },
      sendCancellationSignal: async (streamId: string): Promise<void> => {
        const controlStateKey = `${ctx.keyPrefix}:control-state:${streamId}`;
        const controlChannel = `${ctx.keyPrefix}:control:${streamId}`;
        await Promise.all([
          ctx.publisher.set(controlStateKey, "ABORTED", { EX: 24 * 60 * 60 }),
          ctx.publisher.publish(controlChannel, "ABORT"),
        ]);
      },
    } as const;
  };
}

interface ResumeStreamMessage {
  listenerId: string;
  skipCharacters?: number;
}

const DONE_MESSAGE = "\n\n\nDONE_SENTINEL_hasdfasudfyge374%$%^$EDSATRTYFtydryrte\n";

const DONE_VALUE = "DONE";

async function resumeExistingStream(
  initPromise: Promise<unknown>,
  ctx: CreateResumableStreamContext,
  streamId: string,
  skipCharacters?: number
): Promise<ReadableStream<string> | null | undefined> {
  await initPromise;
  const state = await ctx.publisher.get(`${ctx.keyPrefix}:sentinel:${streamId}`);
  if (!state) {
    return undefined;
  }
  if (state === DONE_VALUE) {
    return null;
  }
  return resumeStream(ctx, streamId, skipCharacters);
}

async function createNewResumableStream(
  initPromise: Promise<unknown>,
  ctx: CreateResumableStreamContext,
  streamId: string,
  makeStream: () => ReadableStream<string>,
  cancellationController?: AbortController
): Promise<ReadableStream<string> | null> {
  await initPromise;
  if (cancellationController) {
    await _linkController(ctx, streamId, cancellationController);
  }
  const chunks: string[] = [];
  let listenerChannels: string[] = [];
  let streamDoneResolver: () => void;
  ctx.waitUntil(
    new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    })
  );
  let isDone = false;
  // This is ultimately racy if two requests for the same ID come at the same time.
  // But this library is for the case where that would not happen.
  await ctx.subscriber.subscribe(
    `${ctx.keyPrefix}:request:${streamId}`,
    async (message: string) => {
      const parsedMessage = JSON.parse(message) as ResumeStreamMessage;
      debugLog("Connected to listener", parsedMessage.listenerId);
      listenerChannels.push(parsedMessage.listenerId);
      debugLog("parsedMessage", chunks.length, parsedMessage.skipCharacters);
      const chunksToSend = chunks.join("").slice(parsedMessage.skipCharacters || 0);
      debugLog("sending chunks", chunksToSend.length);
      const promises: Promise<unknown>[] = [];
      promises.push(
        ctx.publisher.publish(`${ctx.keyPrefix}:chunk:${parsedMessage.listenerId}`, chunksToSend)
      );
      if (isDone) {
        promises.push(
          ctx.publisher.publish(`${ctx.keyPrefix}:chunk:${parsedMessage.listenerId}`, DONE_MESSAGE)
        );
      }
      await Promise.all(promises);
    }
  );

  return new ReadableStream<string>({
    start(controller) {
      const stream = makeStream();
      const reader = stream.getReader();

      const handleError = (err: unknown) => {
        // We specifically check for AbortError. We don't want to suppress other, real errors.
        if (!(err instanceof Error) || err.name !== "AbortError") {
          console.error("[resumable-stream] Producer stream threw an error:", err);
        }
        // Whether an abort or another error, we treat the stream as "done".
        isDone = true;
        try {
          controller.close();
        } catch (_e) {} // Ignore errors if already closed.

        const promises: Promise<unknown>[] = [];
        promises.push(
          ctx.publisher.set(`${ctx.keyPrefix}:sentinel:${streamId}`, DONE_VALUE, {
            EX: 24 * 60 * 60,
          })
        );
        promises.push(ctx.subscriber.unsubscribe(`${ctx.keyPrefix}:request:${streamId}`));
        for (const listenerId of listenerChannels) {
          promises.push(
            ctx.publisher.publish(`${ctx.keyPrefix}:chunk:${listenerId}`, DONE_MESSAGE)
          );
        }
        Promise.all(promises).then(() => streamDoneResolver?.());
      };

      function read() {
        reader
          .read()
          .then(async ({ done, value }) => {
            if (done) {
              isDone = true;
              debugLog("Stream done");
              try {
                controller.close();
              } catch (e) {
                //console.error(e);
              }
              const promises: Promise<unknown>[] = [];
              debugLog("setting sentinel to done");
              promises.push(
                ctx.publisher.set(`${ctx.keyPrefix}:sentinel:${streamId}`, DONE_VALUE, {
                  EX: 24 * 60 * 60,
                })
              );
              promises.push(ctx.subscriber.unsubscribe(`${ctx.keyPrefix}:request:${streamId}`));
              for (const listenerId of listenerChannels) {
                debugLog("sending done message to", listenerId);
                promises.push(
                  ctx.publisher.publish(`${ctx.keyPrefix}:chunk:${listenerId}`, DONE_MESSAGE)
                );
              }
              await Promise.all(promises);
              streamDoneResolver?.();
              debugLog("Cleanup done");
              return;
            }
            chunks.push(value);
            try {
              debugLog("Enqueuing line", value);
              controller.enqueue(value);
            } catch (e) {
              // If we cannot enqueue, the stream is already closed, but we WANT to continue.
            }
            const promises: Promise<unknown>[] = [];
            for (const listenerId of listenerChannels) {
              debugLog("sending line to", listenerId);
              promises.push(ctx.publisher.publish(`${ctx.keyPrefix}:chunk:${listenerId}`, value));
            }
            await Promise.all(promises);
            read();
          })
          .catch(handleError);
      }
      read();
    },
  });
}
/**
 * Creates a resumable stream of strings.
 *
 * @param streamId - The ID of the stream.
 * @param makeStream - A function that returns a stream of strings. It's only executed if the stream it not yet in progress.
 * @returns A stream of strings.
 */
async function createResumableStream(
  initPromise: Promise<unknown>,
  ctx: CreateResumableStreamContext,
  streamId: string,
  makeStream: () => ReadableStream<string>,
  skipCharacters?: number,
  cancellationController?: AbortController
): Promise<ReadableStream<string> | null> {
  await initPromise;

  const currentListenerCount = await incrOrDone(
    ctx.publisher,
    `${ctx.keyPrefix}:sentinel:${streamId}`
  );
  debugLog("currentListenerCount", currentListenerCount);
  if (currentListenerCount === DONE_VALUE) {
    return null;
  }
  if (currentListenerCount > 1) {
    return resumeStream(ctx, streamId, skipCharacters);
  }
  return createNewResumableStream(initPromise, ctx, streamId, makeStream, cancellationController);
}

export async function resumeStream(
  ctx: CreateResumableStreamContext,
  streamId: string,
  skipCharacters?: number
): Promise<ReadableStream<string> | null> {
  const listenerId = crypto.randomUUID();
  return new Promise<ReadableStream<string> | null>((resolve, reject) => {
    const readableStream = new ReadableStream<string>({
      async start(controller) {
        try {
          debugLog("STARTING STREAM", streamId, listenerId);
          const cleanup = async () => {
            await ctx.subscriber.unsubscribe(`${ctx.keyPrefix}:chunk:${listenerId}`);
          };
          const start = Date.now();
          const timeout = setTimeout(async () => {
            await cleanup();
            const val = await ctx.publisher.get(`${ctx.keyPrefix}:sentinel:${streamId}`);
            if (val === DONE_VALUE) {
              resolve(null);
            }
            if (Date.now() - start > 1000) {
              controller.error(new Error("Timeout waiting for ack"));
            }
          }, 1000);
          await ctx.subscriber.subscribe(
            `${ctx.keyPrefix}:chunk:${listenerId}`,
            async (message: string) => {
              debugLog("Received message", message);
              // The other side always sends a message even if it is the empty string.
              clearTimeout(timeout);
              resolve(readableStream);
              if (message === DONE_MESSAGE) {
                try {
                  controller.close();
                } catch (e) {
                  console.error(e);
                }
                await cleanup();
                return;
              }
              try {
                controller.enqueue(message);
              } catch (e) {
                console.error(e);
                await cleanup();
              }
            }
          );
          await ctx.publisher.publish(
            `${ctx.keyPrefix}:request:${streamId}`,
            JSON.stringify({
              listenerId,
              skipCharacters,
            })
          );
        } catch (e) {
          reject(e);
        }
      },
    });
  });
}

function incrOrDone(publisher: Publisher, key: string): Promise<typeof DONE_VALUE | number> {
  return publisher.incr(key).catch((reason) => {
    const errorString = String(reason);
    if (errorString.includes("ERR value is not an integer or out of range")) {
      return DONE_VALUE;
    }
    throw reason;
  });
}

function debugLog(...messages: unknown[]) {
  if (process.env.DEBUG || process.env.NODE_ENV === "test") {
    console.log(...messages);
  }
}

/**
 * Links a controller to the Redis cancellation mechanism.
 * @internal
 */
async function _linkController(
  ctx: CreateResumableStreamContext,
  streamId: string,
  controller: AbortController
): Promise<void> {
  const controlChannel = `${ctx.keyPrefix}:control:${streamId}`;
  const controlStateKey = `${ctx.keyPrefix}:control-state:${streamId}`;

  // It's idempotent, so it's safe to call multiple times.
  let hasCleanedUp = false;
  const cleanup = () => {
    if (hasCleanedUp) return;
    hasCleanedUp = true;
    // We remove our own listener before unsubscribing.
    controller.signal.removeEventListener("abort", cleanup);
    // Unsubscribe in the background without waiting.
    ctx.waitUntil(ctx.subscriber.unsubscribe(controlChannel));
  };

  // Attach the self-cleaning listener immediately.
  controller.signal.addEventListener("abort", cleanup, { once: true });

  // A failure here is non-critical; we can proceed to the subscription.
  try {
    const state = await ctx.publisher.get(controlStateKey);
    if (state === "ABORTED") {
      controller.abort(); // This will trigger the cleanup listener.
      return;
    }
  } catch (e) {
    // If the GET fails, we log it but DO NOT clean up. We must still attempt to subscribe.
    debugLog(
      `[resumable-stream:${streamId}] Could not check initial abort state. Proceeding to subscribe.`,
      e
    );
  }

  try {
    // If not already aborted, subscribe for live updates.
    await ctx.subscriber.subscribe(controlChannel, (message: string) => {
      if (message === "ABORT") {
        controller.abort(); // This will also trigger the cleanup listener.
      }
    });
  } catch (e) {
    console.error(`[resumable-stream:${streamId}] Failed to link controller`, e);
    // If we failed, clean up immediately.
    cleanup();
  }
}
