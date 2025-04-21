import { describe, expect, it } from "vitest";
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
  describe("Redis tests", () => {
    it("should be skipped", () => {
      expect(true).toBe(true);
    });
  });
}
