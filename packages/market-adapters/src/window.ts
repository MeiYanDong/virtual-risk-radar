import Decimal from "decimal.js";
import {
  decimal,
  type Asset,
  type DecimalString,
  type Timestamp,
  type V3MarketTick,
} from "@virtual/domain";

const ASSETS = ["BTC", "ETH", "SOL", "VIRTUAL"] as const satisfies readonly Asset[];

export type V3MarketAssetFeature = {
  asset: Asset;
  symbol: string;
  price: DecimalString | null;
  return60s: DecimalString | null;
  dataAgeMs: number | null;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  latestEvidenceId: string | null;
};

export type V3MarketFeatureSnapshot = {
  asOf: Timestamp;
  assets: Record<Asset, V3MarketAssetFeature>;
  virtualExcessReturn60s: DecimalString | null;
  virtualTakerBuyNotional60s: DecimalString | null;
  virtualTakerSellNotional60s: DecimalString | null;
  virtualTakerBuySellRatio60s: DecimalString | null;
  virtualOrderFlowState: "KNOWN" | "NO_TRADES" | "STALE" | "GAP";
  virtualOrderFlowCoverage: DecimalString | null;
  virtualOrderFlowAgeMs: number | null;
  gaps: string[];
  evidenceIds: string[];
};

function ordered(ticks: readonly V3MarketTick[]): V3MarketTick[] {
  return [...ticks].sort((left, right) => {
    const byTime = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
    if (byTime !== 0) return byTime;
    return left.observationId.localeCompare(right.observationId);
  });
}

export class V3MarketWindow {
  readonly #rollingWindowMs: number;
  readonly #freshnessMs: number;
  readonly #ticks: V3MarketTick[] = [];
  #startIndex = 0;

  constructor(input: { rollingWindowSeconds: number; freshnessMs: number }) {
    this.#rollingWindowMs = input.rollingWindowSeconds * 1_000;
    this.#freshnessMs = input.freshnessMs;
  }

  add(tick: V3MarketTick): void {
    this.#ticks.push(structuredClone(tick));
    const cutoff = Date.parse(tick.receivedAt) - this.#rollingWindowMs;
    while (
      this.#ticks[this.#startIndex] !== undefined &&
      Date.parse(this.#ticks[this.#startIndex]?.receivedAt ?? tick.receivedAt) < cutoff
    ) {
      this.#startIndex += 1;
    }
    if (this.#startIndex >= 4_096 && this.#startIndex * 2 >= this.#ticks.length) {
      this.#ticks.splice(0, this.#startIndex);
      this.#startIndex = 0;
    }
  }

  size(): number {
    return this.#ticks.length - this.#startIndex;
  }

  snapshot(asOf: Timestamp, gaps: readonly string[] = []): V3MarketFeatureSnapshot {
    const visible = ordered(
      this.#ticks
        .slice(this.#startIndex)
        .filter((tick) => Date.parse(tick.receivedAt) <= Date.parse(asOf)),
    );
    const assets = Object.fromEntries(
      ASSETS.map((asset) => {
        const books = visible.filter(
          (tick): tick is Extract<V3MarketTick, { kind: "BOOK_TICKER" }> =>
            tick.kind === "BOOK_TICKER" && tick.asset === asset,
        );
        const latest = books.at(-1);
        const baseline = [...books]
          .reverse()
          .find((tick) => Date.parse(tick.receivedAt) <= Date.parse(asOf) - 60_000);
        const age =
          latest === undefined
            ? null
            : Math.max(0, Date.parse(asOf) - Date.parse(latest.receivedAt));
        const freshness =
          latest === undefined
            ? "UNKNOWN"
            : age !== null && age <= this.#freshnessMs
              ? "FRESH"
              : "STALE";
        const return60s =
          latest === undefined || baseline === undefined || freshness !== "FRESH"
            ? null
            : decimal(
                new Decimal(latest.midPrice).minus(baseline.midPrice).dividedBy(baseline.midPrice),
              );
        return [
          asset,
          {
            asset,
            symbol: `${asset}USDT`,
            price: latest?.midPrice ?? null,
            return60s,
            dataAgeMs: age,
            freshness,
            latestEvidenceId: latest?.observationId ?? null,
          } satisfies V3MarketAssetFeature,
        ];
      }),
    ) as Record<Asset, V3MarketAssetFeature>;

    const marketReturns = (["BTC", "ETH", "SOL"] as const)
      .map((asset) => assets[asset].return60s)
      .filter((value): value is DecimalString => value !== null);
    const virtualExcessReturn60s =
      assets.VIRTUAL.return60s === null || marketReturns.length !== 3
        ? null
        : decimal(
            new Decimal(assets.VIRTUAL.return60s).minus(
              Decimal.sum(...marketReturns).dividedBy(marketReturns.length),
            ),
          );

    const flowCutoff = Date.parse(asOf) - 60_000;
    const trades = visible.filter(
      (tick): tick is Extract<V3MarketTick, { kind: "AGG_TRADE" }> =>
        tick.kind === "AGG_TRADE" &&
        tick.asset === "VIRTUAL" &&
        Date.parse(tick.receivedAt) >= flowCutoff,
    );
    const latestTrade = trades.at(-1);
    const orderFlowAgeMs =
      latestTrade === undefined
        ? null
        : Math.max(0, Date.parse(asOf) - Date.parse(latestTrade.receivedAt));
    const flowGap = gaps.some((gap) => gap.startsWith("VIRTUALUSDT:aggTrade:"));
    const orderFlowState: V3MarketFeatureSnapshot["virtualOrderFlowState"] = flowGap
      ? "GAP"
      : latestTrade === undefined
        ? "NO_TRADES"
        : orderFlowAgeMs !== null && orderFlowAgeMs > this.#freshnessMs
          ? "STALE"
          : "KNOWN";
    let buy = new Decimal(0);
    let sell = new Decimal(0);
    for (const trade of trades) {
      if (trade.takerSide === "BUY") buy = buy.plus(trade.quoteNotional);
      else sell = sell.plus(trade.quoteNotional);
    }
    const firstTrade = trades[0];
    const coverage =
      firstTrade === undefined || latestTrade === undefined
        ? null
        : decimal(
            Decimal.min(
              1,
              new Decimal(Date.parse(latestTrade.receivedAt) - Date.parse(firstTrade.receivedAt))
                .plus(this.#freshnessMs)
                .dividedBy(60_000),
            ),
          );
    const usableFlow = orderFlowState === "KNOWN";
    const ratio = !usableFlow || sell.eq(0) ? null : decimal(buy.dividedBy(sell));
    const evidenceIds = [
      ...new Set([
        ...Object.values(assets)
          .map(({ latestEvidenceId }) => latestEvidenceId)
          .filter((value): value is string => value !== null),
        ...trades.map(({ observationId }) => observationId),
      ]),
    ];
    return {
      asOf,
      assets,
      virtualExcessReturn60s,
      virtualTakerBuyNotional60s: usableFlow ? decimal(buy) : null,
      virtualTakerSellNotional60s: usableFlow ? decimal(sell) : null,
      virtualTakerBuySellRatio60s: ratio,
      virtualOrderFlowState: orderFlowState,
      virtualOrderFlowCoverage: coverage,
      virtualOrderFlowAgeMs: orderFlowAgeMs,
      gaps: [...gaps],
      evidenceIds,
    };
  }
}
