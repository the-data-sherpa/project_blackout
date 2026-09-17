import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const filename = resolve(process.env.DATABASE_PATH ?? "data/blackout.sqlite");
if (process.env.DATABASE_PATH === ":memory:")
  throw new Error("Choose a file database for the saved demonstration.");
if ([filename, `${filename}-wal`, `${filename}-shm`].some(existsSync))
  throw new Error(
    "A database already exists at this path. Keep it and choose a new DATABASE_PATH or a new Compose project volume.",
  );
const directory = new URL("../demo/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", directory), "utf8"),
);
const compressed = readFileSync(new URL("blackout-demo.sqlite.gz", directory));
if (createHash("sha256").update(compressed).digest("hex") !== manifest.sha256)
  throw new Error("The demonstration checksum does not match its manifest.");
const database = gunzipSync(compressed, { maxOutputLength: 128 * 1024 * 1024 });
mkdirSync(dirname(filename), { recursive: true });
const temporary = mkdtempSync(join(dirname(filename), ".blackout-demo-"));
try {
  const prepared = join(temporary, "recording.sqlite");
  writeFileSync(prepared, database, { flag: "wx", mode: 0o600, flush: true });
  // Link publishes the complete file atomically and fails if the destination exists.
  linkSync(prepared, filename);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log(
  `Installed recorded demonstration at ${filename}. Open /?run=${manifest.runId}. Playback makes no Jev requests.`,
);
