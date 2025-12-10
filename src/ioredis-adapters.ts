import { Redis } from "ioredis";
import { Publisher, Subscriber } from "./types";

/**
 * Creates a Subscriber adapter for a Redis client.
 * @param client - The Redis client to adapt
 * @returns A Subscriber interface compatible with the resumable stream
 */
export function createSubscriberAdapter(client: Redis): Subscriber {
  // Track all active handlers by channel
  const handlers: Map<string, (message: string) => void> = new Map();

  // Store reference to the listener for cleanup
  const messageListener = (channel: string, message: string) => {
    const handler = handlers.get(channel);
    if (handler) {
      handler(message);
    }
  };

  return {
    connect: () => {
      // ioredis Redis instances are connected by default. Nothing to do.
      return Promise.resolve();
    },

    subscribe: async (channel: string, callback: (message: string) => void) => {
      // Add the global listener on first subscription
      if (handlers.size === 0) {
        client.on("message", messageListener);
      }

      handlers.set(channel, callback);
      await client.subscribe(channel);
    },

    unsubscribe: async (channel: string) => {
      handlers.delete(channel);

      // Remove the global listener when no more subscriptions
      if (handlers.size === 0) {
        client.removeListener("message", messageListener);
      }

      return client.unsubscribe(channel);
    },
  };
}

/**
 * Creates a Publisher adapter for a Redis client.
 * @param client - The Redis client to adapt
 * @returns A Publisher interface compatible with the resumable stream
 */
export function createPublisherAdapter(client: Redis): Publisher {
  const adapter: Publisher = {
    connect: () => {
      // ioredis Redis instances are connected by default. Nothing to do.
      return Promise.resolve();
    },
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
