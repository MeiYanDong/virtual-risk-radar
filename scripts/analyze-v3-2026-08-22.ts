import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Decimal from "decimal.js";
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

const ROOT = resolve("tests/fixtures/2026-08-22");
const RAW = resolve(ROOT, "raw");
const OUTPUT = resolve(ROOT, "v3-analysis.json");
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

type AggregateTrade = { a: number; p: string; q: string; T: number; m: boolean };

function sha256(input: string | Buffer): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function sourceHealth(
  category: "NEWS" | "MARKET",
  at: Timestamp,
  status: V3SourceHealth["status"],
  gaps: number,
): V3SourceHealth {
  return V3SourceHealthSchema.parse({
    sourceId: category === "NEWS" ? "techflow-public-newsletter" : "binance-spot-public",
    label: category === "NEWS" ? "TechFlow 7×24h" : "Binance Spot",
    category,
    capabilityState: "TESTED",
    status,
    transport: category === "NEWS" ? "PUBLIC_WEBPAGE" : "SPOT_WEBSOCKET",
    endpoint:
      category === "NEWS"
        ? "https://www.techflowpost.com/newsletter/133044"
        : "captured Binance Spot public files",
    lastAttemptAt: at,
    lastSuccessAt: at,
    dataAgeMs: 0,
    messagesReceived: 1,
    uniqueItems: 1,
    duplicates: 0,
    gaps,
    reconnects: 0,
    errorCode: gaps > 0 ? "CAPTURE_WINDOW_GAP" : null,
    reason:
      gaps > 0
        ? "Captured Spot aggTrade window contains an unresolved aggregate-ID gap"
        : "Historical public input is present for this received-time window",
    evidenceIds: ["tests/fixtures/2026-08-22/raw/manifest.json"],
  });
}

function techFlowEvent(): V3NewsItem {
  const at = timestamp("2026-08-22T04:02:19.000Z");
  const item: RawTechFlowItem = {
    id: 133044,
    title: "加拿大总理卡尼：与美国的贸易谈判已暂停",
    abstract: "美国要对加拿大加征 50% 的关税，加拿大将以同等幅度实施反制，以保护本国工人和企业。",
    source: "金十",
    url: "https://flash.jin10.com/detail/20260822114345108800",
    created_at: at,
    updated_at: at,
    category: { id: 1006, name: "股市观察" },
    content_categories: [],
  };
  return normalizeTechFlowItem({
    item,
    receivedAt: at,
    accessedAt: timestamp("2026-08-22T08:59:06.000Z"),
    revision: 0,
    bodyExcerptCharacters: 600,
  });
}

