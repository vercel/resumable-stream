import { createClient } from "redis";

function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is not set");
  }
  return redisUrl;
}

/**
 * A Redis-like subscriber. Designed to be compatible with clients from the `redis` package.
 */
export interface Subscriber {
  connect: () => Promise<unknown>;
  subscribe: (channel: string, callback: (message: string) => void) => Promise<void>;
  unsubscribe: (channel: string) => Promise<unknown>;
}

/**
 * A Redis-like publisher. Designed to be compatible with clients from the `redis` package.
 */
export interface Publisher {
  connect: () => Promise<unknown>;
  publish: (channel: string, message: string) => Promise<unknown>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
  get: (key: string) => Promise<string | number | null>;
  incr: (key: string) => Promise<number>;
}

interface CreateResumableStreamContext {
  keyPrefix: string;
  waitUntil: (promise: Promise<unknown>) => void;
  subscriber: Subscriber;
  publisher: Publisher;
}

export interface CreateResumableStreamContextOptions {
  /**
   * The prefix for the keys used by the resumable streams. Defaults to `resumable-stream`.
   */
  keyPrefix?: string;
  /**
   * A function that takes a promise and ensures that the current program stays alive until the promise is resolved.
   */
  waitUntil: (promise: Promise<unknown>) => void;
  /**
   * A pubsub subscriber. Designed to be compatible with clients from the `redis` package.
   */
  subscriber?: Subscriber;
  /**
   * A pubsub publisher. Designed to be compatible with clients from the `redis` package.
   */
  publisher?: Publisher;
}

export interface ResumableStreamContext {
  /**
   * Creates a resumable stream.
   *
   * Throws if the underlying stream is already done. Instead save the complete output to a database and read from that
   * after streaming completed.
   *
   * By default returns the entire buffered stream. Use `skipCharacters` to resume from a specific point.
   *
   * @param streamId - The ID of the stream. Must be unique for each stream.
   * @param makeStream - A function that returns a stream of strings. It's only executed if the stream it not yet in progress.
   * @param skipCharacters - Number of characters to skip
   * @returns A readable stream of strings. Returns null if there was a stream with the given streamId but it is already fully done (Defaults to 24 hour expiration)
   */
  resumableStream: (
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number
  ) => Promise<ReadableStream<string> | null>;
}

/**
 * Creates a global context for resumable streams from which you can create resumable streams.
 *
 * Call `resumableStream` on the returned context object to create a stream.
 *
 * @param options - The context options.
 * @param options.keyPrefix - The prefix for the keys used by the resumable streams. Defaults to `resumable-stream`.
 * @param options.waitUntil - A function that takes a promise and ensures that the current program stays alive until the promise is resolved.
 * @param options.subscriber - A pubsub subscriber. Designed to be compatible with clients from the `redis` package. If not provided, a new client will be created based on REDIS_URL or KV_URL environment variables.
 * @param options.publisher - A pubsub publisher. Designed to be compatible with clients from the `redis` package. If not provided, a new client will be created based on REDIS_URL or KV_URL environment variables.
 * @returns A resumable stream context.
 */
export function createResumableStreamContext(
  options: CreateResumableStreamContextOptions
): ResumableStreamContext {
  const ctx = {
    keyPrefix: `${options.keyPrefix || "resumable-stream"}:rs`,
    waitUntil: options.waitUntil,
    subscriber: options.subscriber,
    publisher: options.publisher,
  } as CreateResumableStreamContext;
  let initPromises: Promise<unknown>[] = [];
  if (!ctx.subscriber) {
    ctx.subscriber = createClient({
      url: getRedisUrl(),
    });
    initPromises.push(ctx.subscriber.connect());
  }
  if (!ctx.publisher) {
    ctx.publisher = createClient({
      url: getRedisUrl(),
    });
    initPromises.push(ctx.publisher.connect());
  }
  return {
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
  } as const;
}

interface ResumeStreamMessage {
  listenerId: string;
  skipCharacters?: number;
}

const DONE_MESSAGE = "\n\n\nDONE_SENTINEL_hasdfasudfyge374%$%^$EDSATRTYFtydryrte\n";

const DONE_VALUE = "DONE";

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
  const chunks: string[] = [];
  let listenerChannels: string[] = [];
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
  if (skipCharacters) {
    throw new Error("skipCharacters given, but stream is not yet in progress");
  }
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
          debugLog("STARTING STREAM");
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
          await Promise.all([
            ctx.subscriber.subscribe(
              `${ctx.keyPrefix}:chunk:${listenerId}`,
              async (message: string) => {
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
            ),
            ctx.publisher.publish(
              `${ctx.keyPrefix}:request:${streamId}`,
              JSON.stringify({
                listenerId,
                skipCharacters,
              })
            ),
          ]);
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
