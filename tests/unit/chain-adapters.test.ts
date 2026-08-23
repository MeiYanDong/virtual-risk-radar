import {
  assertReadOnlyRpcMethod,
  quoteIsolated,
  ReadOnlyJsonRpcTransport,
  readErc20Identity,
  readWalletErc20State,
  verifyErc20Identity,
  type ChainTransportAdapter,
  type QuoteAdapter,
} from "@virtual/chain";
import { decimal, known, timestamp, type ChainQuote } from "@virtual/domain";
import { describe, expect, it } from "vitest";

const NOW = timestamp("2026-08-22T08:00:00.000Z");
const dynamicString = (value: string): string => {
  const bytes = Buffer.from(value).toString("hex");
  return `0x${"20".padStart(64, "0")}${value.length.toString(16).padStart(64, "0")}${bytes.padEnd(64, "0")}`;
};

class FakeTransport implements ChainTransportAdapter {
  readonly adapterId = "fake-read-only";

  async health() {
    return { chainId: "8453", latestBlock: "123", latencyMs: 1, observedAt: NOW };
  }

  async call(method: Parameters<ChainTransportAdapter["call"]>[0], params: unknown[]) {
    if (method === "eth_getCode") return "0x6000";
    if (method !== "eth_call") throw new Error(`Unexpected ${method}`);
    const call = params[0] as { data: string };
    if (call.data === "0x313ce567") return `0x${"12".padStart(64, "0")}`;
    if (call.data === "0x95d89b41") return dynamicString("VIRTUAL");
    if (call.data === "0x06fdde03") return dynamicString("Virtuals Protocol");
    if (call.data.startsWith("0x70a08231")) return `0x${"64".padStart(64, "0")}`;
    if (call.data.startsWith("0xdd62ed3e")) return `0x${"32".padStart(64, "0")}`;
    throw new Error("Unexpected call data");
  }
}

function chainQuote(chainProfileId: string): ChainQuote {
  return {
    quoteId: `quote-${chainProfileId}`,
    chainProfileId,
    walletProfileId: "wallet",
    side: "SELL_VIRTUAL",
    amountIn: decimal("1"),
    expectedOut: decimal("0.7"),
    minimumOut: decimal("0.69"),
    priceImpactBps: decimal("10"),
    totalCostPct: decimal("0.01"),
    routeFees: decimal("0.001"),
    estimatedGas: decimal("0.0001"),
    gasCurrency: "ETH",
    effectivePrice: decimal("0.7"),
    routeId: "fixture",
    blockNumber: "1",
    observedAt: NOW,
    expiresAt: timestamp("2026-08-22T08:00:05.000Z"),
    simulationState: "UNKNOWN",
    identityState: "PASS",
    routeState: "PASS",
    walletBalanceState: "PASS",
    evidenceIds: ["fixture"],
  };
}

