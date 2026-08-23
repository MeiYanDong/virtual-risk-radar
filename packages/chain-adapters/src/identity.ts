import { known, timestamp, type Timestamp } from "@virtual/domain";
import type { ChainTransportAdapter } from "./transport";

const SELECTORS = {
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  name: "0x06fdde03",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
} as const;

function addressWord(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new TypeError("Invalid EVM address");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function decodeUint(hex: unknown): bigint {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) {
    throw new TypeError("eth_call did not return hex data");
  }
  return BigInt(hex === "0x" ? "0x0" : hex);
}

function decodeAbiString(hex: unknown): string {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new TypeError("String call did not return ABI hex data");
  }
  const body = hex.slice(2);
  if (body.length === 64) {
    return Buffer.from(body.replace(/(00)+$/, ""), "hex").toString("utf8");
  }
  if (body.length < 128) throw new TypeError("ABI string response is truncated");
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`));
  const start = offset + 64;
  return Buffer.from(body.slice(start, start + length * 2), "hex").toString("utf8");
}

async function ethCall(
  transport: ChainTransportAdapter,
  to: string,
  data: string,
): Promise<unknown> {
  return transport.call("eth_call", [{ to, data }, "latest"]);
}

export type Erc20IdentityEvidence = {
  chainId: string;
  tokenAddress: string;
  codePresent: boolean;
  decimals: number;
  symbol: string;
  name: string;
  latestBlock: string;
  observedAt: Timestamp;
  adapterId: string;
};

export async function readErc20Identity(input: {
  transport: ChainTransportAdapter;
  tokenAddress: string;
}): Promise<Erc20IdentityEvidence> {
  const tokenAddress = `0x${addressWord(input.tokenAddress).slice(-40)}`;
  const health = await input.transport.health();
  const [code, decimals, symbol, name] = await Promise.all([
    input.transport.call("eth_getCode", [tokenAddress, "latest"]),
    ethCall(input.transport, tokenAddress, SELECTORS.decimals),
    ethCall(input.transport, tokenAddress, SELECTORS.symbol),
    ethCall(input.transport, tokenAddress, SELECTORS.name),
  ]);
  if (typeof code !== "string") throw new TypeError("eth_getCode did not return hex data");
  const decimalValue = Number(decodeUint(decimals));
  if (!Number.isInteger(decimalValue) || decimalValue < 0 || decimalValue > 255) {
    throw new RangeError("ERC-20 decimals are outside uint8 range");
  }
  return {
    chainId: health.chainId,
    tokenAddress,
    codePresent: code !== "0x" && !/^0x0*$/.test(code),
    decimals: decimalValue,
    symbol: decodeAbiString(symbol),
    name: decodeAbiString(name),
    latestBlock: health.latestBlock,
    observedAt: health.observedAt,
    adapterId: input.transport.adapterId,
  };
}

export function verifyErc20Identity(
  evidence: Erc20IdentityEvidence,
  expected: { chainId: string; tokenAddress: string; decimals: number; symbol: string },
): { state: "PASS" | "FAIL"; reasons: string[]; observedAt: Timestamp } {
  const reasons: string[] = [];
  if (evidence.chainId !== expected.chainId) reasons.push("chain_id_mismatch");
  if (evidence.tokenAddress.toLowerCase() !== expected.tokenAddress.toLowerCase()) {
    reasons.push("token_address_mismatch");
  }
  if (!evidence.codePresent) reasons.push("token_code_missing");
  if (evidence.decimals !== expected.decimals) reasons.push("token_decimals_mismatch");
  if (evidence.symbol !== expected.symbol) reasons.push("token_symbol_mismatch");
  return {
    state: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    observedAt: evidence.observedAt,
  };
}

export async function readWalletErc20State(input: {
  transport: ChainTransportAdapter;
  tokenAddress: string;
  walletAddress: string;
  spenderAddress?: string;
}): Promise<{
  balanceAtomic: ReturnType<typeof known<string>>;
  allowanceAtomic: ReturnType<typeof known<string>> | undefined;
}> {
  const observedAt = timestamp(new Date());
  const balance = decodeUint(
    await ethCall(
      input.transport,
      input.tokenAddress,
      `${SELECTORS.balanceOf}${addressWord(input.walletAddress)}`,
    ),
  ).toString();
  const allowance =
    input.spenderAddress === undefined
      ? undefined
      : decodeUint(
          await ethCall(
            input.transport,
            input.tokenAddress,
            `${SELECTORS.allowance}${addressWord(input.walletAddress)}${addressWord(input.spenderAddress)}`,
          ),
        ).toString();
  return {
    balanceAtomic: known(balance, observedAt, [input.transport.adapterId]),
    allowanceAtomic:
      allowance === undefined
        ? undefined
        : known(allowance, observedAt, [input.transport.adapterId]),
  };
}
