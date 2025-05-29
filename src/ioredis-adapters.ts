import { Redis } from "ioredis";
import { Publisher, Subscriber } from "./types";

/**
 * Creates a Subscriber adapter for a Redis client.
 * @param client - The Redis client to adapt
 * @returns A Subscriber interface compatible with the resumable stream
 */
export function createSubscriberAdapter(client: Redis): Subscriber {
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
export function createPublisherAdapter(client: Redis): Publisher {
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
