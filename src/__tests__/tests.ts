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

    it("should respects resumeAt", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      const stream2 = await resume.resumableStream("test", () => readable, 1);
      writer.close();
      const result = await streamToBuffer(stream);
      const result2 = await streamToBuffer(stream2);
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("2\n");
    });

    it("should respects resumeAt 2", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      const stream2 = await resume.resumableStream("test", () => readable, 2);
      writer.close();
      const result = await streamToBuffer(stream);
      const result2 = await streamToBuffer(stream2);
      expect(result).toEqual("1\n2\n");
      expect(result2).toEqual("");
    });

    it("should throw if stream is done", async () => {
      const { readable, writer } = createTestingStream();
      const stream = await resume.resumableStream("test", () => readable);
      writer.write("1\n");
      writer.write("2\n");
      writer.close();

      const result = await streamToBuffer(stream);
      await expect(
        resume.resumableStream("test", () => {
          throw new Error("Should never be called");
        })
      ).rejects.toThrow(/Stream already done/);
      expect(result).toEqual("1\n2\n");
    });
  });
}
