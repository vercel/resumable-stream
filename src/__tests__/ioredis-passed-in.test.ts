import { describe, expect, it } from "vitest";
import { resumableStreamTests } from "./tests";
import Redis from "ioredis";

if (process.env.REDIS_URL) {
  resumableStreamTests(() => {
    return {
      subscriber: new Redis(process.env.REDIS_URL!),
      publisher: new Redis(process.env.REDIS_URL!),
    };
  }, "ioredis");
} else {
  console.error("REDIS_URL is not set, skipping tests");
  describe("Redis tests", () => {
    it("should be skipped", () => {
      expect(true).toBe(true);
    });
  });
}
