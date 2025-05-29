import { getRedisUrl } from "./get-redis-url";
import { Redis } from "ioredis";
import { createResumableStreamContextFactory } from "./runtime";
import { createPublisherAdapter, createSubscriberAdapter } from "./ioredis-adapters";

export * from "./types";
export { resumeStream } from "./runtime";

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
