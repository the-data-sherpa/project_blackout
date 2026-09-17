import { cp } from "node:fs/promises";

// Next's standalone server needs static assets alongside its generated server.
const build = new URL("../apps/web/.next/", import.meta.url);
await cp(
  new URL("static/", build),
  new URL("standalone/apps/web/.next/static/", build),
  { recursive: true },
);
