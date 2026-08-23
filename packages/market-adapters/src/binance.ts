import Decimal from "decimal.js";
import {
  V3MarketTickSchema,
  V3SourceHealthSchema,
  decimal,
  timestamp,
  type Asset,
  type Timestamp,
  type V3MarketTick,
  type V3SourceHealth,
} from "@virtual/domain";
import { z } from "zod";

const SOURCE_ID = "binance-spot-public" as const;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "VIRTUALUSDT"] as const;
type SymbolName = (typeof SYMBOLS)[number];
type StreamKind = "aggTrade" | "bookTicker";

const ASSET_BY_SYMBOL: Record<SymbolName, Asset> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
  VIRTUALUSDT: "VIRTUAL",
};

const DecimalInputSchema = z.union([z.string(), z.number()]).transform((value) => decimal(value));
const BinanceAggTradeSchema = z
  .object({
    e: z.literal("aggTrade"),
    E: z.number().int().nonnegative(),
    s: z.enum(SYMBOLS),
    a: z.number().int().nonnegative(),
    p: DecimalInputSchema,
    q: DecimalInputSchema,
    f: z.number().int().nonnegative().optional(),
    l: z.number().int().nonnegative().optional(),
    T: z.number().int().nonnegative(),
    m: z.boolean(),
    M: z.boolean().optional(),
  })
  .passthrough();

const BinanceBookTickerSchema = z
  .object({
    e: z.literal("bookTicker").optional(),
    E: z.number().int().nonnegative().optional(),
    u: z.number().int().nonnegative(),
    s: z.enum(SYMBOLS),
    b: DecimalInputSchema,
    B: DecimalInputSchema,
    a: DecimalInputSchema,
    A: DecimalInputSchema,
  })
  .passthrough();

const CombinedMessageSchema = z
  .object({
    stream: z.string().min(1),
    data: z.unknown(),
  })
  .strict();

export type BinanceNormalizedMessage = {
  tick: V3MarketTick;
  dedupKey: string;
  sequence: number;
  streamKind: StreamKind;
  latencyMeasurable: boolean;
};

export function normalizeBinanceSpotMessage(
  input: unknown,
  receivedAt: Timestamp,
): BinanceNormalizedMessage {
  const combined = CombinedMessageSchema.safeParse(input);
  const data = combined.success ? combined.data.data : input;
  const kind =
    data !== null && typeof data === "object" && "e" in data
      ? (data as { e?: unknown }).e
      : undefined;
  if (kind === "aggTrade") {
    const raw = BinanceAggTradeSchema.parse(data);
    const asset = ASSET_BY_SYMBOL[raw.s];
    const tick = V3MarketTickSchema.parse({
      kind: "AGG_TRADE",
      sourceId: SOURCE_ID,
      observationId: `binance-${raw.s.toLowerCase()}-agg-${raw.a}`,
      asset,
      symbol: raw.s,
      aggregateTradeId: raw.a,
      price: raw.p,
      quantity: raw.q,
      quoteNotional: decimal(new Decimal(raw.p).times(raw.q)),
      takerSide: raw.m ? "SELL" : "BUY",
      eventTime: timestamp(new Date(raw.T)),
      receivedAt,
    });
    return {
      tick,
      dedupKey: `${raw.s}:aggTrade:${raw.a}`,
      sequence: raw.a,
      streamKind: "aggTrade",
      latencyMeasurable: true,
    };
  }
  const raw = BinanceBookTickerSchema.parse(data);
  const asset = ASSET_BY_SYMBOL[raw.s];
  const tick = V3MarketTickSchema.parse({
    kind: "BOOK_TICKER",
    sourceId: SOURCE_ID,
    observationId: `binance-${raw.s.toLowerCase()}-book-${raw.u}`,
    asset,
    symbol: raw.s,
    updateId: raw.u,
    bidPrice: raw.b,
    bidQuantity: raw.B,
    askPrice: raw.a,
    askQuantity: raw.A,
    midPrice: decimal(new Decimal(raw.b).plus(raw.a).dividedBy(2)),
    eventTime: raw.E === undefined ? receivedAt : timestamp(new Date(raw.E)),
    receivedAt,
  });
  return {
    tick,
    dedupKey: `${raw.s}:bookTicker:${raw.u}`,
    sequence: raw.u,
    streamKind: "bookTicker",
    latencyMeasurable: raw.E !== undefined,
  };
}

