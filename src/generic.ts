import { createResumableStreamContextFactory } from "./runtime";
import type { Publisher, Subscriber } from "./types";

export * from "./types";
export { resumeStream } from "./runtime";

/**
 * Creates a global context for resumable streams from which you can create resumable streams.
 * 
 * This generic version requires you to provide your own Publisher and Subscriber implementations,
 * making it compatible with any Redis-like client (Upstash Redis, Valkey, etc.).
 *
 * @param options - The context options.
 * @param options.keyPrefix - The prefix for the keys used by the resumable streams. Defaults to `resumable-stream`.
 * @param options.waitUntil - A function that takes a promise and ensures that the current program stays alive until the promise is resolved.
 * @param options.subscriber - A pubsub subscriber implementing the Subscriber interface. **Required**.
 * @param options.publisher - A pubsub publisher implementing the Publisher interface. **Required**.
 * @returns A resumable stream context.
 */
export const createResumableStreamContext = createResumableStreamContextFactory({
  publisher: () => {
    throw new Error(
      "Generic mode requires a publisher to be provided. Please pass a publisher option to createResumableStreamContext."
    );
  },
  subscriber: () => {
    throw new Error(
      "Generic mode requires a subscriber to be provided. Please pass a subscriber option to createResumableStreamContext."
    );
  },
});

