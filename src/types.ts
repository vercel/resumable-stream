import type { Redis } from "ioredis";

export interface CreateResumableStreamContextOptions {
  /**
   * The prefix for the keys used by the resumable streams. Defaults to `resumable-stream`.
   */
  keyPrefix?: string;
  /**
   * A function that takes a promise and ensures that the current program stays alive
   * until the promise is resolved.
   *
   * If you are deploying to a server environment, where you don't have to worry about
   * the function getting suspended, pass in null.
   */
  waitUntil: ((promise: Promise<unknown>) => void) | null;
  /**
   * A pubsub subscriber. Designed to be compatible with clients from the `redis` package.
   */
  subscriber?: Subscriber | Redis;
  /**
   * A pubsub publisher. Designed to be compatible with clients from the `redis` package.
   */
  publisher?: Publisher | Redis;
}

export interface ResumableStreamContext {
  /**
   * Creates or resumes a resumable stream.
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
  /**
   * Resumes a stream that was previously created by `createNewResumableStream`.
   *
   * @param streamId - The ID of the stream. Must be unique for each stream.
   * @param makeStream - A function that returns a stream of strings. It's only executed if the stream it not yet in progress.
   * @param skipCharacters - Number of characters to skip
   * @returns A readable stream of strings. Returns null if there was a stream with the given streamId but it is already fully done (Defaults to 24 hour expiration). undefined if there is no stream with the given streamId.
   */
  resumeExistingStream: (
    streamId: string,
    skipCharacters?: number
  ) => Promise<ReadableStream<string> | null | undefined>;
  /**
   * Creates a new resumable stream.
   *
   * @param streamId - The ID of the stream. Must be unique for each stream.
   * @param makeStream - A function that returns a stream of strings. It's only executed if the stream it not yet in progress.
   * @param skipCharacters - Number of characters to skip
   * @returns A readable stream of strings. Returns null if there was a stream with the given streamId but it is already fully done (Defaults to 24 hour expiration)
   */
  createNewResumableStream: (
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number
  ) => Promise<ReadableStream<string> | null>;

  /**
   * Checks if a stream with the given streamId exists.
   * @param streamId - The ID of the stream.
   * @returns null if there is no stream with the given streamId. True if a stream with the given streamId exists. "DONE" if the stream is fully done.
   */
  hasExistingStream: (streamId: string) => Promise<null | true | "DONE">;
}

/**
 * A Redis-like subscriber. Designed to be compatible with clients from both the `redis` and `ioredis` packages.
 */
export interface Subscriber {
  connect: () => Promise<unknown>;
  subscribe: (channel: string, callback: (message: string) => void) => Promise<void | number>;
  unsubscribe: (channel: string) => Promise<unknown>;
}

/**
 * A Redis-like publisher. Designed to be compatible with clients from both the `redis` and `ioredis` packages.
 */
export interface Publisher {
  connect: () => Promise<unknown>;
  publish: (channel: string, message: string) => Promise<number | unknown>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<"OK" | unknown>;
  get: (key: string) => Promise<string | number | null>;
  incr: (key: string) => Promise<number>;
}

// @internal
export namespace _Private {
  export type RedisDefaults = {
    /**
     * A pubsub subscriber. Designed to be compatible with clients from the `redis` package.
     */
    subscriber: () => Subscriber;
    /**
     * A pubsub publisher. Designed to be compatible with clients from the `redis` package.
     */
    publisher: () => Publisher;
  };
}
