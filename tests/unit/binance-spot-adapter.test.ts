import {
  BinanceSpotAdapter,
  BinanceSpotStreamProcessor,
  V3MarketWindow,
  normalizeBinanceSpotMessage,
  type WebSocketEventLike,
  type WebSocketLike,
} from "@virtual/market";
import { timestamp } from "@virtual/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "VIRTUALUSDT"] as const;
const NOW = timestamp("2026-08-23T23:59:59.900Z");

function aggTrade(
  symbol: (typeof SYMBOLS)[number],
  id: number,
  maker = true,
  time = Date.parse(NOW),
) {
  return {
    stream: `${symbol.toLowerCase()}@aggTrade`,
    data: {
      e: "aggTrade",
      E: time,
      s: symbol,
      a: id,
      p: symbol === "VIRTUALUSDT" ? "0.75" : "100",
      q: "2",
      f: id,
      l: id,
      T: time,
      m: maker,
      M: true,
    },
  };
}

function bookTicker(symbol: (typeof SYMBOLS)[number], id: number, bid = "99", ask = "101") {
  return {
    stream: `${symbol.toLowerCase()}@bookTicker`,
    data: { u: id, s: symbol, b: bid, B: "2", a: ask, A: "3" },
  };
}

class FakeSocket implements WebSocketLike {
  readonly listeners = new Map<string, Array<(event: WebSocketEventLike) => void>>();
  closed = false;

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: WebSocketEventLike) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: "open" | "message" | "error" | "close", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Binance Spot normalization", () => {
  it.each([
    ["BTCUSDT", "BTC"],
    ["ETHUSDT", "ETH"],
    ["SOLUSDT", "SOL"],
    ["VIRTUALUSDT", "VIRTUAL"],
  ] as const)("normalizes %s aggTrade without a second venue", (symbol, asset) => {
    const normalized = normalizeBinanceSpotMessage(aggTrade(symbol, 42), NOW);
    expect(normalized.tick).toMatchObject({
      kind: "AGG_TRADE",
      asset,
      symbol,
      quoteNotional: symbol === "VIRTUALUSDT" ? "1.5" : "200",
    });
  });

  it("maps buyer-maker to taker SELL and taker-buyer to BUY", () => {
    expect(normalizeBinanceSpotMessage(aggTrade("VIRTUALUSDT", 1, true), NOW).tick).toMatchObject({
      takerSide: "SELL",
    });
    expect(normalizeBinanceSpotMessage(aggTrade("VIRTUALUSDT", 2, false), NOW).tick).toMatchObject({
      takerSide: "BUY",
    });
  });

  it("uses the received timestamp for bookTicker and computes the exact midpoint", () => {
    expect(normalizeBinanceSpotMessage(bookTicker("BTCUSDT", 9), NOW).tick).toMatchObject({
      kind: "BOOK_TICKER",
      eventTime: NOW,
      bidPrice: "99",
      askPrice: "101",
      midPrice: "100",
    });
  });

  it("keeps UTC ordering across midnight", () => {
    const afterMidnight = Date.parse("2026-08-24T00:00:00.050Z");
    expect(
      normalizeBinanceSpotMessage(
        aggTrade("BTCUSDT", 2, false, afterMidnight),
        timestamp("2026-08-24T00:00:00.100Z"),
      ).tick.eventTime,
    ).toBe("2026-08-24T00:00:00.050Z");
  });
});

