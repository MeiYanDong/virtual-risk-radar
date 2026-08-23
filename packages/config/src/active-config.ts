import { createHash } from "node:crypto";
import { HashSchema, TimestampSchema, type Hash, type Timestamp } from "@virtual/domain";
import { z } from "zod";

const decimalThreshold = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const activeAssets = z.tuple([
  z.literal("BTC"),
  z.literal("ETH"),
  z.literal("SOL"),
  z.literal("VIRTUAL"),
]);

export const ActiveSystemConfigSchema = z
  .object({
    schemaVersion: z.literal("1.1.0"),
    modelVersion: z.string().min(1),
    configVersion: z.string().min(1),
    effectiveAt: TimestampSchema,
    mode: z.enum(["REPLAY", "SHADOW", "LIVE_READ_ONLY"]),
    economicEvidence: z.literal("POSITIVE_EV_NOT_PROVEN"),
    outputBasis: z.literal("CEX_REFERENCE"),
    time: z
      .object({
        internalTimezone: z.literal("UTC"),
        uiTimezone: z.literal("Asia/Shanghai"),
        maximumClockDriftMs: z.number().int().nonnegative(),
      })
      .strict(),
    permissions: z
      .object({
        readOnly: z.literal(true),
        signing: z.literal("UNSUPPORTED"),
        broadcast: z.literal("UNSUPPORTED"),
        walletRead: z.literal("UNSUPPORTED"),
        rpc: z.literal("UNSUPPORTED"),
        dexQuote: z.literal("UNSUPPORTED"),
      })
      .strict(),
    retention: z
      .object({
        rawDays: z.number().int().positive(),
        cursorPath: z.string().min(1),
        journalPath: z.string().min(1),
      })
      .strict(),
    newsSource: z
      .object({
        sourceId: z.literal("techflow-public-newsletter"),
        url: z.url().startsWith("https://www.techflowpost.com/newsletter"),
        accessMethod: z.literal("PUBLIC_WEBPAGE"),
        cost: z.literal("FREE"),
        pollIntervalMs: z.number().int().min(5_000),
        requestTimeoutMs: z.number().int().positive(),
        freshnessSeconds: z.number().int().positive(),
        macroArmWindowSeconds: z.number().int().positive(),
        maxItemsPerPoll: z.number().int().positive().max(100),
        bodyExcerptCharacters: z.number().int().positive().max(2_000),
      })
      .strict(),
    marketSource: z
      .object({
        sourceId: z.literal("binance-spot-public"),
        websocketBaseUrl: z.literal("wss://stream.binance.com:9443/stream"),
        assets: activeAssets,
        symbols: z
          .object({
            BTC: z.literal("BTCUSDT"),
            ETH: z.literal("ETHUSDT"),
            SOL: z.literal("SOLUSDT"),
            VIRTUAL: z.literal("VIRTUALUSDT"),
          })
          .strict(),
        streams: z.tuple([z.literal("aggTrade"), z.literal("bookTicker")]),
        freshnessMs: z.number().int().positive(),
        reconnectMinimumMs: z.number().int().positive(),
        reconnectMaximumMs: z.number().int().positive(),
        rollingWindowSeconds: z.number().int().positive(),
      })
      .strict()
      .superRefine((source, context) => {
        if (source.reconnectMaximumMs < source.reconnectMinimumMs) {
          context.addIssue({
            code: "custom",
            path: ["reconnectMaximumMs"],
            message: "reconnectMaximumMs must be greater than or equal to reconnectMinimumMs",
          });
        }
      }),
    model: z
      .object({
        sell: z
          .object({
            returnWindowSeconds: z.number().int().positive(),
            crossAssetReturnMaximum: z
              .object({
                BTC: decimalThreshold,
                ETH: decimalThreshold,
                SOL: decimalThreshold,
              })
              .strict(),
            crossAssetMinimumPassing: z.number().int().min(2).max(3),
            virtualRelativeReturnMaximum: decimalThreshold,
            virtualBuySellRatioMaximum: decimalThreshold,
            sellPressurePersistenceSeconds: z.number().int().positive(),
            extremeMarketBreakdown: z
              .object({
                calibrationState: z.literal("NOT_CALIBRATED"),
                reason: z.string().min(1),
              })
              .strict(),
          })
          .strict(),
        rebuy: z
          .object({
            macroQuietSeconds: z.number().int().positive(),
            noNewLowSeconds: z.number().int().positive(),
            virtualRelativeReturnMinimum: decimalThreshold,
            relativeRecoveryPersistenceSeconds: z.number().int().positive(),
            virtualBuySellRatioMinimum: decimalThreshold,
            flowNormalizationPersistenceSeconds: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ActiveSystemConfig = z.infer<typeof ActiveSystemConfigSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function parseActiveSystemConfig(input: unknown): Readonly<ActiveSystemConfig> {
  return Object.freeze(ActiveSystemConfigSchema.parse(input));
}

export function hashActiveConfig(config: ActiveSystemConfig): Hash {
  const payload = JSON.stringify(canonicalize(config));
  return HashSchema.parse(`sha256:${createHash("sha256").update(payload).digest("hex")}`);
}

export type ActiveConfigReadback = {
  schemaVersion: "1.1.0";
  modelVersion: string;
  configVersion: string;
  configHash: Hash;
  effectiveAt: Timestamp;
  mode: ActiveSystemConfig["mode"];
  economicEvidence: "POSITIVE_EV_NOT_PROVEN";
  outputBasis: "CEX_REFERENCE";
  activeSources: readonly ["techflow-public-newsletter", "binance-spot-public"];
  externalInputCount: 2;
  prohibitedCapabilities: readonly ["RPC", "DEX_QUOTE", "WALLET_READ", "SIGN", "BROADCAST"];
};

export function createActiveConfigReadback(config: ActiveSystemConfig): ActiveConfigReadback {
  return {
    schemaVersion: config.schemaVersion,
    modelVersion: config.modelVersion,
    configVersion: config.configVersion,
    configHash: hashActiveConfig(config),
    effectiveAt: config.effectiveAt,
    mode: config.mode,
    economicEvidence: config.economicEvidence,
    outputBasis: config.outputBasis,
    activeSources: [config.newsSource.sourceId, config.marketSource.sourceId],
    externalInputCount: 2,
    prohibitedCapabilities: ["RPC", "DEX_QUOTE", "WALLET_READ", "SIGN", "BROADCAST"],
  };
}
