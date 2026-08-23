import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseActiveSystemConfig } from "@virtual/config";
import type { WebSocketEventLike, WebSocketLike } from "@virtual/market";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V3Runtime } from "../../apps/server/src/v3-runtime";

class FakeSocket implements WebSocketLike {
  readonly listeners = new Map<string, Array<(event: WebSocketEventLike) => void>>();

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: WebSocketEventLike) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {}

  emit(type: "open" | "message" | "error" | "close", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function book(symbol: string, id: number, mid: number) {
  return {
    stream: `${symbol.toLowerCase()}@bookTicker`,
    data: {
      u: id,
      s: symbol,
      b: (mid - mid * 0.0001).toFixed(8),
      B: "10",
      a: (mid + mid * 0.0001).toFixed(8),
      A: "10",
    },
  };
}

function trade(symbol: string, id: number, time: number) {
  return {
    stream: `${symbol.toLowerCase()}@aggTrade`,
    data: {
      e: "aggTrade",
      E: time,
      s: symbol,
      a: id,
      p: "1",
      q: "100",
      T: time,
      m: true,
    },
  };
}

function techFlowPage() {
  const item = {
    id: 3001,
    title: "全球贸易谈判暂停，主要经济体加征 50% 关税",
    abstract: "多国宣布同等幅度反制，全球贸易风险升级。",
    source: "金十",
    url: "https://example.com/macro",
    created_at: "2026-08-23T10:00:00.000Z",
    updated_at: "2026-08-23T10:00:00.000Z",
    category: { id: 1, name: "股市观察" },
    content_categories: [],
  };
  return `<html><script>self.__next_f.push(${JSON.stringify([
    1,
    `fixture:${JSON.stringify({ data: [item] })}`,
  ])})</script></html>`;
}

describe("v0.3 runtime composition", () => {
  it("connects exactly TechFlow and Binance, computes four conditions, and never touches a wallet", async () => {
    const config = parseActiveSystemConfig(
      JSON.parse(
        await readFile(new URL("../../config/default.json", import.meta.url), "utf8"),
      ) as unknown,
    );
    const directory = await mkdtemp(join(tmpdir(), "virtual-v3-runtime-"));
    temporaryDirectories.push(directory);
    let now = new Date("2026-08-23T10:00:00.000Z");
    const socket = new FakeSocket();
    const runtime = new V3Runtime(config, {
      now: () => now,
      cursorPath: join(directory, "cursor.json"),
      journalPath: join(directory, "shadow.jsonl"),
      techFlowFetch: async () => new Response(techFlowPage(), { status: 200 }),
      binanceSocketFactory: () => socket,
    });
    runtime.start();
    socket.emit("open");

    await vi.waitFor(() => {
      expect(runtime.newsAdapter().health().capabilityState).toBe("VERIFIED_CURRENT");
    });

    const baseline = {
      BTCUSDT: 100,
      ETHUSDT: 100,
      SOLUSDT: 100,
      VIRTUALUSDT: 1,
    };
    for (const [symbol, price] of Object.entries(baseline)) {
      socket.emit("message", JSON.stringify(book(symbol, 1, price)));
    }

    now = new Date("2026-08-23T10:01:01.000Z");
    const stressed = {
      BTCUSDT: 99.8,
      ETHUSDT: 99.7,
      SOLUSDT: 99.4,
      VIRTUALUSDT: 0.98,
    };
    let id = 2;
    for (const [symbol, price] of Object.entries(stressed)) {
      socket.emit("message", JSON.stringify(book(symbol, id, price)));
      socket.emit("message", JSON.stringify(trade(symbol, id, now.getTime())));
      id += 1;
    }
    const armed = runtime.snapshot();
    expect(armed.sell).toMatchObject({ stage: "NEWS_ARMED", passed: 3, output: "WATCH" });

    now = new Date("2026-08-23T10:01:04.000Z");
    const state = runtime.snapshot();
    expect(state).toMatchObject({
      schemaVersion: "3.0.0",
      source: "LIVE_TWO_SOURCE_RUNTIME",
      evidenceLevel: "VERIFIED_CURRENT",
      outputBasis: "CEX_REFERENCE",
      sources: {
        techflow: { sourceId: "techflow-public-newsletter" },
        binance: { sourceId: "binance-spot-public" },
      },
      sell: {
        stage: "SELL_READY",
        output: "SHADOW_CANDIDATE",
        passed: 4,
        required: 4,
        sellContext: "SHADOW_REFERENCE",
      },
    });
    expect(state.sell.conditions.map(({ state }) => state)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(state.market).toHaveLength(4);
    expect(state.boundaryNotice).toContain("未连接钱包或链");
    expect(JSON.stringify(state)).not.toMatch(/chainProfile|rpcEndpoint|dexQuote|walletAddress/i);
    expect(runtime.metrics()).toMatchObject({
      startedAt: "2026-08-23T10:00:00.000Z",
      elapsedMs: 64_000,
      requiredSoakMs: 3_600_000,
      soakStatus: "IN_PROGRESS",
      techflow: { successes: 1 },
      binance: { sourceId: "binance-spot-public" },
    });
    await runtime.stop();
    const records = (await readFile(join(directory, "shadow.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string });
    expect(records.some(({ kind }) => kind === "RUNTIME_START")).toBe(true);
    expect(records.some(({ kind }) => kind === "SHADOW_SELL_CREATED")).toBe(true);
    expect(records.at(-1)?.kind).toBe("RUNTIME_STOP");
  });
});
