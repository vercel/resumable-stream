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
  doneWatchdogIntervalMs?: number;
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
      doneWatchdogIntervalMs: options.doneWatchdogIntervalMs,
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
        skipCharacters?: number
      ): Promise<ReadableStream<string> | null> => {
        return createNewResumableStream(
          Promise.all(initPromises),
          ctx as CreateResumableStreamContext,
          streamId,
          makeStream
        );
      },
      resumableStream: async (
        streamId: string,
        makeStream: () => ReadableStream<string>,
        skipCharacters?: number
      ): Promise<ReadableStream<string> | null> => {
        return createResumableStream(
          Promise.all(initPromises),
          ctx as CreateResumableStreamContext,
          streamId,
          makeStream,
          skipCharacters
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
    } as const;
  };
}

interface ResumeStreamMessage {
  listenerId: string;
  skipCharacters?: number;
}

const DONE_MESSAGE = "\n\n\nDONE_SENTINEL_hasdfasudfyge374%$%^$EDSATRTYFtydryrte\n";

const DONE_VALUE = "DONE";

const DEFAULT_DONE_WATCHDOG_INTERVAL_MS = 10_000;

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
  makeStream: () => ReadableStream<string>
): Promise<ReadableStream<string> | null> {
  await initPromise;
  const chunks: string[] = [];
  let listenerChannels: string[] = [];
  let streamDoneResolver: () => void;
  ctx.waitUntil(
    new Promise<void>((resolve) => {
      streamDoneResolver = resolve;
    })
  );
  let isDone = false;
  // Subscribe to request channel BEFORE setting sentinel to avoid race condition.
  // If we set sentinel first, a consumer might detect it and send a request
  // before we've subscribed, causing the message to be lost.
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

  // Set sentinel AFTER subscribing to ensure we're ready to receive requests
  await ctx.publisher.set(`${ctx.keyPrefix}:sentinel:${streamId}`, "1", {
    EX: 24 * 60 * 60,
  });

  return new ReadableStream<string>({
    start(controller) {
      const stream = makeStream();
      const reader = stream.getReader();
      function read() {
        reader.read().then(async ({ done, value }) => {
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
        });
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
  skipCharacters?: number
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
  return createNewResumableStream(initPromise, ctx, streamId, makeStream);
}

export async function resumeStream(
  ctx: CreateResumableStreamContext,
  streamId: string,
  skipCharacters?: number
): Promise<ReadableStream<string> | null> {
  const listenerId = crypto.randomUUID();
  return new Promise<ReadableStream<string> | null>((resolve, reject) => {
    const chunkChannel = `${ctx.keyPrefix}:chunk:${listenerId}`;
    const sentinelKey = `${ctx.keyPrefix}:sentinel:${streamId}`;
    const watchdogIntervalMs = ctx.doneWatchdogIntervalMs ?? DEFAULT_DONE_WATCHDOG_INTERVAL_MS;
    let ackTimeout: ReturnType<typeof setTimeout> | undefined;
    let watchdogTimeout: ReturnType<typeof setTimeout> | undefined;
    let cleanupPromise: Promise<unknown> | undefined;

    const cleanup = () => {
      if (cleanupPromise) {
        return cleanupPromise;
      }

      clearTimeout(ackTimeout);
      clearTimeout(watchdogTimeout);
      cleanupPromise = Promise.resolve().then(() => ctx.subscriber.unsubscribe(chunkChannel));
      return cleanupPromise;
    };

    const readableStream = new ReadableStream<string>({
      async start(controller) {
        try {
          debugLog("STARTING STREAM", streamId, listenerId);
          // The DONE control message travels over pub/sub, which is fire-and-forget: if that one
          // message is lost (e.g. the subscriber connection dropped and reconnected at the wrong
          // moment, or the producer died between writing the DONE sentinel and publishing), this
          // stream would stay open forever even though the durable sentinel already says DONE.
          // Re-check the sentinel periodically and close once the producer is finished or the
          // sentinel expired. Closing requires two consecutive DONE observations so in-flight
          // messages get a full interval to drain before we give up on them.
          let doneObservations = 0;
          let watchdogStarted = false;
          const closeStream = () => {
            try {
              controller.close();
            } catch (e) {
              // The stream may already be closed because the client disconnected.
              if (isDebug()) {
                console.error(e);
              }
            }
          };
          const scheduleDoneWatchdog = () => {
            if (cleanupPromise) {
              return;
            }
            watchdogTimeout = setTimeout(checkDone, watchdogIntervalMs);
          };
          const startDoneWatchdog = () => {
            if (watchdogStarted) {
              return;
            }
            watchdogStarted = true;
            scheduleDoneWatchdog();
          };
          async function checkDone() {
            try {
              const val = await ctx.publisher.get(sentinelKey);
              if (val !== DONE_VALUE && val !== null) {
                doneObservations = 0;
                return;
              }

              doneObservations += 1;
              if (doneObservations < 2) {
                return;
              }

              debugLog(
                "done watchdog: sentinel is done but no DONE message arrived; closing",
                streamId,
                listenerId
              );
              closeStream();
              await cleanup();
            } catch (e) {
              // A transient sentinel read failure must not kill the stream. Cleanup failures are
              // also contained here because timer callbacks cannot surface rejected promises.
              if (isDebug()) {
                console.error(e);
              }
            } finally {
              scheduleDoneWatchdog();
            }
          }
          const start = Date.now();
          ackTimeout = setTimeout(async () => {
            await cleanup();
            const val = await ctx.publisher.get(sentinelKey);
            if (val === DONE_VALUE) {
              resolve(null);
            }
            if (Date.now() - start > 1000) {
              controller.error(new Error("Timeout waiting for ack"));
              reject(new Error("Timeout waiting for ack"));
            }
          }, 1000);
          await ctx.subscriber.subscribe(chunkChannel, async (message: string) => {
            debugLog("Received message", message);
            // The other side always sends a message even if it is the empty string.
            clearTimeout(ackTimeout);
            resolve(readableStream);
            if (message === DONE_MESSAGE) {
              closeStream();
              await cleanup();
              return;
            }
            startDoneWatchdog();
            try {
              controller.enqueue(message);
            } catch (e) {
              // errors can e.g. happen if the stream is already closed
              // because the client has disconnected
              // ignore them unless we are in debug mode
              if (isDebug()) {
                console.error(e);
              }
              await cleanup();
            }
          });
          await ctx.publisher.publish(
            `${ctx.keyPrefix}:request:${streamId}`,
            JSON.stringify({
              listenerId,
              skipCharacters,
            })
          );
        } catch (e) {
          try {
            await cleanup();
          } catch (cleanupError) {
            if (isDebug()) {
              console.error(cleanupError);
            }
          }
          reject(e);
        }
      },
      async cancel() {
        await cleanup();
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

function isDebug() {
  return process.env.DEBUG;
}

function debugLog(...messages: unknown[]) {
  if (isDebug()) {
    console.log(...messages);
  }
}
