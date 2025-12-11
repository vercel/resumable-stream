import { Redis } from "@upstash/redis";
import { Publisher, Subscriber } from "./types";

type RedisSubscriber = ReturnType<typeof Redis.prototype.subscribe>;

/**
 * Creates a Subscriber adapter for a Redis client.
 * @param client - The Redis client to adapt
 * @returns A Subscriber interface compatible with the resumable stream
 */
export function createSubscriberAdapter(client: Redis): Subscriber {
  const activeSubscriptions: Map<string, RedisSubscriber> = new Map();
  const adapter: Subscriber = {
    connect: () => Promise.resolve(),
    subscribe: async function (channel: string, callback: (message: string) => void) {
      const subscriber = activeSubscriptions.get(channel) ?? client.subscribe(channel);
      subscriber.on("message", (message) => {
        if (message.channel === channel) {
          callback(
            typeof message.message === "string" ? message.message : JSON.stringify(message.message)
          );
        }
      });
      activeSubscriptions.set(channel, subscriber);
    },
    unsubscribe: async (channel: string) => {
      const subscriber = activeSubscriptions.get(channel);
      if (subscriber) {
        await subscriber.unsubscribe();
        activeSubscriptions.delete(channel);
      }
    },
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
    connect: () => Promise.resolve(),
    publish: (channel: string, message: string | Buffer) =>
      client.publish(channel, JSON.stringify(message)),
    set: (key: string, value: string | Buffer, options?: { EX?: number }) => {
      if (options?.EX) {
        return client.setex(key, options.EX, value);
      }
      return client.set(key, value);
    },
    get: (key: string) => client.get(key),
    incr: (key: string) => client.incr(key),
  };
  return adapter;
}
