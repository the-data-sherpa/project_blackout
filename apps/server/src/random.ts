import { createHash } from "node:crypto";

// Position-keyed randomness keeps injection independent of the baseline stream.
export function randomBytes(...position: unknown[]) {
  return createHash("sha256").update(JSON.stringify(position)).digest();
}