type StreamMetricAccumulator = {
  received: number;
  accepted: number;
  duplicates: number;
  outOfOrder: number;
  gapEvents: number;
  missingAggregateIds: number;
  firstReceivedAt: Timestamp | null;
  lastReceivedAt: Timestamp | null;
  latencySamplesMs: number[];
  latencySampleCursor: number;
};

export type BinanceStreamMetrics = {
  received: number;
  accepted: number;
  duplicates: number;
  outOfOrder: number;
  gapEvents: number;
  missingAggregateIds: number;
  firstReceivedAt: Timestamp | null;
  lastReceivedAt: Timestamp | null;
  messageRatePerSecond: number;
  sequenceCompleteness: number | null;
  latencyBasis: "EXCHANGE_EVENT_TIME" | "NOT_AVAILABLE";
  latencySampleSize: number;
  latencyMs: { p50: number | null; p95: number | null; p99: number | null; max: number | null };
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};

export type BinanceSoakMetrics = {
  capturedAt: Timestamp;
  sourceId: "binance-spot-public";
  streams: Record<string, BinanceStreamMetrics>;
  reconnects: number;
  totalGapEvents: number;
  activeGaps: string[];
};

function quantile(samples: readonly number[], percentile: number): number | null {
  if (samples.length === 0) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(percentile * ordered.length) - 1);
  return ordered[index] ?? null;
}

function emptyStreamMetrics(): StreamMetricAccumulator {
  return {
    received: 0,
    accepted: 0,
    duplicates: 0,
    outOfOrder: 0,
    gapEvents: 0,
    missingAggregateIds: 0,
    firstReceivedAt: null,
    lastReceivedAt: null,
    latencySamplesMs: [],
    latencySampleCursor: 0,
  };
}

export type BinanceIngestResult = {
  state: "ACCEPTED" | "DUPLICATE" | "OUT_OF_ORDER";
  tick: V3MarketTick | null;
  gap: string | null;
};

export class BinanceSpotStreamProcessor {
  readonly #freshnessMs: number;
  readonly #gapImpactMs: number;
  readonly #endpoint: string;
  readonly #seen = new Set<string>();
  readonly #seenOrder: string[] = [];
  readonly #lastSequence = new Map<string, number>();
  readonly #latestReceived = new Map<string, Timestamp>();
  readonly #latestTicks = new Map<string, V3MarketTick>();
  readonly #gaps = new Map<string, Timestamp>();
  readonly #streamMetrics = new Map<string, StreamMetricAccumulator>();
  #connected = false;
  #lastAttemptAt: Timestamp | null = null;
  #lastSuccessAt: Timestamp | null = null;
  #lastError: string | null = null;
  #messages = 0;
  #unique = 0;
  #duplicates = 0;
  #gapCount = 0;
  #reconnects = 0;

  constructor(input: { freshnessMs: number; endpoint: string; gapImpactMs?: number }) {
    this.#freshnessMs = input.freshnessMs;
    this.#gapImpactMs = input.gapImpactMs ?? 60_000;
    this.#endpoint = input.endpoint;
  }

  markConnecting(at: Timestamp): void {
    this.#lastAttemptAt = at;
    this.#lastError = null;
  }

  markConnected(at: Timestamp): void {
    this.#connected = true;
    this.#lastSuccessAt = at;
    this.#lastError = null;
  }

  markDisconnected(reason: string): void {
    this.#connected = false;
    this.#lastError = reason;
  }

  markReconnect(): void {
    this.#reconnects += 1;
  }

