# resumable-stream

Library for wrapping streams of strings (Like for example SSE web responses) in a way that
a client can resume them after they lost a connection, or to allow a second client to follow along.

The library relies on a pubsub mechanism and is designed to be used with Redis. It was designed to
minimize latency impact and Redis usage for the common case that stream recovery is not needed.
In that common case the library performs a single `INCR` and `SUBSCRIBE` per stream.

## Usage

```typescript
import { createResumableStreamContext } from "resumable-stream";
import { after } from "next/server";

const streamContext = createResumableStreamContext({
  waitUntil: after,
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
) {
  const { streamId } = await params;
  const resumeAt = req.nextUrl.searchParams.get("resumeAt");
  return new Response(
    await streamContext.resumableStream(
      streamId,
      makeTestStream,
      resumeAt ? parseInt(resumeAt) : undefined
    ),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
    }
  );
}
```
