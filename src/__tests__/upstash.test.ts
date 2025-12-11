import { describe, expect, it } from "vitest";
import { resumableStreamTests } from "./tests";
import { Redis } from "@upstash/redis";

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  resumableStreamTests(() => {
    return {
      subscriber: Redis.fromEnv(),
      publisher: Redis.fromEnv(),
    };
  }, "upstash");
} else {
  console.error("At least one of UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set, skipping tests");
  describe("Redis tests", () => {
    it("should be skipped", () => {
      expect(true).toBe(true);
    });
  });
}
