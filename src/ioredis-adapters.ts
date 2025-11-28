import { Redis } from "ioredis";
import { Publisher, Subscriber } from "./types";

interface ListenerEntry {
  channel: string;
  callback: (message: string) => void;
  wrappedListener: (innerChannel: string, message: string) => void;
}

/**
 * Creates a Subscriber adapter for a Redis client.
 * @param client - The Redis client to adapt
 * @returns A Subscriber interface compatible with the resumable stream
 */
export function createSubscriberAdapter(client: Redis): Subscriber {
  // track all active listeners by channel
  const listeners: Map<string, ListenerEntry> = new Map();

  return {
    connect: () => {
      // ioredis Redis instances are connected by default. Nothing to do.
      return Promise.resolve();
    },

    subscribe: async function (channel: string, callback: ListenerEntry["callback"]) {
      // Create a wrapped listener that filters by channel
      const wrappedListener = (innerChannel: string, message: string) => {
        if (channel === innerChannel) {
          callback(message);
        }
      };

      // Store the listener entry for later cleanup
      listeners.set(channel, {
        channel,
        callback,
        wrappedListener,
      });

      // Add the listener to the client
      client.on("message", wrappedListener);

      // Subscribe to the Redis channel
      await client.subscribe(channel);
    },

    unsubscribe: async (channel: string) => {
      // Get the listener entry for this channel
      const entry = listeners.get(channel);

      if (entry) {
        // Remove the event listener from the client - THIS IS THE KEY FIX
        client.removeListener("message", entry.wrappedListener);
        listeners.delete(channel);
      }

      // Unsubscribe from the Redis channel
      return client.unsubscribe(channel) as Promise<number>;
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
