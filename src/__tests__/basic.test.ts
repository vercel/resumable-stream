import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestingStream,
  streamToBuffer,
} from "../../testing-utils/testing-stream";
import {
  createResumableStreamContext,
  Publisher,
  ResumableStreamContext,
  Subscriber,
} from "..";
import { createInMemoryPubSubForTesting } from "../../testing-utils/in-memory-pubsub";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("resumable stream", () => {
  let pubsub: Publisher & Subscriber;
  let resume: ResumableStreamContext;

  beforeEach(async () => {
    pubsub = createInMemoryPubSubForTesting();
    resume = await createResumableStreamContext({
      waitUntil: () => Promise.resolve(),
      subscriber: pubsub,
      publisher: pubsub,
    });
    console.log("created resume");
  });

  it("should act like a normal stream", async () => {
    const { readable, writer } = createTestingStream();
    const stream = await resume.resumableStream("test", () => readable);
    writer.write("1\n");
    writer.write("2\n");
    writer.write("3\n");
    writer.close();
    const result2 = await streamToBuffer(stream);
    expect(result2).toEqual(["1\n", "2\n", "3\n"]);
  });

  it("should resume a done stream", async () => {
    const { readable, writer } = createTestingStream();
    const stream = await resume.resumableStream("test", () => readable);
    const stream2 = await resume.resumableStream("test", () => readable);
    writer.write("1\n");
    writer.write("2\n");
    writer.close();
    const result = await streamToBuffer(stream);
    const result2 = await streamToBuffer(stream2);
    expect(result).toEqual(["1\n", "2\n"]);
    expect(result2).toEqual(["1\n2\n"]);
  });

  it("should resume an in-progress stream", async () => {
    const { readable, writer } = createTestingStream();
    const stream = await resume.resumableStream("test", () => readable);
    writer.write("1\n");
    const stream2 = await resume.resumableStream("test", () => readable);
    writer.write("2\n");
    writer.close();
    const result = await streamToBuffer(stream);
    const result2 = await streamToBuffer(stream2);
    expect(result).toEqual(["1\n", "2\n"]);
    expect(result2).toEqual(["1\n2\n"]);
  });

  it("should resume multiple streams", async () => {
    const { readable, writer } = createTestingStream();
    const stream = await resume.resumableStream("test", () => readable);
    writer.write("1\n");
    const stream2 = await resume.resumableStream("test", () => readable);
    writer.write("2\n");
    const stream3 = await resume.resumableStream("test", () => readable);
    writer.close();
    const result = await streamToBuffer(stream);
    const result2 = await streamToBuffer(stream2);
    const result3 = await streamToBuffer(stream3);
    expect(result).toEqual(["1\n", "2\n"]);
    expect(result2).toEqual(["1\n2\n"]);
    expect(result3).toEqual(["1\n2\n"]);
  });
});
