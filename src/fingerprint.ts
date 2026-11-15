import { canonical } from "./canonical.js";

/** SHA-256 of a text, as lowercase hex. Uses Web Crypto, so it runs in Node 20+ and in browsers. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The fingerprint Galatea publishes for a report: the SHA-256 of the report
 * written as canonical JSON (keys sorted, no spaces, bigints as "123n").
 */
export async function fingerprint(report: unknown): Promise<string> {
  return sha256(canonical(report));
}

/**
 * Check a published fingerprint yourself. Pass the exact text Galatea says it
 * hashed (the `fingerprinted` field of a paid rehearsal), or the report value
 * itself with its amounts as bigints.
 */
export async function verifyFingerprint(reportOrText: unknown, hash: string): Promise<boolean> {
  const text = typeof reportOrText === "string" ? reportOrText : canonical(reportOrText);
  return (await sha256(text)) === hash.toLowerCase().replace(/^0x/, "");
}
