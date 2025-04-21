// This file just exists to ensure certain usages of the constructor are valid.

import { createClient } from "redis";
import { createResumableStreamContext } from "../src";
import { after } from "next/server";
import { waitUntil } from "@vercel/functions";

const ctx1 = createResumableStreamContext({
  waitUntil: after,
  subscriber: createClient({
    url: "redis://localhost:6379",
  }),
  publisher: createClient({
    url: "redis://localhost:6379",
  }),
});

const ctx2 = createResumableStreamContext({
  waitUntil: waitUntil,
});