  ingest(input: unknown, receivedAt: Timestamp): BinanceIngestResult {
    this.#messages += 1;
    const normalized = normalizeBinanceSpotMessage(input, receivedAt);
    const key = `${normalized.tick.symbol}:${normalized.streamKind}`;
    const metrics = this.#streamMetrics.get(key) ?? emptyStreamMetrics();
    this.#streamMetrics.set(key, metrics);
    metrics.received += 1;
    metrics.firstReceivedAt ??= receivedAt;
    metrics.lastReceivedAt = receivedAt;
    const previousSequence = this.#lastSequence.get(key);
    if (this.#seen.has(normalized.dedupKey)) {
      this.#duplicates += 1;
      metrics.duplicates += 1;
      return { state: "DUPLICATE", tick: null, gap: null };
    }
    if (previousSequence !== undefined && normalized.sequence < previousSequence) {
      this.#duplicates += 1;
      metrics.outOfOrder += 1;
      return { state: "OUT_OF_ORDER", tick: null, gap: null };
    }
    if (previousSequence === normalized.sequence) {
      this.#duplicates += 1;
      metrics.duplicates += 1;
      return { state: "DUPLICATE", tick: null, gap: null };
    }
    let gap: string | null = null;
    if (
      normalized.streamKind === "aggTrade" &&
      previousSequence !== undefined &&
      normalized.sequence > previousSequence + 1
    ) {
      gap = `${normalized.tick.symbol}:aggTrade:${previousSequence + 1}-${normalized.sequence - 1}`;
      this.#gaps.set(gap, receivedAt);
      this.#gapCount += 1;
      metrics.gapEvents += 1;
      metrics.missingAggregateIds += normalized.sequence - previousSequence - 1;
    }
    this.#lastSequence.set(key, normalized.sequence);
    this.#latestReceived.set(key, receivedAt);
    this.#latestTicks.set(key, normalized.tick);
    this.#lastSuccessAt = receivedAt;
    this.#unique += 1;
    metrics.accepted += 1;
    if (normalized.latencyMeasurable) {
      const latency = Math.max(0, Date.parse(receivedAt) - Date.parse(normalized.tick.eventTime));
      if (metrics.latencySamplesMs.length < 4_096) metrics.latencySamplesMs.push(latency);
      else {
        metrics.latencySamplesMs[metrics.latencySampleCursor] = latency;
        metrics.latencySampleCursor = (metrics.latencySampleCursor + 1) % 4_096;
      }
    }
    this.#seen.add(normalized.dedupKey);
    this.#seenOrder.push(normalized.dedupKey);
    if (this.#seenOrder.length > 20_000) {
      const removed = this.#seenOrder.shift();
      if (removed !== undefined) this.#seen.delete(removed);
    }
    return { state: "ACCEPTED", tick: normalized.tick, gap };
  }

