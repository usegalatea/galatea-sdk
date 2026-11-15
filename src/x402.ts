import { type Hex, type LocalAccount, getAddress, toHex } from "viem";
import type { Payer, PaymentRequirement } from "./rehearse.js";

const TRANSFER_WITH_AUTHORIZATION = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Pay Galatea's x402 requirements from a viem account (for example
 * `privateKeyToAccount(key)`): signs an EIP-3009 TransferWithAuthorization for
 * exactly the price, valid only as long as the requirement allows. You send
 * nothing on chain yourself; Galatea settles it and pays the gas.
 *
 * Needs `viem`, an optional peer dependency of this package.
 */
export function payWithAccount(account: LocalAccount): Payer {
  return async (requirement: PaymentRequirement) => {
    const match = /^eip155:(\d+)$/.exec(requirement.network);
    if (!match) throw new Error(`Cannot pay on network ${requirement.network}.`);
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: getAddress(account.address),
      to: getAddress(requirement.payTo),
      value: BigInt(requirement.maxAmountRequired),
      validAfter: BigInt(now - 30),
      validBefore: BigInt(now + Math.max(60, requirement.maxTimeoutSeconds)),
      nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex,
    };
    const signature = await account.signTypedData({
      domain: { name: requirement.extra.name, version: requirement.extra.version, chainId: Number(match[1]), verifyingContract: getAddress(requirement.asset) },
      types: TRANSFER_WITH_AUTHORIZATION,
      primaryType: "TransferWithAuthorization",
      message: authorization,
    });
    const payload = {
      x402Version: 1,
      scheme: requirement.scheme,
      network: requirement.network,
      payload: {
        signature,
        authorization: {
          ...authorization,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
        },
      },
    };
    return btoa(JSON.stringify(payload));
  };
}
