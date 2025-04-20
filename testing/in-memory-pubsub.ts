import type { Publisher, Subscriber } from "@/src";

type PubSub = Publisher & Subscriber;

export function createInMemoryPubSubForTesting(): PubSub {
  const subscriptions = new Map<string, ((message: string) => void)[]>();
  const data = new Map<string, string | number>();
  return {
    connect: async () => {},
    publish: async (channel, message) => {
      const callbacks = subscriptions.get(channel) || [];
      for (const callback of callbacks) {
        callback(message);
      }
    },
    subscribe: async (channel, callback) => {
      const callbacks = subscriptions.get(channel) || [];
      callbacks.push(callback);
      subscriptions.set(channel, callbacks);
    },
    unsubscribe: async (channel) => {
      subscriptions.delete(channel);
    },
    del: async (key) => {
      data.delete(key);
    },
    incr: async (key) => {
      const value = Number(data.get(key)) || 0;
      const newValue = value + 1;
      data.set(key, newValue);
      return newValue;
    },
  };
}