  latestTicks(): V3MarketTick[] {
    return [...this.#latestTicks.values()].map((tick) => structuredClone(tick));
  }

  gaps(now?: Timestamp): string[] {
    const entries = [...this.#gaps.entries()];
    return entries
      .filter(([, detectedAt]) =>
        now === undefined ? true : Date.parse(now) - Date.parse(detectedAt) <= this.#gapImpactMs,
      )
      .map(([gap]) => gap)
      .sort();
  }

  freshnessByStream(now: Timestamp): Record<string, "FRESH" | "STALE" | "UNKNOWN"> {
    return Object.fromEntries(
      SYMBOLS.flatMap((symbol) =>
        (["aggTrade", "bookTicker"] as const).map((kind) => {
          const received = this.#latestReceived.get(`${symbol}:${kind}`);
          const state =
            received === undefined
              ? "UNKNOWN"
              : Date.parse(now) - Date.parse(received) <= this.#freshnessMs
                ? "FRESH"
                : "STALE";
          return [`${symbol}:${kind}`, state];
        }),
      ),
    );
  }

  metrics(now: Timestamp): BinanceSoakMetrics {
    const freshness = this.freshnessByStream(now);
    const streams = Object.fromEntries(
      SYMBOLS.flatMap((symbol) =>
        (["aggTrade", "bookTicker"] as const).map((kind) => {
          const key = `${symbol}:${kind}`;
          const value = this.#streamMetrics.get(key) ?? emptyStreamMetrics();
          const elapsedSeconds =
            value.firstReceivedAt === null
              ? 0
              : Math.max(0.001, (Date.parse(now) - Date.parse(value.firstReceivedAt)) / 1_000);
          const denominator = value.accepted + value.missingAggregateIds;
          return [
            key,
            {
              received: value.received,
              accepted: value.accepted,
              duplicates: value.duplicates,
              outOfOrder: value.outOfOrder,
              gapEvents: value.gapEvents,
              missingAggregateIds: value.missingAggregateIds,
              firstReceivedAt: value.firstReceivedAt,
              lastReceivedAt: value.lastReceivedAt,
              messageRatePerSecond: value.accepted / elapsedSeconds,
              sequenceCompleteness:
                kind === "bookTicker" || denominator === 0 ? null : value.accepted / denominator,
              latencyBasis:
                value.latencySamplesMs.length === 0 ? "NOT_AVAILABLE" : "EXCHANGE_EVENT_TIME",
              latencySampleSize: value.latencySamplesMs.length,
              latencyMs: {
                p50: quantile(value.latencySamplesMs, 0.5),
                p95: quantile(value.latencySamplesMs, 0.95),
                p99: quantile(value.latencySamplesMs, 0.99),
                max:
                  value.latencySamplesMs.length === 0 ? null : Math.max(...value.latencySamplesMs),
              },
              freshness: freshness[key] ?? "UNKNOWN",
            } satisfies BinanceStreamMetrics,
          ];
        }),
      ),
    );
    return {
      capturedAt: now,
      sourceId: SOURCE_ID,
      streams,
      reconnects: this.#reconnects,
      totalGapEvents: this.#gapCount,
      activeGaps: this.gaps(now),
    };
  }

  health(now: Timestamp): V3SourceHealth {
    const freshness = this.freshnessByStream(now);
    const states = Object.values(freshness);
    const missing = states.filter((state) => state === "UNKNOWN").length;
    const stale = states.filter((state) => state === "STALE").length;
    const activeGaps = this.gaps(now);
    const status: V3SourceHealth["status"] =
      this.#lastError !== null && !this.#connected
        ? "ERROR"
        : missing === states.length
          ? "WARMING_UP"
          : stale > 0
            ? "STALE"
            : missing > 0 || activeGaps.length > 0
              ? "DEGRADED"
              : "HEALTHY";
    const dataAgeMs =
      this.#lastSuccessAt === null
        ? null
        : Math.max(0, Date.parse(now) - Date.parse(this.#lastSuccessAt));
    return V3SourceHealthSchema.parse({
      sourceId: SOURCE_ID,
      label: "Binance Spot",
      category: "MARKET",
      capabilityState: this.#lastSuccessAt === null ? "TESTED" : "VERIFIED_CURRENT",
      status,
      transport: "SPOT_WEBSOCKET",
      endpoint: this.#endpoint,
      lastAttemptAt: this.#lastAttemptAt,
      lastSuccessAt: this.#lastSuccessAt,
      dataAgeMs,
      messagesReceived: this.#messages,
      uniqueItems: this.#unique,
      duplicates: this.#duplicates,
      gaps: this.#gapCount,
      reconnects: this.#reconnects,
      errorCode: this.#lastError === null ? null : "WEBSOCKET_DISCONNECTED",
      reason:
        this.#lastError ??
        (status === "HEALTHY"
          ? "All four Spot symbols and both required streams are fresh"
          : `${missing} streams warming up, ${stale} stale, ${activeGaps.length} active window gaps`),
      evidenceIds: [
        ...this.latestTicks().map(({ observationId }) => observationId),
        "config/source-registry.json",
        "tests/unit/binance-spot-adapter.test.ts",
      ],
    });
  }
}

export type WebSocketEventLike = { data?: unknown };
export type WebSocketLike = {
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: WebSocketEventLike) => void,
  ): void;
  close(code?: number, reason?: string): void;
};

export type BinanceSpotAdapterOptions = {
  websocketBaseUrl: string;
  freshnessMs: number;
  reconnectMinimumMs: number;
  reconnectMaximumMs: number;
  gapImpactMs?: number;
  socketFactory?: (url: string) => WebSocketLike;
  now?: () => Date;
  random?: () => number;
  onTick?: (tick: V3MarketTick, gap: string | null) => void;
  onHealth?: (health: V3SourceHealth) => void;
};

function websocketUrl(baseUrl: string): string {
  const streams = SYMBOLS.flatMap((symbol) => [
    `${symbol.toLowerCase()}@aggTrade`,
    `${symbol.toLowerCase()}@bookTicker`,
  ]);
  return `${baseUrl}?streams=${streams.join("/")}`;
}

function eventDataAsText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  throw new TypeError("BINANCE_WEBSOCKET_NON_TEXT_MESSAGE");
}

export class BinanceSpotAdapter {
  readonly processor: BinanceSpotStreamProcessor;
  readonly #options: BinanceSpotAdapterOptions;
  #socket: WebSocketLike | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #attempt = 0;

