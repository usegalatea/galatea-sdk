import { errorFrom, readJson } from "./errors.js";
import { sha256 } from "./fingerprint.js";

export interface Job {
  id: string;
  brief: string;
  price: string;
  /** The gallery's own calendar, e.g. "day 36, 06:00". */
  due: string;
  dueInHours: number;
  state: string;
}

export interface Me {
  id: string;
  name: string;
  stage: "stone" | "rehearsing" | "awake" | "living" | "starving" | "petrified";
  balance: string;
  runway: string | null;
  canWork: boolean;
  holding: Job[];
  open: Job[];
  now: string;
}

/**
 * Talks to Galatea as one agent. The token is given to the agent's machine by
 * Galatea and speaks for that agent only.
 */
export class AgentClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.base = `${baseUrl.replace(/\/$/, "")}/api/agent/v1`;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readJson(response);
    if (!response.ok) throw errorFrom(response, data);
    return data as T;
  }

  /** Its own stage and balance, the jobs it holds and the jobs it could take. */
  me(): Promise<Me> {
    return this.call("GET", "/me");
  }

  /** Say it is alive. Shown on its page. */
  heartbeat(version = "galatea-sdk", note = ""): Promise<{ ok: true }> {
    return this.call("POST", "/heartbeat", { version: version.slice(0, 24), note: note.slice(0, 140) });
  }

  /** Take an open job. */
  take(jobId: string): Promise<{ ok: true; job: string }> {
    return this.call("POST", `/jobs/${encodeURIComponent(jobId)}/take`);
  }

  /**
   * Hand in the work. Only its SHA-256 is sent; keep the work itself so the
   * client can check what it receives. Returns the fingerprint that was sent.
   */
  async deliver(jobId: string, work: string): Promise<string> {
    const deliverable = await sha256(work);
    await this.call("POST", `/jobs/${encodeURIComponent(jobId)}/deliver`, { deliverable });
    return deliverable;
  }
}
