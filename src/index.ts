import { createClient } from "redis";

function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is not set");
  }
  return redisUrl;
}

export interface Subscriber {
  connect: () => Promise<unknown>;
  subscribe: (
    channel: string,
    callback: (message: string) => void
  ) => Promise<void>;
  unsubscribe: (channel: string) => Promise<unknown>;
}

export interface Publisher {
  connect: () => Promise<unknown>;
  publish: (channel: string, message: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  incr: (key: string) => Promise<number>;
}

interface CreateResumableStreamContextOptions {
  keyPrefix?: string;
  waitUntil: (promise: Promise<unknown>) => void;
  subscriber?: Subscriber;
  publisher?: Publisher;
}

interface CreateResumableStreamContext {
  keyPrefix: string;
  waitUntil: (promise: Promise<unknown>) => void;
  subscriber: Subscriber;
  publisher: Publisher;
}

export interface ResumableStreamContext {
  /**
   * Creates a resumable stream.
   *
   * @param streamId - The ID of the stream. Must be unique for each stream.
   * @param makeStream - A function that returns a stream of lines. It's only executed if the stream it not yet in progress.
   * @returns A stream of lines.
   */
  resumableStream: (
    streamId: string,
    makeStream: () => ReadableStream<string>,
    resumeAt?: number
  ) => Promise<ReadableStream<string>>;
}

export async function createResumableStreamContext(
  ctx: CreateResumableStreamContextOptions
): Promise<ResumableStreamContext> {
  let promises: Promise<unknown>[] = [];
  if (!ctx.subscriber) {
    ctx.subscriber = createClient({
      url: getRedisUrl(),
    });
    promises.push(ctx.subscriber.connect());
  }
  if (!ctx.publisher) {
    ctx.publisher = createClient({
      url: getRedisUrl(),
    });
    promises.push(ctx.publisher.connect());
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  ctx.keyPrefix = `${ctx.keyPrefix || "resumable-stream"}:rs`;
  return {
    resumableStream: async (
      streamId: string,
      makeStream: () => ReadableStream<string>,
      resumeAt?: number
    ) => {
      return createResumableStream(
        ctx as CreateResumableStreamContext,
        streamId,
        makeStream,
        resumeAt
      );
    },
  } as const;
}

interface ResumeStreamMessage {
  listenerId: string;
  resumeAt?: number;
}

const DONE_MESSAGE =
  "\n\n\nDONE_SENTINEL_hasdfasudfyge374%$%^$EDSATRTYFtydryrte\n";

/**
 * Creates a resumable line stream. Each enqued line must be terminated by a newline.
 *
 * @param streamId - The ID of the stream.
 * @param makeStream - A function that returns a stream of lines. It's only executed if the stream it not yet in progress.
 * @returns A stream of lines.
 */
async function createResumableStream(
  ctx: CreateResumableStreamContext,
  streamId: string,
  makeStream: () => ReadableStream<string>,
  resumeAt?: number
) {
  const lines: string[] = [];
  let listenerChannels: string[] = [];
  const currentListenerCount = await ctx.publisher.incr(
    `${ctx.keyPrefix}:sentinel:${streamId}`
  );
  if (currentListenerCount > 1) {
    return resumeStream(ctx, streamId, resumeAt);
  }
  if (resumeAt) {
    throw new Error("resumeAt given, but stream is not yet in progress");
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
      const linesToSend = lines.slice(parsedMessage.resumeAt || 0);
      console.log("sending lines", linesToSend.length);
      if (linesToSend.length > 0) {
        ctx.publisher.publish(
          `${ctx.keyPrefix}:line:${parsedMessage.listenerId}`,
          linesToSend.join("")
        );
      }
      if (isDone) {
        ctx.publisher.publish(
          `${ctx.keyPrefix}:line:${parsedMessage.listenerId}`,
          DONE_MESSAGE
        );
      }

      listenerChannels.push(parsedMessage.listenerId);
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
            console.log("Stream done");
            try {
              controller.close();
            } catch (e) {
              //console.error(e);
            }
            const promises: Promise<unknown>[] = [];
            promises.push(
              ctx.publisher.del(`${ctx.keyPrefix}:sentinel:${streamId}`)
            );
            promises.push(
              ctx.subscriber.unsubscribe(`${ctx.keyPrefix}:request:${streamId}`)
            );
            for (const listenerId of listenerChannels) {
              console.log("sending done message to", listenerId);
              promises.push(
                ctx.publisher.publish(
                  `${ctx.keyPrefix}:line:${listenerId}`,
                  DONE_MESSAGE
                )
              );
            }
            await Promise.all(promises);
            streamDoneResolver?.();
            console.log("Cleanup done");
            return;
          }
          if (!value.endsWith("\n")) {
            throw new Error("Each enqueued line must end with a newline");
          }
          lines.push(value);
          try {
            controller.enqueue(value);
          } catch (e) {
            // If we cannot enqueue, the stream is already closed, but we WANT to continue.
          }
          const promises: Promise<unknown>[] = [];
          for (const listenerId of listenerChannels) {
            console.log("sending line to", listenerId);
            promises.push(
              ctx.publisher.publish(
                `${ctx.keyPrefix}:line:${listenerId}`,
                value
              )
            );
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
  resumeAt?: number
) {
  const listenerId = crypto.randomUUID();
  return new ReadableStream<string>({
    async start(controller) {
      const cleanup = async () => {
        await ctx.subscriber.unsubscribe(`${ctx.keyPrefix}:line:${listenerId}`);
      };
      await ctx.subscriber.subscribe(
        `${ctx.keyPrefix}:line:${listenerId}`,
        async (message: string) => {
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
          resumeAt,
        })
      );
    },
  });
}