  constructor(options: BinanceSpotAdapterOptions) {
    this.#options = options;
    this.processor = new BinanceSpotStreamProcessor({
      freshnessMs: options.freshnessMs,
      endpoint: websocketUrl(options.websocketBaseUrl),
      ...(options.gapImpactMs === undefined ? {} : { gapImpactMs: options.gapImpactMs }),
    });
  }

  url(): string {
    return websocketUrl(this.#options.websocketBaseUrl);
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#connect();
  }

  stop(): void {
    this.#running = false;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#socket?.close(1000, "local read-only runtime stopped");
  }

  health(): V3SourceHealth {
    return this.processor.health(timestamp((this.#options.now ?? (() => new Date()))()));
  }

  metrics(): BinanceSoakMetrics {
    return this.processor.metrics(timestamp((this.#options.now ?? (() => new Date()))()));
  }

  #connect(): void {
    const now = timestamp((this.#options.now ?? (() => new Date()))());
    this.processor.markConnecting(now);
    const factory =
      this.#options.socketFactory ??
      ((url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike);
    const socket = factory(this.url());
    this.#socket = socket;
    socket.addEventListener("open", () => {
      const at = timestamp((this.#options.now ?? (() => new Date()))());
      this.#attempt = 0;
      this.processor.markConnected(at);
      this.#options.onHealth?.(this.processor.health(at));
    });
    socket.addEventListener("message", (event) => {
      const receivedAt = timestamp((this.#options.now ?? (() => new Date()))());
      try {
        const result = this.processor.ingest(JSON.parse(eventDataAsText(event.data)), receivedAt);
        if (result.tick !== null) this.#options.onTick?.(result.tick, result.gap);
      } catch (error) {
        this.processor.markDisconnected(
          error instanceof Error ? error.message : "BINANCE_MESSAGE_PARSE_ERROR",
        );
      }
      this.#options.onHealth?.(this.processor.health(receivedAt));
    });
    socket.addEventListener("error", () => {
      this.processor.markDisconnected("Binance Spot WebSocket error");
      this.#options.onHealth?.(this.health());
    });
    socket.addEventListener("close", () => {
      this.processor.markDisconnected("Binance Spot WebSocket closed");
      this.#options.onHealth?.(this.health());
      if (!this.#running) return;
      this.#attempt += 1;
      this.processor.markReconnect();
      const exponential = Math.min(
        this.#options.reconnectMaximumMs,
        this.#options.reconnectMinimumMs * 2 ** Math.min(this.#attempt - 1, 10),
      );
      const jitter = 0.8 + (this.#options.random ?? Math.random)() * 0.4;
      this.#timer = setTimeout(() => this.#connect(), Math.round(exponential * jitter));
    });
  }
}
