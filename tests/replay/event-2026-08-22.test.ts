import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { parseSystemConfig } from "@virtual/config";
import { evaluateSell, type ChainQuoteInput } from "@virtual/decision";
import {
  decimal,
  known,
  timestamp,
  unknown,
  type FeatureSnapshot,
  type MarketObservation,
  type Timestamp,
} from "@virtual/domain";
import { computeFeatureSnapshot, unknownFeatureInputs } from "@virtual/features";
import {
  BinanceAggregateTradeSchema,
  BinanceSpotKlineSchema,
  DeterministicReplay,
  marketObservationsToReplayEvents,
  normalizeSpotKlineCloses,
  normalizeVirtualFuturesAggregateTrades,
  replayPayloadAsMarketObservation,
} from "@virtual/replay";
import { describe, expect, it } from "vitest";

const FIXTURE_ROOT = new URL("../fixtures/2026-08-22/", import.meta.url);
const WINDOW_START = Date.parse("2026-08-22T05:04:00.000Z");
const WINDOW_END = Date.parse("2026-08-22T05:07:18.999Z");

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, FIXTURE_ROOT), "utf8")) as unknown;
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Fixture series must be an array");
  return value;
}

function selectedKlines(filename: string): unknown[] {
  return rows(readJson(`raw/${filename}`)).filter((row) => {
    const parsed = BinanceSpotKlineSchema.parse(row);
    return parsed[6] >= WINDOW_START && parsed[6] <= WINDOW_END;
  });
}

function selectedFuturesTrades(): unknown[] {
  return rows(readJson("raw/binance-futures-virtualusdt-aggtrades.json")).filter((row) => {
    const parsed = BinanceAggregateTradeSchema.parse(row);
    return parsed.T >= WINDOW_START && parsed.T <= WINDOW_END;
  });
}

const observations: MarketObservation[] = [
  ...normalizeSpotKlineCloses(selectedKlines("binance-spot-btcusdt-1s-klines.json"), "BTC"),
  ...normalizeSpotKlineCloses(selectedKlines("binance-spot-ethusdt-1s-klines.json"), "ETH"),
  ...normalizeSpotKlineCloses(selectedKlines("binance-spot-solusdt-1s-klines.json"), "SOL"),
  ...normalizeSpotKlineCloses(selectedKlines("binance-spot-virtualusdt-1s-klines.json"), "VIRTUAL"),
  ...normalizeVirtualFuturesAggregateTrades(selectedFuturesTrades()),
];
const replayEvents = marketObservationsToReplayEvents(observations);
const config = parseSystemConfig(
  JSON.parse(
    readFileSync(new URL("../../../config/legacy-v0.2.json", FIXTURE_ROOT), "utf8"),
  ) as unknown,
);
const visibleObservationCache = new Map<Timestamp, MarketObservation[]>();
const featureCache = new Map<string, FeatureSnapshot>();

function visibleObservations(at: Timestamp): MarketObservation[] {
  const cached = visibleObservationCache.get(at);
  if (cached !== undefined) return cached;
  const replay = new DeterministicReplay(replayEvents);
  replay.runUntil(at, () => undefined);
  const visible = replay.observedEvents().map(replayPayloadAsMarketObservation);
  visibleObservationCache.set(at, visible);
  return visible;
}

function featureAt(at: Timestamp, sellPressureSeconds: number): FeatureSnapshot {
  const cacheKey = `${at}:${sellPressureSeconds}`;
  const cached = featureCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const missing = unknownFeatureInputs(at);
  const feature = computeFeatureSnapshot({
    asOf: at,
    modelVersion: config.modelVersion,
    formulaVersion: "feature-formulas-v1",
    parameterVersion: "candidate-2026-08-22-v1",
    observations: visibleObservations(at),
    returnHistory60s: {
      BTC: ["0", "0", "0", "0", "0"].map(decimal),
      ETH: ["0", "0", "0", "0", "0"].map(decimal),
      SOL: ["0", "0", "0", "0", "0"].map(decimal),
      VIRTUAL: ["0", "0", "0", "0", "0"].map(decimal),
    },
    historicalVirtualNetFlows60s: Array.from({ length: 20 }, (_, index) => decimal(index - 10)),
    strictMarketArmThresholds: {
      BTC: config.market.sell.fixedReturn60s.BTC,
      ETH: config.market.sell.fixedReturn60s.ETH,
      SOL: config.market.sell.fixedReturn60s.SOL,
    },
    broadVolumeBaseline60s: known(decimal("1000000"), at, ["historical-volume-baseline"]),
    ...missing,
    riskArmedAt: known(timestamp("2026-08-22T03:43:45.000Z"), at, ["news-cluster"]),
    oiBaselineContracts: known(decimal("24008321.6"), at, ["oi-baseline"]),
    oiCurrentContracts: known(decimal("24628070.2"), at, ["oi-current"]),
    virtualSellPressureSeconds: known(sellPressureSeconds, at, ["sell-flow-duration"]),
    newsRiskContext: "NEWS_ARMED",
    permanentDamage: "PASS",
    gapSources: [],
    clockDriftMs: known(decimal("0"), at, ["clock"]),
    maximumClockDriftMs: 1000,
    evidenceIds: ["fixture-2026-08-22"],
  });
  featureCache.set(cacheKey, feature);
  return feature;
}

function unknownQuotes(at: Timestamp): ChainQuoteInput[] {
  return [config.chains.base, config.chains.robinhood].map((chain) => ({
    chainProfileId: chain.chainProfileId,
    quote: unknown("Historical DEX quote was not recorded", at),
  }));
}

function sellDecision(at: Timestamp, sellPressureSeconds: number) {
  return evaluateSell({
    config,
    features: featureAt(at, sellPressureSeconds),
    mode: "REPLAY",
    now: at,
    quotes: unknownQuotes(at),
  });
}