export async function analyzeV3Fixture(): Promise<Record<string, unknown>> {
  const config = parseActiveSystemConfig(await json(resolve("config/default.json")));
  const manifest = await json<Record<string, { checksum: string }>>(resolve(RAW, "manifest.json"));
  const filenames = {
    BTC: "binance-spot-btcusdt-1s-klines.json",
    ETH: "binance-spot-ethusdt-1s-klines.json",
    SOL: "binance-spot-solusdt-1s-klines.json",
    VIRTUAL: "binance-spot-virtualusdt-1s-klines.json",
  } as const;
  const klines = Object.fromEntries(
    await Promise.all(
      Object.entries(filenames).map(async ([asset, filename]) => [
        asset,
        await json<Kline[]>(resolve(RAW, filename)),
      ]),
    ),
  ) as Record<Asset, Kline[]>;
  const closeMaps = Object.fromEntries(
    Object.entries(klines).map(([asset, rows]) => [
      asset,
      new Map(rows.map((row) => [row[6], new Decimal(row[4])])),
    ]),
  ) as Record<Asset, Map<number, Decimal>>;
  const trades = (
    await json<AggregateTrade[]>(resolve(RAW, "binance-spot-virtualusdt-aggtrades.json"))
  ).sort((left, right) => left.T - right.T || left.a - right.a);
  const gapEvents = trades.slice(1).flatMap((trade, index) => {
    const previous = trades[index];
    if (previous === undefined || trade.a === previous.a + 1) return [];
    return [
      {
        at: trade.T,
        from: previous.a,
        to: trade.a,
        missing: trade.a - previous.a - 1,
      },
    ];
  });
  const event = techFlowEvent();
  const engine = new V3DecisionEngine(config);
  let left = 0;
  let right = 0;
  let buy = new Decimal(0);
  let sell = new Decimal(0);
  let firstSellReady: Record<string, unknown> | null = null;
  let firstRebuyReady: Record<string, unknown> | null = null;
  const transitions: Array<Record<string, unknown>> = [];
  let previousSellStage: string | null = null;
  let previousRebuyStage: string | null = null;

  for (let current = SCAN_START; current <= SCAN_END; current += 1_000) {
    while (
      trades[right] !== undefined &&
      (trades[right]?.T ?? Number.POSITIVE_INFINITY) <= current
    ) {
      const trade = trades[right];
      if (trade === undefined) break;
      const notional = new Decimal(trade.p).times(trade.q);
      if (trade.m) sell = sell.plus(notional);
      else buy = buy.plus(notional);
      right += 1;
    }
    while (trades[left] !== undefined && (trades[left]?.T ?? 0) < current - 60_000) {
      const trade = trades[left];
      if (trade === undefined) break;
      const notional = new Decimal(trade.p).times(trade.q);
      if (trade.m) sell = sell.minus(notional);
      else buy = buy.minus(notional);
      left += 1;
    }
    const at = timestamp(new Date(current));
    const activeGaps = gapEvents.filter(
      ({ at: gapAt }) => gapAt >= current - 60_000 && gapAt <= current,
    );
    const assets = Object.fromEntries(
      (Object.keys(klines) as Asset[]).map((asset) => {
        const price = closeMaps[asset].get(current);
        const baseline = closeMaps[asset].get(current - 60_000);
        if (price === undefined || baseline === undefined) {
          throw new Error(`${asset} missing exact received-time kline at ${at}`);
        }
        return [
          asset,
          {
            asset,
            symbol: `${asset}USDT`,
            price: decimal(price),
            return60s: decimal(price.minus(baseline).dividedBy(baseline)),
            dataAgeMs: 0,
            freshness: "FRESH" as const,
            latestEvidenceId: `fixture-${asset.toLowerCase()}-${current}`,
          },
        ];
      }),
    ) as V3MarketFeatureSnapshot["assets"];
    const majorMean = Decimal.sum(
      assets.BTC.return60s ?? "0",
      assets.ETH.return60s ?? "0",
      assets.SOL.return60s ?? "0",
    ).dividedBy(3);
    const latestTrade = trades[right - 1];
    const flowState = activeGaps.length > 0 ? "GAP" : right > left ? "KNOWN" : "NO_TRADES";
    const market: V3MarketFeatureSnapshot = {
      asOf: at,
      assets,
      virtualExcessReturn60s: decimal(
        new Decimal(assets.VIRTUAL.return60s ?? "0").minus(majorMean),
      ),
      virtualTakerBuyNotional60s: flowState === "KNOWN" ? decimal(buy) : null,
      virtualTakerSellNotional60s: flowState === "KNOWN" ? decimal(sell) : null,
      virtualTakerBuySellRatio60s:
        flowState !== "KNOWN" || sell.eq(0) ? null : decimal(buy.dividedBy(sell)),
      virtualOrderFlowState: flowState,
      virtualOrderFlowCoverage: flowState === "KNOWN" ? decimal("1") : null,
      virtualOrderFlowAgeMs:
        latestTrade === undefined ? null : Math.max(0, current - latestTrade.T),
      gaps: activeGaps.map(({ from, to }) => `VIRTUALUSDT:aggTrade:${from + 1}-${to - 1}`),
      evidenceIds: [
        `fixture-spot-window-${current}`,
        ...(latestTrade === undefined ? [] : [`fixture-virtual-agg-${latestTrade.a}`]),
      ],
    };
    const decision = engine.evaluate({
      now: at,
      newsItems: [event],
      newsHealth: sourceHealth("NEWS", at, "HEALTHY", 0),
      marketHealth: sourceHealth(
        "MARKET",
        at,
        activeGaps.length > 0 ? "DEGRADED" : "HEALTHY",
        activeGaps.length,
      ),
      market,
    });
    if (decision.sell.stage !== previousSellStage || decision.rebuy.stage !== previousRebuyStage) {
      transitions.push({
        at,
        sellStage: decision.sell.stage,
        sellPassed: decision.sell.passed,
        rebuyStage: decision.rebuy.stage,
        rebuyPassed: decision.rebuy.passed,
      });
      previousSellStage = decision.sell.stage;
      previousRebuyStage = decision.rebuy.stage;
    }
    if (firstSellReady === null && decision.sell.stage === "SELL_READY") {
      firstSellReady = { at, panel: decision.sell };
    }
    if (firstRebuyReady === null && decision.rebuy.stage === "REBUY_READY") {
      firstRebuyReady = { at, panel: decision.rebuy };
    }
  }

  const activeFiles = [...Object.values(filenames), "binance-spot-virtualusdt-aggtrades.json"];
  return {
    reportId: "virtual-risk-2026-08-22-v3-two-source-replay",
    schemaVersion: "3.0.0",
    modelVersion: config.modelVersion,
    generatedFrom: "captured received-time fixtures; no live network read",
    inputPolicy: {
      news: ["TechFlow public newsletter item 133044"],
      market: ["Binance Spot BTC/ETH/SOL/VIRTUAL klines", "Binance Spot VIRTUAL aggTrade"],
      excluded: [
        "RPC",
        "DEX quote",
        "wallet",
        "futures",
        "OI",
        "funding",
        "second news source",
        "second exchange",
      ],
    },
    inputChecksums: Object.fromEntries(
      activeFiles.map((filename) => [filename, manifest[filename]?.checksum ?? "UNKNOWN"]),
    ),
    scanWindow: {
      from: new Date(SCAN_START).toISOString(),
      to: new Date(SCAN_END).toISOString(),
      stepMs: 1_000,
      futureReadsAllowed: false,
    },
    techflowEvent: {
      observationId: event.observationId,
      sourceItemId: event.sourceItemId,
      receivedAt: event.receivedAt,
      eventType: event.eventType,
      countries: event.countries,
      direction: event.direction,
      severity: event.severity,
      canadaSpecificRouting: false,
    },
    spotOrderFlowCoverage: {
      aggregateTradeRecords: trades.length,
      gapEvents: gapEvents.length,
      missingAggregateIds: gapEvents.reduce((total, gap) => total + gap.missing, 0),
      rule: "Any unresolved ID gap makes only the overlapping 60-second order-flow condition UNKNOWN",
    },
    firstSellReady,
    firstRebuyReady,
    transitions,
    conclusion: {
      outputBasis: "CEX_REFERENCE",
      executionReceipt: "UNKNOWN:not_recorded",
      dexRealizability: "UNKNOWN:not_measured",
      economicEvidence: "POSITIVE_EV_NOT_PROVEN",
      oldV02ConclusionPreservedAt: "tests/fixtures/2026-08-22/analysis.json",
      status:
        firstSellReady === null
          ? "INCONCLUSIVE_NO_COMPLETE_V3_SELL_WINDOW"
          : "V3_SHADOW_SIGNAL_REPRODUCED_WITH_SPOT_ONLY_INPUTS",
    },
    reportHashBasis: sha256(await readFile(resolve(RAW, "manifest.json"))),
  };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const report = await analyzeV3Fixture();
  const temporary = `${OUTPUT}.partial`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, OUTPUT);
  const sell = report["firstSellReady"] as { at?: string } | null;
  const rebuy = report["firstRebuyReady"] as { at?: string } | null;
  console.log(`V3_FIXTURE_ANALYZED sell=${sell?.at ?? "NONE"} rebuy=${rebuy?.at ?? "NONE"}`);
}
