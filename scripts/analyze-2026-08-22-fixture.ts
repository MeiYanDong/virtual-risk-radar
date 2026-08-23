import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Decimal from "decimal.js";

const RAW_DIRECTORY = resolve("tests/fixtures/2026-08-22/raw");
const OUTPUT = resolve("tests/fixtures/2026-08-22/analysis.json");
const RISK_ARMED_AT = Date.parse("2026-08-22T03:43:45.000Z");
const SCAN_START = Date.parse("2026-08-22T05:00:00.999Z");
const SCAN_END = Date.parse("2026-08-22T05:35:00.999Z");

type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

type AggregateTrade = {
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
};

type OpenInterest = {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
};

async function json<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(resolve(RAW_DIRECTORY, filename), "utf8")) as T;
}

function sha256(contents: string | Buffer): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

const klines = {
  BTC: await json<Kline[]>("binance-spot-btcusdt-1s-klines.json"),
  ETH: await json<Kline[]>("binance-spot-ethusdt-1s-klines.json"),
  SOL: await json<Kline[]>("binance-spot-solusdt-1s-klines.json"),
  VIRTUAL: await json<Kline[]>("binance-spot-virtualusdt-1s-klines.json"),
};
const futuresTrades = await json<AggregateTrade[]>("binance-futures-virtualusdt-aggtrades.json");
const spotVirtualTrades = await json<AggregateTrade[]>("binance-spot-virtualusdt-aggtrades.json");
const openInterest = await json<OpenInterest[]>(
  "binance-futures-virtualusdt-open-interest-5m.json",
);
const rawManifestContents = await readFile(resolve(RAW_DIRECTORY, "manifest.json"));

const closes = Object.fromEntries(
  Object.entries(klines).map(([asset, rows]) => [
    asset,
    new Map(rows.map((row) => [row[6], new Decimal(row[4])])),
  ]),
) as Record<keyof typeof klines, Map<number, Decimal>>;

function closeAt(asset: keyof typeof klines, at: number): Decimal {
  const exact = closes[asset].get(at);
  if (exact !== undefined) return exact;
  const latest = klines[asset].filter((row) => row[6] <= at).at(-1);
  if (latest === undefined)
    throw new RangeError(`${asset} has no close at ${new Date(at).toISOString()}`);
  return new Decimal(latest[4]);
}

function return60s(asset: keyof typeof klines, at: number): Decimal {
  const current = closeAt(asset, at);
  return current.minus(closeAt(asset, at - 60_000)).dividedBy(closeAt(asset, at - 60_000));
}

function flowAt(at: number): { buy: Decimal; sell: Decimal; ratio: Decimal; records: number } {
  let buy = new Decimal(0);
  let sell = new Decimal(0);
  let records = 0;
  for (const trade of futuresTrades) {
    if (trade.T < at - 60_000 || trade.T > at) continue;
    const value = new Decimal(trade.p).times(trade.q);
    if (trade.m) sell = sell.plus(value);
    else buy = buy.plus(value);
    records += 1;
  }
  return {
    buy,
    sell,
    ratio: sell.isZero() ? new Decimal("Infinity") : buy.dividedBy(sell),
    records,
  };
}

function marketMetrics(at: number) {
  const flow = flowAt(at);
  return {
    at: new Date(at).toISOString(),
    return60s: {
      BTC: return60s("BTC", at).toString(),
      ETH: return60s("ETH", at).toString(),
      SOL: return60s("SOL", at).toString(),
      VIRTUAL: return60s("VIRTUAL", at).toString(),
    },
    virtualFuturesTakerFlow60s: {
      buyNotional: flow.buy.toString(),
      sellNotional: flow.sell.toString(),
      buySellRatio: flow.ratio.toString(),
      records: flow.records,
      makerFlagMapping: "m=true means buyer is maker, therefore taker side is SELL",
    },
  };
}

function shockPass(at: number): boolean {
  return (
    return60s("BTC", at).lte("-0.001") &&
    return60s("SOL", at).lte("-0.005") &&
    return60s("VIRTUAL", at).lte("-0.0025")
  );
}

