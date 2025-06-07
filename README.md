# resumable-stream

Library for wrapping streams of strings (Like for example SSE web responses) in a way that
a client can resume them after they lost a connection, or to allow a second client to follow along.

Designed for use in serverless environments without sticky load balancing.

The library relies on a pubsub mechanism and is designed to be used with Redis. It was designed to
minimize latency impact and Redis usage for the common case that stream recovery is not needed.
In that common case the library performs a single `INCR` and `SUBSCRIBE` per stream.

## Usage

### Basic Usage (Auto Redis Connection)

The simplest way to use the library is to let it automatically create Redis connections using environment variables (`REDIS_URL` or `KV_URL`):

```typescript
import { createResumableStreamContext } from "resumable-stream";
import { after } from "next/server";

const streamContext = createResumableStreamContext({
  waitUntil: after,
  // Redis clients will be created automatically from REDIS_URL or KV_URL
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params;
  const resumeAt = req.nextUrl.searchParams.get("resumeAt");
  const stream = await streamContext.resumableStream(
    streamId,
    makeTestStream,
    resumeAt ? parseInt(resumeAt) : undefined
  );
  if (!stream) {
    return new Response("Stream is already done", {
      status: 422,
    });
  }
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}
```

### Using with node-redis (`redis` package)

You can pass your own Redis clients from the `redis` package:

```typescript
import { createResumableStreamContext } from "resumable-stream";
import { createClient } from "redis";
import { after } from "next/server";

// Create Redis clients
const redisPublisher = createClient({
  url: "redis://localhost:6379",
  // Add any other redis client options
});

const redisSubscriber = createClient({
  url: "redis://localhost:6379",
  // Add any other redis client options
});

const streamContext = createResumableStreamContext({
  waitUntil: after,
  publisher: redisPublisher,
  subscriber: redisSubscriber,
});

// Use the same way as basic usage...
```

### Using with ioredis

For `ioredis`, you have two options:

#### Option 1: Use the ioredis-specific import

```typescript
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { after } from "next/server";

const streamContext = createResumableStreamContext({
  waitUntil: after,
  // Redis clients will be created automatically using ioredis
});
```

#### Option 2: Pass your own ioredis instances

```typescript
import { createResumableStreamContext } from "resumable-stream";
import { Redis } from "ioredis";
import { after } from "next/server";

// Create ioredis instances
const redis = new Redis("redis://localhost:6379");

// You can use the same instance for both publisher and subscriber
const streamContext = createResumableStreamContext({
  waitUntil: after,
  publisher: redis,
  subscriber: redis,
});

// Or use separate instances
const redisPublisher = new Redis("redis://localhost:6379");
const redisSubscriber = new Redis("redis://localhost:6379");

const streamContext2 = createResumableStreamContext({
  waitUntil: after,
  publisher: redisPublisher,
  subscriber: redisSubscriber,
});
```

### Usage with explicit resumption

```typescript
import { createResumableStreamContext } from "resumable-stream";
import { after } from "next/server";

const streamContext = createResumableStreamContext({
  waitUntil: after,
  // Optionally pass in your own Redis publisher and subscriber
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
) {
  const { streamId } = await params;
  const stream = await streamContext.createNewResumableStream(streamId, makeTestStream);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params;
  const resumeAt = req.nextUrl.searchParams.get("resumeAt");
  const stream = await streamContext.resumeExistingStream(
    streamId,
    resumeAt ? parseInt(resumeAt) : undefined
  );
  if (!stream) {
    return new Response("Stream is already done", {
      status: 422,
    });
  }
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}
```

## Redis Configuration Options

### Environment Variables

The library automatically detects Redis connection URLs from these environment variables:
- `REDIS_URL` - Standard Redis connection URL
- `KV_URL` - Alternative Redis connection URL (commonly used in serverless environments)

### Custom Redis Configuration

You can pass custom Redis clients with any configuration options supported by your chosen Redis library:

```typescript
// node-redis example with custom options
import { createClient } from "redis";

const redisClient = createClient({
  url: "redis://localhost:6379",
  password: "your-password",
  database: 1,
  retry_delay: 100,
  // ... other node-redis options
});

// ioredis example with custom options
import { Redis } from "ioredis";

const redisClient = new Redis({
  host: "localhost",
  port: 6379,
  password: "your-password",
  db: 1,
  retryDelayOnFailover: 100,
  // ... other ioredis options
});
```

## Type Docs

[Type Docs](https://github.com/vercel/resumable-stream/blob/main/docs/README.md)

## How it works

- The first time a resumable stream is invoked for a given `streamId`, a standard stream is created.
- This is now the producer.
- The producer will always complete the stream, even if the reader of the original stream goes away.
- Additionally, the producer starts listening on the pubsub for additional consumers.
- When a second resumable stream is invoked for a given `streamId`, it publishes a messages to alert the producer that it would like to receive the stream.
- The second consumer now expects messages of stream content via the pubsub.
- The producer receives the request, and starts publishing the buffered messages and then publishes additional chunks of the stream.