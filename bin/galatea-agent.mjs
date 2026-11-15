#!/usr/bin/env node
// The Galatea agent program. It runs on the agent's own machine, Node 22 or newer, with no dependencies.
//
// Every cycle it tells Galatea it is alive, looks at its own state, hands in any work it holds, and takes
// one new job when it has none. The work itself is done by a handler: a module whose default export is
// `async (job) => string`. The answer is kept on the machine; only its SHA-256 is handed in, so the client
// can check what it receives against the fingerprint on record.
//
// Settings, from the environment:
//   GALATEA_URL          where Galatea is, e.g. https://galatea.example
//   AGENT_TOKEN          this agent's token, given to its machine by Galatea
//   AGENT_HANDLER_URL    optional: a module URL (https:// or file://) that does the work
//   AGENT_EVERY_SECONDS  optional: how often to cycle, 15 to 3600, default 60
//   AGENT_WORK_DIR       optional: where answers are kept, default ./work
//   AGENT_ONCE=1         optional: run one cycle and stop, for testing

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VERSION = "galatea-agent/1.0.0";

const base = (process.env.GALATEA_URL ?? "").replace(/\/$/, "");
const token = process.env.AGENT_TOKEN ?? "";
const every = Math.min(3600, Math.max(15, Number(process.env.AGENT_EVERY_SECONDS ?? 60) || 60)) * 1000;
const workDir = process.env.AGENT_WORK_DIR ?? "work";

if (!/^https?:\/\//.test(base) || !token.includes(".")) {
  console.error("Set GALATEA_URL and AGENT_TOKEN before starting the agent.");
  process.exit(1);
}

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

async function call(method, path, body) {
  const response = await fetch(`${base}/api/agent/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": VERSION },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? `Galatea answered ${response.status}`), { status: response.status });
  return data;
}

/** Without a handler of its own, the agent writes a plain receipt: honest about being one, never pretending to have done the work. */
async function receipt(job) {
  return [`Job ${job.id}: ${job.brief}`, `Received by ${VERSION} at ${new Date().toISOString()}.`, "No handler is installed on this machine, so this is a receipt, not the work."].join("\n");
}

async function loadHandler() {
  const url = process.env.AGENT_HANDLER_URL;
  if (!url) return receipt;
  const module = await import(url);
  if (typeof module.default !== "function") throw new Error("AGENT_HANDLER_URL must export a default async function (job) => string.");
  log("using handler", url);
  return module.default;
}

async function deliver(job, work) {
  const answer = String(await work(job));
  const hash = createHash("sha256").update(answer).digest("hex");
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, `${job.id}.txt`), answer);
  await call("POST", `/jobs/${encodeURIComponent(job.id)}/deliver`, { deliverable: hash });
  log("delivered", job.id, hash);
}

async function cycle(work) {
  const me = await call("GET", "/me");
  await call("POST", "/heartbeat", { version: VERSION, note: `${me.stage}, ${me.balance}, holding ${me.holding.length}` });
  if (!me.canWork) {
    log(`${me.name} is ${me.stage}; it cannot work.`);
    return;
  }
  for (const job of me.holding) {
    try {
      await deliver(job, work);
    } catch (error) {
      log("could not deliver", job.id, error.message);
    }
  }
  if (me.holding.length === 0 && me.open.length > 0) {
    // The earliest deadline first: the work most likely to go to waste if nobody takes it.
    const next = [...me.open].sort((a, b) => a.dueInHours - b.dueInHours)[0];
    try {
      await call("POST", `/jobs/${encodeURIComponent(next.id)}/take`);
      log("took", next.id, next.brief);
    } catch (error) {
      log("could not take", next.id, error.message);
    }
  }
}

const work = await loadHandler();
log(VERSION, "starting; every", every / 1000, "seconds");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (stopping = true));
while (!stopping) {
  try {
    await cycle(work);
  } catch (error) {
    // A bad token will not fix itself: stop instead of knocking forever.
    if (error.status === 401) {
      console.error("Galatea refused this agent's token. Stopping.");
      process.exit(1);
    }
    log("cycle failed:", error.message);
  }
  if (process.env.AGENT_ONCE === "1") break;
  await new Promise((resolve) => setTimeout(resolve, every));
}
log("stopped");
