// This file just exists to ensure certain usages of the constructor are valid.

import { createClient } from "redis";
import { createResumableStreamContext } from "../src";
import { after, NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Redis } from "ioredis";

const ctx1 = createResumableStreamContext({
  waitUntil: after,
  subscriber: createClient({
    url: "redis://localhost:6379",
  }),
  publisher: createClient({
    url: "redis://localhost:6379",
  }),
});

const redis = new Redis("redis://localhost:6379");

const ctx2 = createResumableStreamContext({
  waitUntil: waitUntil,
  subscriber: redis,
  publisher: redis,
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
) {
  const { streamId } = await params;
  const stream = await ctx1.createNewResumableStream(
    streamId,
    () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue("Hello, world!");
          controller.close();
        },
      })
  );
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ streamId: string }> }) {
  const { streamId } = await params;
  const resumeAt = req.nextUrl.searchParams.get("resumeAt");
  const stream = await ctx1.resumeExistingStream(
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