describe("2026-08-22 captured replay", () => {
  it("does not expose a one-second kline close before its close time", () => {
    const row = BinanceSpotKlineSchema.parse(
      selectedKlines("binance-spot-btcusdt-1s-klines.json")[0],
    );
    const normalized = normalizeSpotKlineCloses([row], "BTC")[0];
    if (normalized === undefined) throw new Error("Missing normalized kline");
    const replay = new DeterministicReplay(
      marketObservationsToReplayEvents([normalized]),
      timestamp(new Date(row[0])),
    );
    replay.runUntil(timestamp(new Date(row[0])), () => undefined);
    expect(replay.observedEvents()).toHaveLength(0);
    replay.runUntil(timestamp(new Date(row[6])), () => undefined);
    expect(replay.observedEvents()).toHaveLength(1);
  });

  it("maps buyer-maker futures trades to taker SELL", () => {
    const raw = selectedFuturesTrades().map((row) => BinanceAggregateTradeSchema.parse(row));
    const maker = raw.find(({ m }) => m);
    const takerBuyer = raw.find(({ m }) => !m);
    if (maker === undefined || takerBuyer === undefined)
      throw new Error("Both trade sides are required");
    expect(normalizeVirtualFuturesAggregateTrades([maker])[0]?.takerSide).toBe("SELL");
    expect(normalizeVirtualFuturesAggregateTrades([takerBuyer])[0]?.takerSide).toBe("BUY");
  });

  it("falsifies the old early sell timestamps and reproduces corrected market stages", () => {
    const earlyPretrigger = sellDecision(timestamp("2026-08-22T05:05:01.000Z"), 0);
    const verifiedPretrigger = sellDecision(timestamp("2026-08-22T05:05:06.999Z"), 0);
    const earlyConfirmation = sellDecision(timestamp("2026-08-22T05:07:13.000Z"), 3);
    const verifiedConfirmation = sellDecision(timestamp("2026-08-22T05:07:16.999Z"), 3);

    expect(earlyPretrigger.stage).toBe("NEWS_ARMED");
    expect(verifiedPretrigger.stage).toBe("SELL_PRETRIGGER");
    expect(earlyConfirmation.stage).not.toBe("SELL_CONFIRMED");
    expect(verifiedConfirmation.stage).toBe("SELL_CONFIRMED");
  }, 30_000);

  it("keeps both chain actions pending and creates no shadow fill without a historical quote", () => {
    const decision = sellDecision(timestamp("2026-08-22T05:07:16.999Z"), 3);
    expect(decision.chainExecutability.map(({ actionState }) => actionState)).toEqual([
      "QUOTE_PENDING",
      "QUOTE_PENDING",
    ]);
    expect(decision.recommendedAction).toBe("BLOCKED");
    expect(decision.economicEvidence).toBe("POSITIVE_EV_NOT_PROVEN");
  }, 30_000);

  it("produces no chase-sell or dip-buy action at the captured event low", () => {
    const eventLow = timestamp("2026-08-22T05:11:13.949Z");
    const decision = sellDecision(eventLow, 3);

    expect(decision.stage).toBe("DATA_BLOCKED");
    expect(decision.recommendedAction).toBe("BLOCKED");
    expect(decision.chainExecutability.map(({ actionState }) => actionState)).toEqual([
      "SIGNAL_NOT_READY",
      "SIGNAL_NOT_READY",
    ]);
    expect(decision.economicEvidence).toBe("POSITIVE_EV_NOT_PROVEN");
  }, 30_000);

  it("repeats byte-identical snapshots three times", () => {
    const at = timestamp("2026-08-22T05:07:16.999Z");
    const outputs = Array.from({ length: 3 }, () => JSON.stringify(sellDecision(at, 3)));
    expect(new Set(outputs).size).toBe(1);
  }, 30_000);

  it("proves the valid pre-arm OI baseline never passes 5% and rejects a later hindsight baseline", () => {
    const oi = rows(readJson("raw/binance-futures-virtualusdt-open-interest-5m.json")).map(
      (value) => {
        if (value === null || Array.isArray(value) || typeof value !== "object") {
          throw new TypeError("OI observation must be an object");
        }
        const observation = value as Record<string, unknown>;
        const contracts = observation["sumOpenInterest"];
        const at = observation["timestamp"];
        if (typeof contracts !== "string" || typeof at !== "number") {
          throw new TypeError("OI observation fields are invalid");
        }
        return { contracts: new Decimal(contracts), at };
      },
    );
    const riskArm = Date.parse("2026-08-22T03:43:45.000Z");
    const baseline = oi.filter(({ at }) => at <= riskArm).at(-1);
    if (baseline === undefined) throw new Error("Missing valid OI baseline");
    const minimumValidChange = Decimal.min(
      ...oi.map(({ contracts }) =>
        contracts.minus(baseline.contracts).dividedBy(baseline.contracts),
      ),
    );
    const futureBaseline = oi
      .filter(({ at }) => at <= Date.parse("2026-08-22T05:05:06.999Z"))
      .at(-1);
    const at1320 = oi.filter(({ at }) => at <= Date.parse("2026-08-22T05:20:00.000Z")).at(-1);
    if (futureBaseline === undefined || at1320 === undefined)
      throw new Error("Missing OI audit rows");
    const hindsightChange = at1320.contracts
      .minus(futureBaseline.contracts)
      .dividedBy(futureBaseline.contracts);

    expect(minimumValidChange.gt("-0.05")).toBe(true);
    expect(hindsightChange.lte("-0.05")).toBe(true);
    expect(futureBaseline.at).toBeGreaterThan(riskArm);
  });
});
