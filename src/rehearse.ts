import { GalateaError, errorFrom, readJson } from "./errors.js";

/** One action an agent wants to take. Values are in dollars, as strings or numbers. */
export type Intent =
  | { kind: "swap"; venue: string; sell: string; buy: string; value: string | number }
  | { kind: "transfer"; to: string; token: string; value: string | number }
  | { kind: "approve"; spender: string; token: string; value: string | number | "unlimited" }
  | { kind: "call"; target: string; selector: string; value?: string | number };

/** What Galatea asks for when a request needs paying (x402, scheme "exact"). */
export interface PaymentRequirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

/** Turns a requirement into the value of the X-PAYMENT header. See `payWithAccount` in "galatea-sdk/x402". */
export type Payer = (requirement: PaymentRequirement) => Promise<string>;

export interface RehearsalResult {
  /** The report's fingerprint. */
  hash: string;
  /** The exact text that was hashed; check it with `verifyFingerprint`. */
  fingerprinted: string;
  report: {
    verdict: "pass" | "fail";
    reasons: string[];
    intents: number;
    allowed: number;
    pnl: string;
    maxDrawdownBps: number;
    criticalAttempts: number;
    [key: string]: unknown;
  };
  steps: { seq: number; at: number; allowed: boolean; rule: string | null; [key: string]: unknown }[];
  /** Base64 settlement proof from the X-PAYMENT-RESPONSE header, when it was paid. */
  receipt: string | null;
}

export interface RehearseOptions {
  /** Galatea's address, e.g. "https://galatea.example". */
  baseUrl: string;
  intents: Intent[];
  /** Pays when Galatea answers 402. Without it, a 402 is thrown as a GalateaError carrying the requirement. */
  pay?: Payer;
  fetch?: typeof fetch;
}

export interface RehearsalTerms {
  price: string;
  method: string;
  network: string;
  asset: string | null;
  /** False while payments are not switched on at that Galatea. */
  connected: boolean;
  policy: Record<string, unknown>;
}

const endpoint = (baseUrl: string) => `${baseUrl.replace(/\/$/, "")}/api/v1/rehearse`;

/** Price and rules of a rehearsal, read without paying. */
export async function rehearsalTerms(baseUrl: string, fetcher: typeof fetch = fetch): Promise<RehearsalTerms> {
  const response = await fetcher(endpoint(baseUrl));
  const body = await readJson(response);
  if (!response.ok) throw errorFrom(response, body);
  return body as RehearsalTerms;
}

/**
 * Rehearse an agent: send the actions it would take, get back which the
 * wallet refused, the report and its fingerprint. Pays with x402 if asked.
 */
export async function rehearse({ baseUrl, intents, pay, fetch: fetcher = fetch }: RehearseOptions): Promise<RehearsalResult> {
  const send = (payment?: string) =>
    fetcher(endpoint(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...(payment ? { "x-payment": payment } : {}) },
      body: JSON.stringify({ intents }),
    });

  let response = await send();
  if (response.status === 402) {
    const body = (await readJson(response)) as { accepts?: PaymentRequirement[] } | null;
    const requirement = body?.accepts?.[0];
    if (!requirement) throw errorFrom(response, body);
    if (!pay) throw new GalateaError(`Payment required: ${requirement.description}`, 402, body);
    response = await send(await pay(requirement));
  }
  const body = await readJson(response);
  if (!response.ok) throw errorFrom(response, body);
  return { ...(body as Omit<RehearsalResult, "receipt">), receipt: response.headers.get("x-payment-response") };
}