let firstPretriggerAt: number | undefined;
let firstConfirmedAt: number | undefined;
let sellFlowHeldSince: number | undefined;
for (let at = SCAN_START; at <= SCAN_END; at += 1_000) {
  const flow = flowAt(at);
  if (shockPass(at) && firstPretriggerAt === undefined) firstPretriggerAt = at;
  if (flow.ratio.lte("0.6")) sellFlowHeldSince ??= at;
  else sellFlowHeldSince = undefined;
  if (
    shockPass(at) &&
    sellFlowHeldSince !== undefined &&
    at - sellFlowHeldSince >= 3_000 &&
    firstConfirmedAt === undefined
  ) {
    firstConfirmedAt = at;
  }
}
if (firstPretriggerAt === undefined || firstConfirmedAt === undefined) {
  throw new Error("Verified sell stages were not found in the captured window");
}

const eventTrades = spotVirtualTrades.filter(
  (trade) => trade.T >= firstPretriggerAt && trade.T <= SCAN_END,
);
let eventLowTrade = eventTrades[0];
for (const trade of eventTrades) {
  if (eventLowTrade === undefined || new Decimal(trade.p).lt(eventLowTrade.p))
    eventLowTrade = trade;
}
if (eventLowTrade === undefined) throw new Error("No VIRTUAL spot trade exists after pretrigger");

let recoveryHeldSince: number | undefined;
let stabilityHeldSince: number | undefined;
let firstRecoveryAt: number | undefined;
let firstStabilityAt: number | undefined;
for (let at = Math.ceil(eventLowTrade.T / 1_000) * 1_000 + 999; at <= SCAN_END; at += 1_000) {
  const flow = flowAt(at);
  if (flow.ratio.gte("1.1")) recoveryHeldSince ??= at;
  else recoveryHeldSince = undefined;
  if (
    recoveryHeldSince !== undefined &&
    at - recoveryHeldSince >= 30_000 &&
    firstRecoveryAt === undefined
  ) {
    firstRecoveryAt = at;
  }
  const stable = return60s("BTC", at).gte("-0.001") && return60s("SOL", at).gte("-0.003");
  if (stable) stabilityHeldSince ??= at;
  else stabilityHeldSince = undefined;
  if (
    stabilityHeldSince !== undefined &&
    at - stabilityHeldSince >= 30_000 &&
    firstStabilityAt === undefined
  ) {
    firstStabilityAt = at;
  }
}

const oiBaseline = openInterest
  .filter((observation) => observation.timestamp <= RISK_ARMED_AT)
  .sort((left, right) => right.timestamp - left.timestamp)[0];
if (oiBaseline === undefined) throw new Error("No pre-arm OI baseline exists");
const oiChanges = openInterest.map((observation) => ({
  at: new Date(observation.timestamp).toISOString(),
  contracts: observation.sumOpenInterest,
  changeFromRiskArmBaselinePct: new Decimal(observation.sumOpenInterest)
    .minus(oiBaseline.sumOpenInterest)
    .dividedBy(oiBaseline.sumOpenInterest)
    .toString(),
}));
const minimumOi = [...oiChanges].sort((left, right) =>
  new Decimal(left.changeFromRiskArmBaselinePct).comparedTo(right.changeFromRiskArmBaselinePct),
)[0];
if (minimumOi === undefined) throw new Error("OI series is empty");
const invalidFutureBaseline = openInterest
  .filter((observation) => observation.timestamp <= firstPretriggerAt)
  .sort((left, right) => right.timestamp - left.timestamp)[0];
if (invalidFutureBaseline === undefined) throw new Error("No pretrigger OI comparison exists");
const at1320 = openInterest
  .filter((observation) => observation.timestamp <= Date.parse("2026-08-22T05:20:00.000Z"))
  .at(-1);
if (at1320 === undefined) throw new Error("13:20 OI observation is missing");

