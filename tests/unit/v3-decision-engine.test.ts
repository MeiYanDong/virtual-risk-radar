import { readFileSync } from "node:fs";
import { parseActiveSystemConfig } from "@virtual/config";
import { V3DecisionEngine } from "@virtual/decision";
import {
  V3SourceHealthSchema,
  decimal,
  timestamp,
  type Asset,
  type Timestamp,
  type V3NewsItem,
  type V3SourceHealth,
} from "@virtual/domain";
import type { V3MarketFeatureSnapshot } from "@virtual/market";
import { normalizeTechFlowItem, type RawTechFlowItem } from "@virtual/news";
import { describe, expect, it } from "vitest";

const config = parseActiveSystemConfig(
  JSON.parse(readFileSync(new URL("../../config/default.json", import.meta.url), "utf8")),
);
const T0 = timestamp("2026-08-23T10:00:00.000Z");

function at(seconds: number): Timestamp {
  return timestamp(new Date(Date.parse(T0) + seconds * 1_000));
}

function health(
  source: "NEWS" | "MARKET",
  status: V3SourceHealth["status"] = "HEALTHY",
  observedAt: Timestamp = T0,
): V3SourceHealth {
  return V3SourceHealthSchema.parse({
    sourceId: source === "NEWS" ? "techflow-public-newsletter" : "binance-spot-public",
    label: source === "NEWS" ? "TechFlow 7×24h" : "Binance Spot",
    category: source,
    capabilityState: "VERIFIED_CURRENT",
    status,
    transport: source === "NEWS" ? "PUBLIC_WEBPAGE" : "SPOT_WEBSOCKET",
    endpoint:
      source === "NEWS"
        ? "https://www.techflowpost.com/newsletter"
        : "wss://data-stream.binance.vision/stream",
    lastAttemptAt: observedAt,
    lastSuccessAt: observedAt,
    dataAgeMs: 0,
    messagesReceived: 100,
    uniqueItems: 100,
    duplicates: 0,
    gaps: 0,
    reconnects: 0,
    errorCode: status === "ERROR" ? "SOURCE_ERROR" : null,
    reason: status,
    evidenceIds: [`${source.toLowerCase()}-health`],
  });
}

function macro(
  receivedAt: Timestamp = T0,
  id = 100,
  sourceOccurredAt: Timestamp = receivedAt,
): V3NewsItem {
  const item: RawTechFlowItem = {
    id,
    title: "美国对主要贸易伙伴加征 50% 关税，贸易谈判暂停",
    abstract: "美国宣布加征 50% 关税，对方将同等幅度反制，全球贸易风险升级。",
    source: "金十",
    url: "https://example.com/macro",
    created_at: sourceOccurredAt,
    updated_at: sourceOccurredAt,
    category: { id: 1, name: "股市观察" },
    content_categories: [],
  };
  return normalizeTechFlowItem({
    item,
    receivedAt,
    accessedAt: receivedAt,
    revision: 0,
    bodyExcerptCharacters: 600,
  });
}

function market(
  asOf: Timestamp,
  overrides: {
    returns?: Partial<Record<Asset, string | null>>;
    prices?: Partial<Record<Asset, string | null>>;
    excess?: string | null;
    ratio?: string | null;
    flowState?: V3MarketFeatureSnapshot["virtualOrderFlowState"];
    freshness?: Partial<Record<Asset, "FRESH" | "STALE" | "UNKNOWN">>;
  } = {},
): V3MarketFeatureSnapshot {
  const defaults: Record<Asset, { price: string; return60s: string }> = {
    BTC: { price: "100", return60s: "-0.002" },
    ETH: { price: "100", return60s: "-0.003" },
    SOL: { price: "100", return60s: "-0.006" },
    VIRTUAL: { price: "1", return60s: "-0.01" },
  };
  const assets = Object.fromEntries(
    (Object.keys(defaults) as Asset[]).map((asset) => {
      const price =
        overrides.prices?.[asset] === undefined ? defaults[asset].price : overrides.prices[asset];
      const return60s =
        overrides.returns?.[asset] === undefined
          ? defaults[asset].return60s
          : overrides.returns[asset];
      return [
        asset,
        {
          asset,
          symbol: `${asset}USDT`,
          price: price === null ? null : decimal(price),
          return60s: return60s === null ? null : decimal(return60s),
          dataAgeMs: 100,
          freshness: overrides.freshness?.[asset] ?? "FRESH",
          latestEvidenceId: `${asset.toLowerCase()}-book`,
        },
      ];
    }),
  ) as V3MarketFeatureSnapshot["assets"];
  return {
    asOf,
    assets,
    virtualExcessReturn60s:
      overrides.excess === null ? null : decimal(overrides.excess ?? "-0.006333333333"),
    virtualTakerBuyNotional60s: overrides.flowState === "GAP" ? null : decimal("500"),
    virtualTakerSellNotional60s: overrides.flowState === "GAP" ? null : decimal("1000"),
    virtualTakerBuySellRatio60s:
      overrides.flowState === "GAP" || overrides.ratio === null
        ? null
        : decimal(overrides.ratio ?? "0.5"),
    virtualOrderFlowState: overrides.flowState ?? "KNOWN",
    virtualOrderFlowCoverage: decimal("1"),
    virtualOrderFlowAgeMs: 100,
    gaps: overrides.flowState === "GAP" ? ["VIRTUALUSDT:aggTrade:11-12"] : [],
    evidenceIds: ["market-window"],
  };
}

