export function createTestingStream() {
  let controller: ReadableStreamDefaultController<string> | undefined =
    undefined;
  const buffer: string[] = [];
  const readable = new ReadableStream<string>({
    start(c) {
      controller = c;
      if (buffer.length > 0) {
        for (const chunk of buffer) {
          controller.enqueue(chunk);
        }
      }
    },
  });

  const writable = new WritableStream<string>({
    write(chunk) {
      if (controller) {
        controller.enqueue(chunk);
      }
      buffer.push(chunk);
    },
    close() {
      controller!.close();
    },
    abort(reason) {
      controller!.error(reason);
    },
  });
  return {
    readable,
    writer: writable.getWriter(),
    buffer,
  };
}

function timeout(ms: number) {
  return new Promise((resolve, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms)
  );
}

export async function streamToBuffer(stream: ReadableStream<string>) {
  const reader = stream.getReader();
  const buffer: string[] = [];
  while (true) {
    const { done, value } = await (Promise.race([
      reader.read(),
      timeout(100),
    ]) as Promise<{ done: boolean; value: string }>);
    if (done) {
      break;
    }
    buffer.push(value);
  }
  return buffer;
}
