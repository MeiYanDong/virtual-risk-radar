import Decimal from "decimal.js";
import {
  decimal,
  divide,
  known,
  multiply,
  subtract,
  unknown,
  type Asset,
  type DecimalString,
  type Knowledge,
  type MarketObservation,
  type Timestamp,
} from "@virtual/domain";

const ASSETS = ["BTC", "ETH", "SOL", "VIRTUAL"] as const satisfies readonly Asset[];
const EPSILON = decimal("0.000000000001");

function visibleAt(observation: MarketObservation, asOf: Timestamp): boolean {
  return Date.parse(observation.receivedAt) <= Date.parse(asOf);
}

function orderedByEventTime(observations: MarketObservation[]): MarketObservation[] {
  return [...observations].sort((left, right) => {
    const time = Date.parse(left.eventTime) - Date.parse(right.eventTime);
    if (time !== 0) return time;
    const received = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
    if (received !== 0) return received;
    return left.observationId.localeCompare(right.observationId);
  });
}

function evidenceOf(observations: MarketObservation[]): string[] {
  return [
    ...new Set(
      observations.flatMap((observation) => [
        observation.observationId,
        ...observation.evidenceIds,
      ]),
    ),
  ];
}

function median(values: Decimal[]): Decimal {
  const ordered = [...values].sort((left, right) => left.comparedTo(right));
  const middle = Math.floor(ordered.length / 2);
  const center = ordered[middle];
  if (center === undefined) throw new RangeError("Median requires at least one value");
  if (ordered.length % 2 === 1) return center;
  const lower = ordered[middle - 1];
  if (lower === undefined) throw new RangeError("Median pair is incomplete");
  return lower.plus(center).dividedBy(2);
}

export function calculateReturn(
  observations: MarketObservation[],
  asset: Asset,
  asOf: Timestamp,
  windowSeconds: number,
): Knowledge<DecimalString> {
  const cutoff = Date.parse(asOf) - windowSeconds * 1_000;
  const visible = orderedByEventTime(
    observations.filter(
      (observation) =>
        observation.asset === asset &&
        observation.marketRole === "PRICE_REFERENCE" &&
        visibleAt(observation, asOf),
    ),
  );
  const baseline = [...visible]
    .reverse()
    .find((observation) => Date.parse(observation.eventTime) <= cutoff);
  const latest = [...visible]
    .reverse()
    .find((observation) => Date.parse(observation.eventTime) <= Date.parse(asOf));
  if (baseline === undefined || latest === undefined) {
    return unknown(`${asset} lacks a price at both window boundaries`, asOf);
  }
  const result = divide(subtract(latest.price, baseline.price), baseline.price);
  return known(result, latest.receivedAt, evidenceOf([baseline, latest]));
}

export function calculateMaxDrawdown(
  observations: MarketObservation[],
  asset: Asset,
  asOf: Timestamp,
  windowSeconds: number,
): Knowledge<DecimalString> {
  const cutoff = Date.parse(asOf) - windowSeconds * 1_000;
  const window = orderedByEventTime(
    observations.filter(
      (observation) =>
        observation.asset === asset &&
        observation.marketRole === "PRICE_REFERENCE" &&
        visibleAt(observation, asOf) &&
        Date.parse(observation.eventTime) >= cutoff &&
        Date.parse(observation.eventTime) <= Date.parse(asOf),
    ),
  );
  if (window.length === 0) return unknown(`${asset} has no prices in the drawdown window`, asOf);

  let runningHigh = new Decimal(window[0]?.price ?? 0);
  let maximumDrawdown = new Decimal(0);
  for (const observation of window) {
    const price = new Decimal(observation.price);
    runningHigh = Decimal.max(runningHigh, price);
    const drawdown = price.minus(runningHigh).dividedBy(runningHigh);
    maximumDrawdown = Decimal.min(maximumDrawdown, drawdown);
  }
  const latest = window.at(-1);
  if (latest === undefined) return unknown(`${asset} drawdown window is empty`, asOf);
  return known(decimal(maximumDrawdown), latest.receivedAt, evidenceOf(window));
}

export function robustMadScale(
  returnHistory: readonly DecimalString[],
  asOf: Timestamp,
  evidenceIds: string[],
  minimumSamples = 5,
): Knowledge<DecimalString> {
  if (returnHistory.length < minimumSamples) {
    return unknown(`MAD warm-up requires ${minimumSamples} returns`, asOf);
  }
  const values = returnHistory.map((value) => new Decimal(value));
  const center = median(values);
  const mad = median(values.map((value) => value.minus(center).abs()));
  return known(decimal(mad.times("1.4826")), asOf, evidenceIds);
}