describe("Binance Spot deduplication, ordering, gaps, and freshness", () => {
  it("discards duplicates and out-of-order data while surfacing an unfilled aggTrade gap", () => {
    const processor = new BinanceSpotStreamProcessor({
      freshnessMs: 5_000,
      endpoint: "wss://data-stream.binance.vision/stream",
    });
    expect(processor.ingest(aggTrade("VIRTUALUSDT", 10), NOW).state).toBe("ACCEPTED");
    expect(processor.ingest(aggTrade("VIRTUALUSDT", 10), NOW).state).toBe("DUPLICATE");
    expect(processor.ingest(aggTrade("VIRTUALUSDT", 9), NOW).state).toBe("OUT_OF_ORDER");
    expect(processor.ingest(aggTrade("VIRTUALUSDT", 13), NOW)).toMatchObject({
      state: "ACCEPTED",
      gap: "VIRTUALUSDT:aggTrade:11-12",
    });
    expect(processor.gaps()).toEqual(["VIRTUALUSDT:aggTrade:11-12"]);
  });

  it("isolates one stale symbol instead of marking old values fresh", () => {
    const processor = new BinanceSpotStreamProcessor({
      freshnessMs: 5_000,
      endpoint: "wss://data-stream.binance.vision/stream",
    });
    processor.markConnecting(NOW);
    processor.markConnected(NOW);
    for (const symbol of SYMBOLS) {
      processor.ingest(aggTrade(symbol, 1), NOW);
      processor.ingest(bookTicker(symbol, 1), NOW);
    }
    expect(processor.health(NOW).status).toBe("HEALTHY");

    const later = timestamp("2026-08-24T00:00:06.000Z");
    for (const symbol of SYMBOLS.filter((candidate) => candidate !== "VIRTUALUSDT")) {
      processor.ingest(aggTrade(symbol, 2, false, Date.parse(later)), later);
      processor.ingest(bookTicker(symbol, 2), later);
    }
    expect(processor.freshnessByStream(later)).toMatchObject({
      "VIRTUALUSDT:aggTrade": "STALE",
      "VIRTUALUSDT:bookTicker": "STALE",
      "BTCUSDT:aggTrade": "FRESH",
    });
    expect(processor.health(later).status).toBe("STALE");
  });

  it("keeps a gap visible for the affected decision window, then expires only its active impact", () => {
    const processor = new BinanceSpotStreamProcessor({
      freshnessMs: 5_000,
      gapImpactMs: 60_000,
      endpoint: "wss://data-stream.binance.vision/stream",
    });
    processor.markConnected(NOW);
    for (const symbol of SYMBOLS) {
      processor.ingest(aggTrade(symbol, 10), NOW);
      processor.ingest(bookTicker(symbol, 10), NOW);
    }
    processor.ingest(aggTrade("VIRTUALUSDT", 13), NOW);
    expect(processor.gaps(NOW)).toEqual(["VIRTUALUSDT:aggTrade:11-12"]);

    const later = timestamp("2026-08-24T00:01:00.001Z");
    for (const symbol of SYMBOLS) {
      const id = symbol === "VIRTUALUSDT" ? 14 : 11;
      processor.ingest(aggTrade(symbol, id, false, Date.parse(later)), later);
      processor.ingest(bookTicker(symbol, 11), later);
    }
    expect(processor.gaps(later)).toEqual([]);
    expect(processor.health(later)).toMatchObject({ status: "HEALTHY", gaps: 1 });
    expect(processor.metrics(later)).toMatchObject({
      totalGapEvents: 1,
      activeGaps: [],
      streams: {
        "VIRTUALUSDT:aggTrade": {
          accepted: 3,
          gapEvents: 1,
          missingAggregateIds: 2,
          sequenceCompleteness: 0.6,
          latencyBasis: "EXCHANGE_EVENT_TIME",
        },
      },
    });
  });
});

