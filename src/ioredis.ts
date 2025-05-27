import { getRedisUrl } from "./get-redis-url";
import { Redis } from "ioredis";
import { createResumableStreamContextFactory } from "./runtime";
import { Publisher, Subscriber } from "./types";

export * from "./types";
export { resumeStream } from "./runtime";

/**
 * Creates a Subscriber adapter for a Redis client.
 * @param client - The Redis client to adapt
 * @returns A Subscriber interface compatible with the resumable stream
 */
function createSubscriberAdapter(client: Redis): Subscriber {
  const adapter: Subscriber = {
    connect: () => client.connect(),
    subscribe: async function (channel: string, callback: (message: string) => void) {
      client.on("message", (innerChannel, message) => {
        if (channel === innerChannel) {
          callback(message);
        }
      });
      await client.subscribe(channel);
    },
    unsubscribe: (channel: string) => client.unsubscribe(channel),
  };
  return adapter;
}

/**
 * Creates a Publisher adapter for a Redis client.
 * @param client - The Redis client to adapt
 * @returns A Publisher interface compatible with the resumable stream
 */
function createPublisherAdapter(client: Redis): Publisher {
  const adapter: Publisher = {
    connect: () => client.connect(),
    publish: (channel: string, message: string | Buffer) => client.publish(channel, message),
    set: (key: string, value: string | Buffer, options?: { EX?: number }) => {
      if (options?.EX) {
        return client.set(key, value, "EX", options.EX);
      }
      return client.set(key, value);
    },
    get: (key: string) => client.get(key),
    incr: (key: string) => client.incr(key),
  };
  return adapter;
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
export const createResumableStreamContext = createResumableStreamContextFactory({
  publisher: () => createPublisherAdapter(new Redis(getRedisUrl())),
  subscriber: () => createSubscriberAdapter(new Redis(getRedisUrl())),
});
