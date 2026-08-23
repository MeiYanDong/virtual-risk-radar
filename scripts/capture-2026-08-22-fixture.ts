import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const START_TIME = Date.parse("2026-08-22T03:40:00.000Z");
const END_TIME = Date.parse("2026-08-22T05:35:00.000Z");
const OUTPUT_DIRECTORY = resolve("tests/fixtures/2026-08-22/raw");
const SPOT_BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";
const SPOT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "VIRTUALUSDT"] as const;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

async function publicJson(url: URL): Promise<JsonValue> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "virtual-risk-fixture/0.1" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Public market-data request failed: ${response.status}`);
  return (await response.json()) as JsonValue;
}

async function paginatedKlines(symbol: (typeof SPOT_SYMBOLS)[number]): Promise<JsonValue[]> {
  const rows: JsonValue[] = [];
  let cursor = START_TIME;
  while (cursor <= END_TIME) {
    const url = new URL("/api/v3/klines", SPOT_BASE);
    url.search = new URLSearchParams({
      symbol,
      interval: "1s",
      startTime: String(cursor),
      endTime: String(END_TIME),
      limit: "1000",
    }).toString();
    const page = await publicJson(url);
    if (!Array.isArray(page)) throw new TypeError("Kline response must be an array");
    rows.push(...page);
    const last = page.at(-1);
    if (!Array.isArray(last) || typeof last[0] !== "number") break;
    const next = last[0] + 1_000;
    if (next <= cursor || page.length < 1000) break;
    cursor = next;
  }
  return rows;
}

async function paginatedVirtualAggTrades(): Promise<JsonValue[]> {
  const rows: JsonValue[] = [];
  let cursor = START_TIME;
  while (cursor <= END_TIME) {
    const url = new URL("/api/v3/aggTrades", SPOT_BASE);
    url.search = new URLSearchParams({
      symbol: "VIRTUALUSDT",
      startTime: String(cursor),
      endTime: String(END_TIME),
      limit: "1000",
    }).toString();
    const page = await publicJson(url);
    if (!Array.isArray(page)) throw new TypeError("Aggregate-trade response must be an array");
    rows.push(...page);
    const last = page.at(-1);
    if (last === undefined || last === null || Array.isArray(last) || typeof last !== "object")
      break;
    const tradeTime = last["T"];
    if (typeof tradeTime !== "number") break;
    const next = tradeTime + 1;
    if (next <= cursor || page.length < 1000) break;
    cursor = next;
  }
  return rows;
}

async function paginatedVirtualFuturesAggTrades(): Promise<JsonValue[]> {
  const initialUrl = new URL("/fapi/v1/aggTrades", FUTURES_BASE);
  initialUrl.search = new URLSearchParams({
    symbol: "VIRTUALUSDT",
    startTime: String(START_TIME),
    endTime: String(Math.min(END_TIME, START_TIME + 3_599_999)),
    limit: "1000",
  }).toString();
  const initial = await publicJson(initialUrl);
  if (!Array.isArray(initial))
    throw new TypeError("Futures aggregate-trade response must be an array");
  const byId = new Map<number, JsonValue>();
  for (const row of initial) {
    if (
      row !== null &&
      !Array.isArray(row) &&
      typeof row === "object" &&
      typeof row["a"] === "number"
    ) {
      byId.set(row["a"], row);
    }
  }
  let last = initial.at(-1);
  while (last !== undefined && last !== null && !Array.isArray(last) && typeof last === "object") {
    const aggregateId = last["a"];
    const tradeTime = last["T"];
    if (typeof aggregateId !== "number" || typeof tradeTime !== "number" || tradeTime > END_TIME)
      break;
    const url = new URL("/fapi/v1/aggTrades", FUTURES_BASE);
    url.search = new URLSearchParams({
      symbol: "VIRTUALUSDT",
      fromId: String(aggregateId + 1),
      limit: "1000",
    }).toString();
    const page = await publicJson(url);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      if (
        row !== null &&
        !Array.isArray(row) &&
        typeof row === "object" &&
        typeof row["a"] === "number" &&
        typeof row["T"] === "number" &&
        row["T"] >= START_TIME &&
        row["T"] <= END_TIME
      ) {
        byId.set(row["a"], row);
      }
    }
    last = page.at(-1);
    if (page.length < 1000) break;
  }
  return [...byId.entries()].sort(([left], [right]) => left - right).map(([, row]) => row);
}

async function futuresSeries(endpoint: string): Promise<JsonValue> {
  const url = new URL(`/futures/data/${endpoint}`, FUTURES_BASE);
  url.search = new URLSearchParams({
    symbol: "VIRTUALUSDT",
    period: "5m",
    startTime: String(START_TIME),
    endTime: String(END_TIME),
    limit: "500",
  }).toString();
  return publicJson(url);
}

function sha256(contents: string): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

async function atomicWrite(
  filename: string,
  value: JsonValue,
): Promise<{ checksum: string; bytes: number }> {
  const target = resolve(OUTPUT_DIRECTORY, filename);
  const temporary = `${target}.partial`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o644 });
  await rename(temporary, target);
  await chmod(target, 0o644);
  return { checksum: sha256(contents), bytes: Buffer.byteLength(contents) };
}

const capturedAt = new Date().toISOString();
const files: Record<string, { checksum: string; bytes: number; records: number }> = {};
for (const symbol of SPOT_SYMBOLS) {
  const data = await paginatedKlines(symbol);
  const filename = `binance-spot-${symbol.toLowerCase()}-1s-klines.json`;
  files[filename] = { ...(await atomicWrite(filename, data)), records: data.length };
}
const aggTrades = await paginatedVirtualAggTrades();
files["binance-spot-virtualusdt-aggtrades.json"] = {
  ...(await atomicWrite("binance-spot-virtualusdt-aggtrades.json", aggTrades)),
  records: aggTrades.length,
};
const futuresAggTrades = await paginatedVirtualFuturesAggTrades();
files["binance-futures-virtualusdt-aggtrades.json"] = {
  ...(await atomicWrite("binance-futures-virtualusdt-aggtrades.json", futuresAggTrades)),
  records: futuresAggTrades.length,
};
for (const [endpoint, filename] of [
  ["openInterestHist", "binance-futures-virtualusdt-open-interest-5m.json"],
  ["takerlongshortRatio", "binance-futures-virtualusdt-taker-ratio-5m.json"],
  ["topLongShortPositionRatio", "binance-futures-virtualusdt-top-position-ratio-5m.json"],
] as const) {
  const data = await futuresSeries(endpoint);
  files[filename] = {
    ...(await atomicWrite(filename, data)),
    records: Array.isArray(data) ? data.length : 1,
  };
}
const exchangeInfoUrl = new URL("/api/v3/exchangeInfo", SPOT_BASE);
exchangeInfoUrl.search = new URLSearchParams({ symbol: "VIRTUALUSDT" }).toString();
const exchangeInfo = await publicJson(exchangeInfoUrl);
files["binance-spot-virtualusdt-exchange-info.json"] = {
  ...(await atomicWrite("binance-spot-virtualusdt-exchange-info.json", exchangeInfo)),
  records: 1,
};

const manifest = {
  fixtureId: "virtual-risk-2026-08-22-v1",
  evidenceLevel: "HISTORICAL_RECEIPT",
  capturedAt,
  window: {
    start: new Date(START_TIME).toISOString(),
    end: new Date(END_TIME).toISOString(),
    timezone: "UTC",
    uiTimezone: "Asia/Shanghai",
  },
  sources: {
    spot: {
      provider: "Binance public market-data REST API",
      baseUrl: SPOT_BASE,
      methods: ["GET /api/v3/klines", "GET /api/v3/aggTrades", "GET /api/v3/exchangeInfo"],
      authentication: "NONE",
    },
    derivatives: {
      provider: "Binance USD-M public market-data REST API",
      baseUrl: FUTURES_BASE,
      methods: [
        "GET /fapi/v1/aggTrades",
        "GET /futures/data/openInterestHist",
        "GET /futures/data/takerlongshortRatio",
        "GET /futures/data/topLongShortPositionRatio",
      ],
      authentication: "NONE",
      retentionWarning:
        "Provider documents a latest-48-hour limit for aggregate trades and latest-30-day limit for statistical series",
    },
  },
  constraints: {
    referenceMarketOnly: true,
    cexOrderOrBalanceCapability: "UNSUPPORTED",
    baseDexQuote: "UNKNOWN:not_recorded",
    robinhoodDexQuote: "UNKNOWN:not_recorded",
    executionReceipt: "UNKNOWN:not_recorded",
  },
  files,
};
await atomicWrite("manifest.json", manifest);
console.log(
  `FIXTURE_CAPTURED files=${Object.keys(files).length + 1} records=${Object.values(files).reduce(
    (sum, file) => sum + file.records,
    0,
  )}`,
);