describe("Binance Spot rolling market features", () => {
  it("keeps a high-frequency rolling window bounded after old ticks expire", () => {
    const window = new V3MarketWindow({ rollingWindowSeconds: 60, freshnessMs: 5_000 });
    const start = Date.parse("2026-08-23T10:00:00.000Z");
    for (let index = 0; index < 10_000; index += 1) {
      const receivedAt = timestamp(new Date(start + index * 10));
      window.add(normalizeBinanceSpotMessage(bookTicker("BTCUSDT", index + 1), receivedAt).tick);
    }
    expect(window.size()).toBeLessThanOrEqual(6_001);
    const latest = window.snapshot(timestamp(new Date(start + 99_990)));
    expect(latest.assets.BTC).toMatchObject({ freshness: "FRESH", price: "100" });
  });

  it("computes four 60-second returns, VIRTUAL excess return, and taker notional ratio", () => {
    const window = new V3MarketWindow({ rollingWindowSeconds: 600, freshnessMs: 5_000 });
    const baseline = timestamp("2026-08-23T10:00:00.000Z");
    const current = timestamp("2026-08-23T10:01:00.000Z");
    for (const symbol of SYMBOLS) {
      window.add(normalizeBinanceSpotMessage(bookTicker(symbol, 1), baseline).tick);
    }
    const currentBooks = [
      bookTicker("BTCUSDT", 2, "99.7", "99.9"),
      bookTicker("ETHUSDT", 2, "99.6", "99.8"),
      bookTicker("SOLUSDT", 2, "98.9", "99.1"),
      bookTicker("VIRTUALUSDT", 2, "97.9", "98.1"),
    ];
    for (const book of currentBooks) {
      window.add(normalizeBinanceSpotMessage(book, current).tick);
    }
    window.add(
      normalizeBinanceSpotMessage(aggTrade("VIRTUALUSDT", 1, true, Date.parse(current)), current)
        .tick,
    );
    window.add(
      normalizeBinanceSpotMessage(aggTrade("VIRTUALUSDT", 2, false, Date.parse(current)), current)
        .tick,
    );

    const snapshot = window.snapshot(current);
    expect(snapshot.assets).toMatchObject({
      BTC: { return60s: "-0.002", freshness: "FRESH" },
      ETH: { return60s: "-0.003", freshness: "FRESH" },
      SOL: { return60s: "-0.01", freshness: "FRESH" },
      VIRTUAL: { return60s: "-0.02", freshness: "FRESH" },
    });
    expect(snapshot.virtualExcessReturn60s).toBe("-0.015");
    expect(snapshot.virtualTakerBuyNotional60s).toBe("1.5");
    expect(snapshot.virtualTakerSellNotional60s).toBe("1.5");
    expect(snapshot.virtualTakerBuySellRatio60s).toBe("1");
    expect(snapshot.virtualOrderFlowState).toBe("KNOWN");
  });

  it("turns VIRTUAL order flow UNKNOWN-equivalent when its active window contains a gap", () => {
    const window = new V3MarketWindow({ rollingWindowSeconds: 600, freshnessMs: 5_000 });
    window.add(normalizeBinanceSpotMessage(aggTrade("VIRTUALUSDT", 3), NOW).tick);
    const snapshot = window.snapshot(NOW, ["VIRTUALUSDT:aggTrade:1-2"]);
    expect(snapshot.virtualOrderFlowState).toBe("GAP");
    expect(snapshot.virtualTakerBuyNotional60s).toBeNull();
    expect(snapshot.virtualTakerSellNotional60s).toBeNull();
    expect(snapshot.virtualTakerBuySellRatio60s).toBeNull();
  });
});

describe("Binance Spot WebSocket lifecycle", () => {
  it("builds one combined stream for exactly four symbols and reconnects with bounded backoff", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const adapter = new BinanceSpotAdapter({
      websocketBaseUrl: "wss://data-stream.binance.vision/stream",
      freshnessMs: 5_000,
      reconnectMinimumMs: 1_000,
      reconnectMaximumMs: 30_000,
      random: () => 0.5,
      now: () => new Date(NOW),
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    expect(adapter.url()).toBe(
      "wss://data-stream.binance.vision/stream?streams=btcusdt@aggTrade/btcusdt@bookTicker/ethusdt@aggTrade/ethusdt@bookTicker/solusdt@aggTrade/solusdt@bookTicker/virtualusdt@aggTrade/virtualusdt@bookTicker",
    );
    adapter.start();
    sockets[0]?.emit("open");
    sockets[0]?.emit("message", JSON.stringify(aggTrade("VIRTUALUSDT", 1)));
    expect(adapter.processor.latestTicks()).toHaveLength(1);
    sockets[0]?.emit("close");
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    expect(adapter.processor.health(NOW).reconnects).toBe(1);
    adapter.stop();
  });

  it("fails visibly on malformed messages without accepting a tick", () => {
    const socket = new FakeSocket();
    const adapter = new BinanceSpotAdapter({
      websocketBaseUrl: "wss://data-stream.binance.vision/stream",
      freshnessMs: 5_000,
      reconnectMinimumMs: 1_000,
      reconnectMaximumMs: 30_000,
      now: () => new Date(NOW),
      socketFactory: () => socket,
    });
    adapter.start();
    socket.emit("open");
    socket.emit("message", JSON.stringify({ stream: "unknown", data: { nope: true } }));
    expect(adapter.health()).toMatchObject({
      status: "ERROR",
      errorCode: "WEBSOCKET_DISCONNECTED",
    });
    expect(adapter.processor.latestTicks()).toHaveLength(0);
    adapter.stop();
  });
});