function input(
  now: Timestamp,
  newsItems: V3NewsItem[],
  marketSnapshot: V3MarketFeatureSnapshot,
  options: { newsStatus?: V3SourceHealth["status"]; marketStatus?: V3SourceHealth["status"] } = {},
) {
  return {
    now,
    newsItems,
    newsHealth: health("NEWS", options.newsStatus ?? "HEALTHY", now),
    marketHealth: health("MARKET", options.marketStatus ?? "HEALTHY", now),
    market: marketSnapshot,
  };
}

function recoveryMarket(now: Timestamp, price = "1.1"): V3MarketFeatureSnapshot {
  return market(now, {
    returns: { BTC: "0.001", ETH: "0.001", SOL: "0.002", VIRTUAL: "0.012" },
    prices: { BTC: "101", ETH: "101", SOL: "101", VIRTUAL: price },
    excess: "0.010666666667",
    ratio: "1.2",
  });
}

describe("v0.3 four-condition Sell model", () => {
  it("allows TechFlow alone to arm news but never to produce SELL_READY", () => {
    const engine = new V3DecisionEngine(config);
    const missingMarket = market(T0, {
      returns: { BTC: null, ETH: null, SOL: null, VIRTUAL: null },
      prices: { BTC: null, ETH: null, SOL: null, VIRTUAL: null },
      excess: null,
      ratio: null,
      flowState: "NO_TRADES",
      freshness: { BTC: "UNKNOWN", ETH: "UNKNOWN", SOL: "UNKNOWN", VIRTUAL: "UNKNOWN" },
    });
    const result = engine.evaluate(input(T0, [macro()], missingMarket));
    expect(result.sell.conditions[0]?.state).toBe("PASS");
    expect(result.sell.stage).toBe("NEWS_ARMED");
    expect(result.sell.output).toBe("WATCH");
    expect(result.shadowSellCreated).toBeNull();
  });

  it("does not re-arm an expired headline merely because a cold-start received it now", () => {
    const engine = new V3DecisionEngine(config);
    const now = at(7_201);
    const result = engine.evaluate(input(now, [macro(now, 102, T0)], market(now)));
    expect(result.sell.conditions[0]).toMatchObject({ state: "FAIL" });
    expect(result.sell.stage).not.toBe("NEWS_ARMED");
    expect(result.sell.stage).not.toBe("SELL_READY");
  });

  it("keeps ordinary Binance-only stress at MARKET_ARMED because the fallback is not calibrated", () => {
    const engine = new V3DecisionEngine(config);
    engine.evaluate(input(T0, [], market(T0)));
    const result = engine.evaluate(input(at(3), [], market(at(3))));
    expect(result.sell.conditions.map(({ state }) => state)).toEqual([
      "FAIL",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(result.sell.stage).toBe("MARKET_ARMED");
    expect(result.sell.extremeMarketFallback).toBe("NOT_CALIBRATED");
    expect(result.sell.output).toBe("WATCH");
  });

  it("requires all four normal-path conditions and creates only a Shadow reference sell", () => {
    const engine = new V3DecisionEngine(config);
    const first = engine.evaluate(input(T0, [macro()], market(T0)));
    expect(first.sell.stage).toBe("NEWS_ARMED");
    const confirmed = engine.evaluate(input(at(3), [macro()], market(at(3))));
    expect(confirmed.sell).toMatchObject({
      stage: "SELL_READY",
      output: "SHADOW_CANDIDATE",
      outputBasis: "CEX_REFERENCE",
      passed: 4,
      required: 4,
      sellContext: "SHADOW_REFERENCE",
    });
    expect(confirmed.shadowSellCreated).toMatchObject({ state: "SHADOW_REFERENCE", at: at(3) });
  });

  it("makes a single stale market dependency visible instead of using stale values", () => {
    const engine = new V3DecisionEngine(config);
    const stale = market(T0, {
      returns: { SOL: null },
      freshness: { SOL: "STALE" },
    });
    const result = engine.evaluate(input(T0, [macro()], stale, { marketStatus: "STALE" }));
    expect(result.sell.conditions[1]?.state).toBe("STALE");
    expect(result.sell.stage).toBe("NEWS_ARMED");
    expect(result.sell.output).not.toBe("SHADOW_CANDIDATE");
  });

  it("does not leak VIRTUAL freshness into the BTC/ETH/SOL-only cross-asset condition", () => {
    const engine = new V3DecisionEngine(config);
    const warming = market(T0, {
      returns: { BTC: null, ETH: null, SOL: null, VIRTUAL: null },
      freshness: { BTC: "FRESH", ETH: "FRESH", SOL: "FRESH", VIRTUAL: "STALE" },
    });
    const result = engine.evaluate(input(T0, [macro()], warming));
    expect(result.sell.conditions[1]).toMatchObject({ state: "UNKNOWN", progress: null });
  });

  it("keeps an unresolved VIRTUAL aggTrade gap UNKNOWN", () => {
    const engine = new V3DecisionEngine(config);
    const result = engine.evaluate(input(T0, [macro()], market(T0, { flowState: "GAP" })));
    expect(result.sell.conditions[3]).toMatchObject({ state: "UNKNOWN", progress: null });
  });
});

describe("v0.3 four-condition Rebuy model", () => {
  it("reaches Rebuy only after macro quiet, no new low, relative recovery, and normalized flow", () => {
    const engine = new V3DecisionEngine(config);
    engine.evaluate(input(T0, [macro()], market(T0)));
    engine.evaluate(input(at(3), [macro()], market(at(3))));
    engine.evaluate(input(at(903), [macro()], recoveryMarket(at(903))));
    const recovered = engine.evaluate(input(at(933), [macro()], recoveryMarket(at(933))));
    expect(recovered.rebuy.conditions.map(({ state }) => state)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(recovered.rebuy).toMatchObject({
      stage: "REBUY_READY",
      output: "SHADOW_CANDIDATE",
      passed: 4,
      sellContext: "SHADOW_REFERENCE",
    });
  });

  it("shows complete recovery but refuses a Rebuy suggestion without a sell fact", () => {
    const engine = new V3DecisionEngine(config);
    engine.evaluate(input(T0, [], recoveryMarket(T0)));
    const recovered = engine.evaluate(input(at(300), [], recoveryMarket(at(300))));
    expect(recovered.rebuy.passed).toBe(4);
    expect(recovered.rebuy.stage).toBe("REBUY_WAIT");
    expect(recovered.rebuy.output).toBe("NO_ACTION");
    expect(recovered.rebuy.nextGap).toContain("没有用户卖出事实");

    engine.recordUserSell(at(300), ["operator-record"]);
    const withFact = engine.evaluate(input(at(301), [], recoveryMarket(at(301))));
    expect(withFact.rebuy).toMatchObject({
      stage: "REBUY_READY",
      sellContext: "USER_RECORDED",
    });
  });

  it("resets Rebuy when a new macro escalation arrives", () => {
    const engine = new V3DecisionEngine(config);
    engine.recordUserSell(T0, ["operator-record"]);
    engine.evaluate(input(T0, [], recoveryMarket(T0)));
    engine.evaluate(input(at(300), [], recoveryMarket(at(300))));
    const escalated = engine.evaluate(
      input(at(301), [macro(at(301), 101)], recoveryMarket(at(301))),
    );
    expect(escalated.rebuy.conditions[0]).toMatchObject({ state: "FAIL", progress: 0 });
    expect(escalated.rebuy.stage).toBe("REBUY_WAIT");
  });

  it("resets the no-new-low timer on a V-shaped retest and flow timers on renewed selling", () => {
    const engine = new V3DecisionEngine(config);
    engine.recordUserSell(T0, ["operator-record"]);
    engine.evaluate(input(T0, [], recoveryMarket(T0, "1")));
    engine.evaluate(input(at(300), [], recoveryMarket(at(300), "1.1")));
    const retest = engine.evaluate(
      input(
        at(301),
        [],
        market(at(301), {
          returns: { BTC: "0", ETH: "0", SOL: "0", VIRTUAL: "-0.02" },
          prices: { BTC: "99", ETH: "99", SOL: "99", VIRTUAL: "0.9" },
          excess: "-0.02",
          ratio: "0.4",
        }),
      ),
    );
    expect(retest.rebuy.conditions[1]).toMatchObject({ state: "FAIL", durationSeconds: 0 });
    expect(retest.rebuy.conditions[2]).toMatchObject({ state: "FAIL", durationSeconds: 0 });
    expect(retest.rebuy.conditions[3]).toMatchObject({ state: "FAIL", durationSeconds: 0 });
  });

  it("marks TechFlow failure as an inability to prove no new escalation", () => {
    const engine = new V3DecisionEngine(config);
    engine.recordUserSell(T0, ["operator-record"]);
    const result = engine.evaluate(input(T0, [], recoveryMarket(T0), { newsStatus: "ERROR" }));
    expect(result.rebuy.conditions[0]).toMatchObject({ state: "STALE", progress: null });
    expect(result.rebuy.stage).toBe("DATA_UNAVAILABLE");
  });
});