export function requiredDrawdown(
  fixedThreshold: DecimalString,
  robustSigma: Knowledge<DecimalString>,
  volatilityMultiplier: DecimalString,
  asOf: Timestamp,
): Knowledge<DecimalString> {
  if (robustSigma.state !== "KNOWN") return robustSigma;
  const fixedMagnitude = new Decimal(fixedThreshold).abs();
  const dynamicMagnitude = new Decimal(robustSigma.value).times(volatilityMultiplier).abs();
  return known(
    decimal(Decimal.max(fixedMagnitude, dynamicMagnitude).negated()),
    asOf,
    robustSigma.evidenceIds,
  );
}

export type OrderFlow60s = {
  buyNotional: Knowledge<DecimalString>;
  sellNotional: Knowledge<DecimalString>;
  buySellRatio: Knowledge<DecimalString>;
  netTakerFlow: Knowledge<DecimalString>;
  coverage: Knowledge<DecimalString>;
};

export function calculateOrderFlow60s(
  observations: MarketObservation[],
  asOf: Timestamp,
): OrderFlow60s {
  const cutoff = Date.parse(asOf) - 60_000;
  const trades = orderedByEventTime(
    observations.filter(
      (observation) =>
        observation.asset === "VIRTUAL" &&
        observation.marketRole === "ORDER_FLOW_REFERENCE" &&
        visibleAt(observation, asOf) &&
        Date.parse(observation.eventTime) >= cutoff &&
        Date.parse(observation.eventTime) <= Date.parse(asOf),
    ),
  );
  if (trades.length === 0) {
    const missing = unknown("No VIRTUAL trades are visible in the 60-second window", asOf);
    return {
      buyNotional: missing,
      sellNotional: missing,
      buySellRatio: missing,
      netTakerFlow: missing,
      coverage: missing,
    };
  }

  const eligible = trades.filter(
    (trade) => trade.quantity.state === "KNOWN" && trade.takerSide !== "UNKNOWN",
  );
  const evidenceIds = evidenceOf(trades);
  const coverage = known(
    decimal(new Decimal(eligible.length).dividedBy(trades.length)),
    asOf,
    evidenceIds,
  );
  if (eligible.length === 0) {
    const missing = unknown("All VIRTUAL trades lack quantity or taker side", asOf);
    return {
      buyNotional: missing,
      sellNotional: missing,
      buySellRatio: missing,
      netTakerFlow: missing,
      coverage,
    };
  }

  let buy = new Decimal(0);
  let sell = new Decimal(0);
  for (const trade of eligible) {
    if (trade.quantity.state !== "KNOWN") continue;
    const notional = new Decimal(trade.price).times(trade.quantity.value);
    if (trade.takerSide === "BUY") buy = buy.plus(notional);
    else if (trade.takerSide === "SELL") sell = sell.plus(notional);
  }
  const buyValue = decimal(buy);
  const sellValue = decimal(sell);
  const buyNotional = known(buyValue, asOf, evidenceIds);
  const sellNotional = known(sellValue, asOf, evidenceIds);
  const netTakerFlow = known(subtract(buyValue, sellValue), asOf, evidenceIds);
  if (buy.isZero() && sell.isZero()) {
    return {
      buyNotional,
      sellNotional,
      buySellRatio: unknown("Both known-side notionals are zero", asOf),
      netTakerFlow,
      coverage,
    };
  }
  const denominator = sell.isZero() ? EPSILON : sellValue;
  return {
    buyNotional,
    sellNotional,
    buySellRatio: known(divide(buyValue, denominator), asOf, evidenceIds),
    netTakerFlow,
    coverage,
  };
}

export function calculateMarketShockBreadth(
  returns: Record<Asset, Knowledge<DecimalString>>,
  thresholds: Record<"BTC" | "ETH" | "SOL", DecimalString>,
  asOf: Timestamp,
): Knowledge<number> {
  const referenceAssets = ["BTC", "ETH", "SOL"] as const;
  const values = referenceAssets.map((asset) => returns[asset]);
  if (values.some((value) => value.state !== "KNOWN")) {
    return unknown("Reference-market breadth has an unknown asset return", asOf);
  }
  const count = referenceAssets.filter((asset) => {
    const value = returns[asset];
    return value.state === "KNOWN" && new Decimal(value.value).lte(thresholds[asset]);
  }).length;
  return known(
    count,
    asOf,
    values.flatMap((value) => (value.state === "KNOWN" ? value.evidenceIds : [])),
  );
}