describe("read-only chain adapters", () => {
  it("has a strict RPC allowlist with no signing or broadcast method", () => {
    expect(assertReadOnlyRpcMethod("eth_call")).toBe("eth_call");
    expect(() => assertReadOnlyRpcMethod("eth_sendRawTransaction")).toThrow();
    expect(() => assertReadOnlyRpcMethod("personal_sign")).toThrow();
  });

  it("checks live transport health through read-only JSON-RPC responses", async () => {
    const rpcFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const requests = JSON.parse(String(init?.body)) as Array<{ id: number; method: string }>;
      return new Response(
        JSON.stringify(
          requests.map((request) => ({
            jsonrpc: "2.0",
            id: request.id,
            result: request.method === "eth_chainId" ? "0x2105" : "0x7b",
          })),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const transport = new ReadOnlyJsonRpcTransport({
      adapterId: "test-rpc",
      endpoint: "https://rpc.example.test/key?secret=redacted",
      fetchImplementation: rpcFetch,
    });
    await expect(transport.health()).resolves.toMatchObject({
      chainId: "8453",
      latestBlock: "123",
    });
    expect(
      () => new ReadOnlyJsonRpcTransport({ adapterId: "bad", endpoint: "ftp://example.test" }),
    ).toThrow("HTTP or HTTPS");
  });

  it("rejects unsafe transport limits and invalid batch sizes before network access", async () => {
    expect(
      () =>
        new ReadOnlyJsonRpcTransport({
          adapterId: "bad-attempts",
          endpoint: "https://rpc.example.test",
          maximumAttempts: 0,
        }),
    ).toThrow("maximumAttempts");
    expect(
      () =>
        new ReadOnlyJsonRpcTransport({
          adapterId: "bad-delay",
          endpoint: "https://rpc.example.test",
          minimumRetryDelayMs: -1,
        }),
    ).toThrow("minimumRetryDelayMs");
    const transport = new ReadOnlyJsonRpcTransport({
      adapterId: "bad-batches",
      endpoint: "https://rpc.example.test",
      maximumBatchSize: 1,
    });
    expect(
      () =>
        new ReadOnlyJsonRpcTransport({
          adapterId: "bad-batch-limit",
          endpoint: "https://rpc.example.test",
          maximumBatchSize: 0,
        }),
    ).toThrow("maximumBatchSize");
    await expect(transport.batchCall([])).rejects.toThrow("between 1 and 50");
    await expect(
      transport.batchCall(
        Array.from({ length: 51 }, () => ({ method: "eth_call" as const, params: [] })),
      ),
    ).rejects.toThrow("between 1 and 50");
  });

  it("rejects malformed health and single-call responses instead of inventing values", async () => {
    const malformedHealth = new ReadOnlyJsonRpcTransport({
      adapterId: "malformed-health",
      endpoint: "https://rpc.example.test",
      fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
        const requests = JSON.parse(String(init?.body)) as Array<{ id: number; method: string }>;
        return Response.json(
          requests.map(({ id, method }) => ({
            jsonrpc: "2.0",
            id,
            result: method === "eth_chainId" ? 8453 : "0x7b",
          })),
        );
      }) as typeof fetch,
    });
    await expect(malformedHealth.health()).rejects.toThrow("not hexadecimal text");

    const missingResult = new ReadOnlyJsonRpcTransport({
      adapterId: "missing-result",
      endpoint: "https://rpc.example.test",
      fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { id: number };
        return Response.json({ jsonrpc: "2.0", id: request.id });
      }) as typeof fetch,
    });
    await expect(missingResult.call("eth_chainId", [])).rejects.toThrow("has no result");
  });

  it("classifies HTTP and JSON-RPC transport failures without returning an old value", async () => {
    const httpFailure = new ReadOnlyJsonRpcTransport({
      adapterId: "http-failure",
      endpoint: "https://rpc.example.test",
      fetchImplementation: (async () => new Response("down", { status: 503 })) as typeof fetch,
    });
    await expect(httpFailure.call("eth_chainId", [])).rejects.toThrow("HTTP 503");

    const rpcFailure = new ReadOnlyJsonRpcTransport({
      adapterId: "rpc-failure",
      endpoint: "https://rpc.example.test",
      fetchImplementation: (async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "busy" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    await expect(rpcFailure.call("eth_chainId", [])).rejects.toThrow("-32000");
  });

  it("redacts RPC credentials from transport errors", async () => {
    const transport = new ReadOnlyJsonRpcTransport({
      adapterId: "redaction",
      endpoint: "https://rpc.example.test/base?apiKey=do-not-log-this",
      maximumAttempts: 1,
      fetchImplementation: (async () => Promise.reject(new Error("network down"))) as typeof fetch,
    });
    const error = await transport.call("eth_chainId", []).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("https://rpc.example.test/base");
    expect((error as Error).message).not.toContain("do-not-log-this");
  });

  it("serializes public RPC reads and retries a bounded 429 without hiding the receipt", async () => {
    let active = 0;
    let maximumActive = 0;
    let attempts = 0;
    const transport = new ReadOnlyJsonRpcTransport({
      adapterId: "bounded-retry",
      endpoint: "https://rpc.example.test",
      maximumAttempts: 2,
      minimumRetryDelayMs: 0,
      fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        attempts += 1;
        await Promise.resolve();
        active -= 1;
        if (attempts === 1) return new Response("rate limited", { status: 429 });
        const request = JSON.parse(String(init?.body)) as { id: number };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    await expect(
      Promise.all([transport.call("eth_chainId", []), transport.call("eth_chainId", [])]),
    ).resolves.toEqual(["0x2105", "0x2105"]);
    expect(attempts).toBe(3);
    expect(maximumActive).toBe(1);
  });

  it("validates every method and preserves request order in a read-only RPC batch", async () => {
    const transport = new ReadOnlyJsonRpcTransport({
      adapterId: "batch",
      endpoint: "https://rpc.example.test",
      fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
        const requests = JSON.parse(String(init?.body)) as Array<{ id: number; method: string }>;
        return new Response(
          JSON.stringify(
            [...requests]
              .reverse()
              .map(({ id, method }) => ({ jsonrpc: "2.0", id, result: method })),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    await expect(
      transport.batchCall([
        { method: "eth_chainId", params: [] },
        { method: "eth_blockNumber", params: [] },
      ]),
    ).resolves.toEqual(["eth_chainId", "eth_blockNumber"]);
    await expect(
      transport.batchCall([{ method: "eth_sendRawTransaction" as "eth_call", params: [] }]),
    ).rejects.toThrow();
  });

  it("chunks large read batches without reordering results", async () => {
    const batchSizes: number[] = [];
    const transport = new ReadOnlyJsonRpcTransport({
      adapterId: "chunked-batch",
      endpoint: "https://rpc.example.test",
      maximumBatchSize: 2,
      minimumRetryDelayMs: 0,
      fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
        const requests = JSON.parse(String(init?.body)) as Array<{ id: number; method: string }>;
        batchSizes.push(requests.length);
        return Response.json(
          requests.map(({ id, method }) => ({ jsonrpc: "2.0", id, result: method })),
        );
      }) as typeof fetch,
    });
    await expect(
      transport.batchCall([
        { method: "eth_chainId", params: [] },
        { method: "eth_blockNumber", params: [] },
        { method: "eth_getCode", params: [] },
        { method: "eth_call", params: [] },
        { method: "eth_getBalance", params: [] },
      ]),
    ).resolves.toEqual([
      "eth_chainId",
      "eth_blockNumber",
      "eth_getCode",
      "eth_call",
      "eth_getBalance",
    ]);
    expect(batchSizes).toEqual([2, 2, 1]);
  });

  it("reads and hard-verifies chain, code, address, decimals and symbol", async () => {
    const tokenAddress = "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
    const evidence = await readErc20Identity({
      transport: new FakeTransport(),
      tokenAddress,
    });
    expect(
      verifyErc20Identity(evidence, {
        chainId: "8453",
        tokenAddress,
        decimals: 18,
        symbol: "VIRTUAL",
      }),
    ).toMatchObject({ state: "PASS", reasons: [] });
    expect(
      verifyErc20Identity(evidence, {
        chainId: "8453",
        tokenAddress,
        decimals: 6,
        symbol: "VIRTUAL",
      }),
    ).toMatchObject({ state: "FAIL", reasons: ["token_decimals_mismatch"] });
  });

  it("reads wallet balance and allowance without a write method", async () => {
    const state = await readWalletErc20State({
      transport: new FakeTransport(),
      tokenAddress: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
      walletAddress: "0x1111111111111111111111111111111111111111",
      spenderAddress: "0x2222222222222222222222222222222222222222",
    });
    expect(state.balanceAtomic).toMatchObject({ state: "KNOWN", value: "100" });
    expect(state.allowanceAtomic).toMatchObject({ state: "KNOWN", value: "50" });
  });

  it("isolates quote success, failure, and latency by chain", async () => {
    const adapter = (chainProfileId: string, behavior: "PASS" | "FAIL"): QuoteAdapter => ({
      adapterId: `adapter-${chainProfileId}`,
      chainProfileId,
      async quote(request) {
        if (behavior === "FAIL") throw new Error("provider down");
        return known(chainQuote(chainProfileId), request.requestedAt, ["fixture"]);
      },
    });
    const requests = new Map([
      [
        "base",
        { chainProfileId: "base", side: "SELL_VIRTUAL" as const, amountIn: "1", requestedAt: NOW },
      ],
      [
        "robinhood",
        {
          chainProfileId: "robinhood",
          side: "SELL_VIRTUAL" as const,
          amountIn: "1",
          requestedAt: NOW,
        },
      ],
    ]);
    const results = await quoteIsolated(
      [adapter("base", "PASS"), adapter("robinhood", "FAIL")],
      requests,
    );
    expect(results.get("base")?.state).toBe("KNOWN");
    expect(results.get("robinhood")?.state).toBe("ERROR");
  });
});
