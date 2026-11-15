import { getAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { AgentClient, GalateaError, fingerprint, rehearse, sha256, verifyFingerprint } from "./index.js";
import type { PaymentRequirement } from "./rehearse.js";
import { payWithAccount } from "./x402.js";

const REPORT = { agentId: "api", pnl: -12_340_000n, verdict: "fail", reasons: ["Tried to empty the wallet."], refused: { "approval.unlimited": 1 }, intents: 14, allowed: 13 };
/** The fingerprint Galatea's own engine gives REPORT. */
const REPORT_HASH = "bdb9289d81dd73249a1e68bb6b33bf7302c2139db4b9c3a01812058d7360ee32";

describe("fingerprints", () => {
  it("are the same as the ones the site publishes", async () => {
    expect(await fingerprint(REPORT)).toBe(REPORT_HASH);
  });

  it("check against the exact text, or against the report", async () => {
    const hash = REPORT_HASH;
    expect(await verifyFingerprint(REPORT, hash)).toBe(true);
    expect(await verifyFingerprint({ ...REPORT, pnl: -12_340_001n }, hash)).toBe(false);
    expect(await verifyFingerprint("not the text", hash)).toBe(false);
  });
});

const requirement: PaymentRequirement = {
  scheme: "exact",
  network: "eip155:4663",
  maxAmountRequired: "50000",
  resource: "https://galatea.example/api/v1/rehearse",
  description: "One rehearsal",
  mimeType: "application/json",
  payTo: "0x3C38AFf75E62f635b38B1Af70F2Db0387680a94E",
  maxTimeoutSeconds: 120,
  asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  extra: { name: "Global Dollar", version: "1" },
};

// Hardhat's first public test key: it has never held real money.
const payer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

describe("x402 payments", () => {
  it("sign exactly the price, to the payee, for a short time", async () => {
    const header = await payWithAccount(payer)(requirement);
    const sent = JSON.parse(atob(header));
    const a = sent.payload.authorization;
    expect(sent.scheme).toBe("exact");
    expect(sent.network).toBe("eip155:4663");
    expect(a.value).toBe("50000");
    expect(getAddress(a.to)).toBe(getAddress(requirement.payTo));
    expect(Number(a.validBefore) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(121);
    const signer = await recoverTypedDataAddress({
      domain: { name: "Global Dollar", version: "1", chainId: 4663, verifyingContract: getAddress(requirement.asset) },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
      signature: sent.payload.signature,
    });
    expect(signer).toBe(payer.address);
  });

  it("pay when asked and send the request again", async () => {
    const seen: (string | null)[] = [];
    const fake: typeof fetch = async (_url, init) => {
      const paid = new Headers(init?.headers).get("x-payment");
      seen.push(paid);
      if (!paid) return Response.json({ x402Version: 1, error: "Payment required.", accepts: [requirement] }, { status: 402 });
      return new Response(JSON.stringify({ hash: "ab", fingerprinted: "{}", report: { verdict: "pass" }, steps: [] }), { headers: { "x-payment-response": "cmVjZWlwdA==" } });
    };
    const result = await rehearse({ baseUrl: "https://galatea.example/", intents: [{ kind: "call", target: "0xrouter", selector: "0x00" }], pay: payWithAccount(payer), fetch: fake });
    expect(seen[0]).toBeNull();
    expect(seen[1]).toBeTruthy();
    expect(result.receipt).toBe("cmVjZWlwdA==");
  });

  it("raise the requirement when there is no payer", async () => {
    const fake: typeof fetch = async () => Response.json({ accepts: [requirement] }, { status: 402 });
    await expect(rehearse({ baseUrl: "https://g.example", intents: [], fetch: fake })).rejects.toMatchObject({ status: 402 });
  });
});

describe("the agent client", () => {
  it("speaks for its agent and hands in the work's fingerprint", async () => {
    const calls: { url: string; auth: string | null; body: string | null }[] = [];
    const fake: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: (init?.body as string) ?? null });
      return Response.json({ ok: true });
    };
    const agent = new AgentClient("https://galatea.example", "thalia.sig", fake);
    const sent = await agent.deliver("job-2", "the answer");
    expect(sent).toBe(await sha256("the answer"));
    expect(calls[0].url).toBe("https://galatea.example/api/agent/v1/jobs/job-2/deliver");
    expect(calls[0].auth).toBe("Bearer thalia.sig");
    expect(JSON.parse(calls[0].body!)).toEqual({ deliverable: sent });
  });

  it("turns refusals into GalateaError with the server's words", async () => {
    const fake: typeof fetch = async () => Response.json({ error: "Only a living agent can take work." }, { status: 409 });
    const error = await new AgentClient("https://g.example", "t.s", fake).take("job-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GalateaError);
    expect((error as GalateaError).message).toBe("Only a living agent can take work.");
  });
});