export function calculateBroadMarketVolumeAnomaly(
  observations: MarketObservation[],
  asOf: Timestamp,
  baselineNotional60s: Knowledge<DecimalString>,
): Knowledge<DecimalString> {
  if (baselineNotional60s.state !== "KNOWN") return baselineNotional60s;
  if (new Decimal(baselineNotional60s.value).lte(0)) {
    return unknown("Broad-market volume baseline must be positive", asOf);
  }
  const cutoff = Date.parse(asOf) - 60_000;
  const referenceTrades = observations.filter(
    (observation) =>
      observation.asset !== "VIRTUAL" &&
      observation.marketRole === "PRICE_REFERENCE" &&
      visibleAt(observation, asOf) &&
      Date.parse(observation.eventTime) >= cutoff &&
      Date.parse(observation.eventTime) <= Date.parse(asOf) &&
      observation.quantity.state === "KNOWN",
  );
  if (referenceTrades.length === 0) {
    return unknown("No eligible reference-market trades in the volume window", asOf);
  }
  const current = referenceTrades.reduce((sum, trade) => {
    if (trade.quantity.state !== "KNOWN") return sum;
    return sum.plus(new Decimal(trade.price).times(trade.quantity.value));
  }, new Decimal(0));
  return known(divide(decimal(current), baselineNotional60s.value), asOf, [
    ...evidenceOf(referenceTrades),
    ...baselineNotional60s.evidenceIds,
  ]);
}

export function calculateVirtualExcessReturn(
  returns: Record<Asset, Knowledge<DecimalString>>,
  asOf: Timestamp,
): Knowledge<DecimalString> {
  const required = ASSETS.map((asset) => returns[asset]);
  if (required.some((value) => value.state !== "KNOWN")) {
    return unknown("Relative weakness needs all four asset returns", asOf);
  }
  const reference = (["BTC", "ETH", "SOL"] as const).reduce((sum, asset) => {
    const value = returns[asset];
    return value.state === "KNOWN" ? sum.plus(value.value) : sum;
  }, new Decimal(0));
  const virtual = returns.VIRTUAL;
  if (virtual.state !== "KNOWN") return unknown("VIRTUAL return is unknown", asOf);
  return known(
    subtract(virtual.value, decimal(reference.dividedBy(3))),
    asOf,
    required.flatMap((value) => (value.state === "KNOWN" ? value.evidenceIds : [])),
  );
}

export function calculateOiChange(
  baselineContracts: Knowledge<DecimalString>,
  currentContracts: Knowledge<DecimalString>,
  asOf: Timestamp,
): Knowledge<DecimalString> {
  if (baselineContracts.state !== "KNOWN") return baselineContracts;
  if (currentContracts.state !== "KNOWN") return currentContracts;
  if (new Decimal(baselineContracts.value).lte(0)) {
    return unknown("OI baseline contracts must be positive", asOf);
  }
  return known(
    divide(subtract(currentContracts.value, baselineContracts.value), baselineContracts.value),
    currentContracts.observedAt,
    [...baselineContracts.evidenceIds, ...currentContracts.evidenceIds],
    currentContracts.expiresAt,
  );
}

export function orderFlowZScore(
  currentNetFlow: Knowledge<DecimalString>,
  historicalNetFlows: readonly DecimalString[],
  asOf: Timestamp,
  minimumSamples = 20,
): Knowledge<DecimalString> {
  if (currentNetFlow.state !== "KNOWN") return currentNetFlow;
  if (historicalNetFlows.length < minimumSamples) {
    return unknown(`Order-flow baseline requires ${minimumSamples} samples`, asOf);
  }
  const values = historicalNetFlows.map((value) => new Decimal(value));
  const mean = values
    .reduce((sum, value) => sum.plus(value), new Decimal(0))
    .dividedBy(values.length);
  const variance = values
    .reduce((sum, value) => sum.plus(value.minus(mean).pow(2)), new Decimal(0))
    .dividedBy(values.length);
  const deviation = variance.sqrt();
  if (deviation.isZero()) return unknown("Order-flow baseline deviation is zero", asOf);
  return known(
    decimal(new Decimal(currentNetFlow.value).minus(mean).dividedBy(deviation)),
    asOf,
    currentNetFlow.evidenceIds,
  );
}

export function notional(price: DecimalString, quantity: DecimalString): DecimalString {
  return multiply(price, quantity);
}
