import { describe, it, expect, beforeEach } from "vitest";
import { createTestingStream, streamToBuffer } from "../../testing-utils/testing-stream";
import { createResumableStreamContext, Publisher, ResumableStreamContext, Subscriber } from "..";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resumableStreamTests(
  pubsubFactory: () => {
    subscriber: Subscriber | undefined;
    publisher: Publisher | undefined;
  }
) {
  describe("resumable stream", () => {
    let resume: ResumableStreamContext;

    beforeEach(async () => {
      const { subscriber, publisher } = pubsubFactory();
      resume = createResumableStreamContext({
        waitUntil: () => Promise.resolve(),
        subscriber,
        publisher,
        keyPrefix: "test-resumable-stream-" + crypto.randomUUID(),
      });
    });

    it("should act like a normal stream", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      writer.write("3\n");
      writer.close();
      const result2 = await streamToBuffer(stream);
      expect(result2).toEqual("1\n2\n3\n");
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
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("1\n2\n");
    });

    it("should resume a done stream reverse read", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      const stream2 = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      writer.close();
      const result2 = await streamToBuffer(stream2);
      const result = await streamToBuffer(stream);

      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("1\n2\n");
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
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("1\n2\n");
    });

    it("should actually stream", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      const stream2 = await resume.resumableStream("test", () => readable);
      const result = await streamToBuffer(stream, 1);
      const result2 = await streamToBuffer(stream2, 1);
      expect(result).toEqual("1\n");
      expect(result2).toEqual("1\n");
      writer.write("2\n");
      writer.close();
      const step1 = await streamToBuffer(stream);
      const step2 = await streamToBuffer(stream2);
      expect(step1).toEqual("2\n");
      expect(step2).toEqual("2\n");
    });

    it("should actually stream producer first", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      const stream2 = await resume.resumableStream("test", () => readable);
      const result = await streamToBuffer(stream, 1);
      expect(result).toEqual("1\n");
      writer.write("2\n");
      writer.close();
      const step1 = await streamToBuffer(stream);
      const step2 = await streamToBuffer(stream2);
      expect(step1).toEqual("2\n");
      expect(step2).toEqual("1\n2\n");
    });

    it("should actually stream consumer first", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      const stream2 = await resume.resumableStream("test", () => readable);
      const result2 = await streamToBuffer(stream2, 1);
      expect(result2).toEqual("1\n");
      writer.write("2\n");
      writer.close();
      const step1 = await streamToBuffer(stream);
      const step2 = await streamToBuffer(stream2);
      expect(step1).toEqual("1\n2\n");
      expect(step2).toEqual("2\n");
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
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("1\n2\n");
      expect(result3).toEqual("1\n2\n");
    });

    it("should differentiate between streams", async () => {
      const { readable, writer } = createTestingStream();
      const { readable: readable2, writer: writer2 } = createTestingStream();
      const stream1 = await resume.resumableStream("test", () => readable);
      const stream2 = await resume.resumableStream("test2", () => readable2);
      const stream12 = await resume.resumableStream("test", () => readable);
      const stream22 = await resume.resumableStream("test2", () => readable2);
      writer.write("1\n");
      writer.write("2\n");
      writer.close();
      writer2.write("writer2\n");
      writer2.close();
      const result1 = await streamToBuffer(stream1);
      const result2 = await streamToBuffer(stream2);
      const result12 = await streamToBuffer(stream12);
      const result22 = await streamToBuffer(stream22);
      expect(result1).toEqual("1\n2\n");
      expect(result2).toEqual("writer2\n");
      expect(result12).toEqual("1\n2\n");
      expect(result22).toEqual("writer2\n");
    });

    it("should respect skipCharacters", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      const stream2 = await resume.resumableStream("test", () => readable, 2);
      writer.close();
      const result = await streamToBuffer(stream);
      const result2 = await streamToBuffer(stream2);
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("2\n");
    });

    it("should respect skipCharacters 2", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      const stream2 = await resume.resumableStream("test", () => readable, 4);
      writer.close();
      const result = await streamToBuffer(stream);
      const result2 = await streamToBuffer(stream2);
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("");
    });

    it("should respect skipCharacters 0", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      const stream2 = await resume.resumableStream("test", () => readable, 0);
      writer.close();
      const result = await streamToBuffer(stream);
      const result2 = await streamToBuffer(stream2);
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("1\n2\n");
    });

    it("should return null if stream is done", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      writer.close();

      const result = await streamToBuffer(stream);
      expect(
        await resume.resumableStream("test", () => {
          throw new Error("Should never be called");
        })
      ).toBeNull();
      expect(result).toEqual("1\n2\n");
    });

    it("should support the decronstructed APIs", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.createNewResumableStream("test", () => readable);
      const stream2 = await resume.resumeExistingStream("test");
      writer.write("1\n");
      writer.write("2\n");
      writer.close();
      const result = await streamToBuffer(stream);
      const result2 = await streamToBuffer(stream2);
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("1\n2\n");
    });

    it("should return null if stream is done explicit APIs", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.createNewResumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      writer.close();

      const result = await streamToBuffer(stream);
      expect(await resume.resumeExistingStream("test")).toBeNull();
      expect(result).toEqual("1\n2\n");
    });
  });
}