const plannedTimes = [
  "2026-08-22T05:05:01.000Z",
  "2026-08-22T05:07:13.000Z",
  "2026-08-22T05:24:44.000Z",
  "2026-08-22T05:29:44.000Z",
];
const report = {
  reportId: "virtual-risk-2026-08-22-analysis-v1",
  evidenceLevel: "HISTORICAL_RECEIPT",
  rawManifestChecksum: sha256(rawManifestContents),
  formulaVersion: "fixture-audit-v1",
  rules: {
    sellShock: {
      BTC: "return60s <= -0.001",
      SOL: "return60s <= -0.005",
      VIRTUAL: "return60s <= -0.0025",
    },
    sellFlow: "VIRTUAL futures taker buy/sell ratio <= 0.6 for at least 3 seconds",
    noNewLow: "300 seconds from the latest running event low",
    oiFlush: "contracts change from latest fresh snapshot before risk arm <= -0.05",
    recoveryFlow: "VIRTUAL futures taker buy/sell ratio >= 1.1 for at least 30 seconds",
    broadStability: "BTC return60s >= -0.001 and SOL return60s >= -0.003 for at least 30 seconds",
  },
  availabilityBoundary: {
    replaySort: "received_at then source sequence then ingestion sequence",
    futureReadsAllowed: false,
    riskArmedAt: new Date(RISK_ARMED_AT).toISOString(),
    dexQuotes: {
      base: "UNKNOWN:not_recorded",
      robinhood: "UNKNOWN:not_recorded",
    },
    executionReceipt: "UNKNOWN:not_recorded",
    economicEvidence: "POSITIVE_EV_NOT_PROVEN",
  },
  plannedTimeMetrics: plannedTimes.map((value) => marketMetrics(Date.parse(value))),
  verifiedMarketTimeline: {
    newsArmedAt: new Date(RISK_ARMED_AT).toISOString(),
    firstSellPretriggerAt: new Date(firstPretriggerAt).toISOString(),
    firstSellConfirmedAt: new Date(firstConfirmedAt).toISOString(),
    eventLow: {
      at: new Date(eventLowTrade.T).toISOString(),
      price: eventLowTrade.p,
      source: "Binance Spot VIRTUALUSDT aggregate trade",
    },
    noNewLowConditionFirstPassAt: new Date(eventLowTrade.T + 300_000).toISOString(),
    orderFlowRecoveryFirstPassAt:
      firstRecoveryAt === undefined
        ? "UNKNOWN:not_observed"
        : new Date(firstRecoveryAt).toISOString(),
    broadMarketStabilityFirstPassAt:
      firstStabilityAt === undefined
        ? "UNKNOWN:not_observed"
        : new Date(firstStabilityAt).toISOString(),
  },
  oiAudit: {
    validRiskArmBaseline: {
      at: new Date(oiBaseline.timestamp).toISOString(),
      contracts: oiBaseline.sumOpenInterest,
    },
    minimumObservedChange: minimumOi,
    fivePercentFlushEverPassed: new Decimal(minimumOi.changeFromRiskArmBaselinePct).lte("-0.05"),
    at1320: {
      at: new Date(at1320.timestamp).toISOString(),
      contracts: at1320.sumOpenInterest,
      validBaselineChangePct: new Decimal(at1320.sumOpenInterest)
        .minus(oiBaseline.sumOpenInterest)
        .dividedBy(oiBaseline.sumOpenInterest)
        .toString(),
      invalidFutureBaselineChangePct: new Decimal(at1320.sumOpenInterest)
        .minus(invalidFutureBaseline.sumOpenInterest)
        .dividedBy(invalidFutureBaseline.sumOpenInterest)
        .toString(),
      invalidFutureBaselineAt: new Date(invalidFutureBaseline.timestamp).toISOString(),
    },
    conclusion:
      "The 5% OI flush never passes with the frozen pre-risk-arm baseline. Using the later pretrigger baseline would be a future-data violation.",
  },
  replayConclusion: {
    previousExpectedTimelineStatus: "FALSIFIED_BY_CAPTURED_DATA",
    correctedSellTimesLater: {
      pretriggerMilliseconds: firstPretriggerAt - Date.parse("2026-08-22T05:05:01.000Z"),
      confirmedMilliseconds: firstConfirmedAt - Date.parse("2026-08-22T05:07:13.000Z"),
    },
    rebuyActionStatus: "BLOCKED",
    rebuyBlockers: [
      "No DEX-backed sell fact exists",
      "The valid OI flush condition never reaches 5%",
      "Base and Robinhood historical DEX quotes were not recorded",
    ],
    maximumActionLevel: "NO_ACTION_WITH_MARKET_STAGE_VISIBILITY",
  },
};

const temporary = `${OUTPUT}.partial`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o644,
});
await rename(temporary, OUTPUT);
console.log(
  `FIXTURE_ANALYZED pretrigger=${report.verifiedMarketTimeline.firstSellPretriggerAt} confirmed=${report.verifiedMarketTimeline.firstSellConfirmedAt} oiFlush=${report.oiAudit.fivePercentFlushEverPassed}`,
);
