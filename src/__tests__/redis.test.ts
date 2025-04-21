import { resumableStreamTests } from "./tests";

if (process.env.REDIS_URL) {
  resumableStreamTests(() => {
    return {
      subscriber: undefined,
      publisher: undefined,
    };
  });
} else {
  console.error("REDIS_URL is not set, skipping tests");
}
