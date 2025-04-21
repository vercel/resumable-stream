import type { Publisher, Subscriber } from "../src";

type PubSub = Publisher & Subscriber;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createInMemoryPubSubForTesting(): {
  subscriber: PubSub;
  publisher: PubSub;
} {
  const subscriptions = new Map<string, ((message: string) => void)[]>();
  const data = new Map<string, string | number>();
  console.log("creating in-memory pubsub");
  const pubsub: PubSub = {
    connect: async () => {},
    publish: async (channel, message) => {
      const callbacks = subscriptions.get(channel) || [];
      console.log("PUBLISH", channel, message, callbacks.length);
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
      console.log("SUBSCRIBE", channel);
      await sleep(1);
      const callbacks = subscriptions.get(channel) || [];
      callbacks.push(callback);
      subscriptions.set(channel, callbacks);
    },
    unsubscribe: async (channel) => {
      console.log("UNSUBSCRIBE", channel);
      await sleep(1);
      subscriptions.delete(channel);
    },
    set: async (key, value, options) => {
      await sleep(1);
      console.log("SET", key, value, options);
      data.set(key, value);
    },
    get: async (key) => {
      await sleep(1);
      console.log("GET", key);
      return data.get(key) || null;
    },
    incr: async (key) => {
      await sleep(1);
      const rawValue = data.get(key) || 0;
      const value = Number(rawValue);
      if (isNaN(value)) {
        throw new Error("ERR value is not an integer or out of range");
      }
      const newValue = value + 1;
      data.set(key, newValue);
      console.log("INCR", key, newValue);
      return newValue;
    },
  };
  return {
    subscriber: pubsub,
    publisher: pubsub,
  };
}
