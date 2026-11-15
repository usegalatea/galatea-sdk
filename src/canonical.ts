/**
 * Canonical JSON: object keys sorted, bigints written as decimal strings with
 * an "n" suffix. Two machines that hold the same value always produce the same
 * text, which is what makes a hash of it worth publishing.
 *
 * This file has no Node imports, so a browser can rebuild the same text and
 * check a published hash for itself.
 */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return `"${value.toString()}n"`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot hash a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  throw new Error(`Cannot hash a ${typeof value}`);
}
