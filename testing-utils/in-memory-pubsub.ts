import type { Publisher, Subscriber } from "@/src";

type PubSub = Publisher & Subscriber;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createInMemoryPubSubForTesting(): PubSub {
  const subscriptions = new Map<string, ((message: string) => void)[]>();
  const data = new Map<string, string | number>();
  console.log("creating in-memory pubsub");
  return {
    connect: async () => {},
    publish: async (channel, message) => {
      const callbacks = subscriptions.get(channel) || [];
      console.log("publishing to", channel, message, callbacks.length);
      await sleep(1);
      for (const callback of callbacks) {
        console.log("invoking callback", channel);
        try {
          callback(message);
        } catch (e) {
          console.error("error invoking callback", e);
        }
      }
    },
    subscribe: async (channel, callback) => {
      console.log("subscribing to", channel);
      await sleep(1);
      const callbacks = subscriptions.get(channel) || [];
      callbacks.push(callback);
      subscriptions.set(channel, callbacks);
    },
    unsubscribe: async (channel) => {
      console.log("unsubscribing from", channel);
      await sleep(1);
      subscriptions.delete(channel);
    },
    del: async (key) => {
      console.log("deleting", key);
      await sleep(1);
      data.delete(key);
    },
    incr: async (key) => {
      await sleep(1);
      const value = Number(data.get(key)) || 0;
      const newValue = value + 1;
      data.set(key, newValue);
      console.log("incremented", key, newValue);
      return newValue;
    },
  };
}
