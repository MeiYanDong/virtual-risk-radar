import { TimestampSchema } from "@virtual/domain";
import { z } from "zod";

const capabilityState = z.enum(["PLANNED", "TESTED", "VERIFIED_CURRENT", "UNSUPPORTED"]);

const sharedSource = {
  sourceId: z.string().min(1),
  capabilityState,
  cost: z.literal("FREE"),
  authentication: z.literal("NONE"),
  writeCapability: z.literal("UNSUPPORTED"),
  failureSemantics: z.string().min(1),
};

const newsSourceSchema = z
  .object({
    ...sharedSource,
    category: z.literal("NEWS"),
    kind: z.literal("PUBLIC_WEBPAGE"),
    url: z.literal("https://www.techflowpost.com/newsletter"),
    officialApi: z.literal("NOT_VERIFIED"),
    rss: z.literal("NOT_VERIFIED"),
    availabilitySla: z.literal("NONE"),
    redistributionLicense: z.literal("NOT_VERIFIED"),
    scope: z.literal("LATEST_NEWSLETTER_ITEMS_ONLY"),
    polling: z.string().min(1),
    retention: z.string().min(1),
  })
  .strict();

const marketSourceSchema = z
  .object({
    ...sharedSource,
    category: z.literal("MARKET"),
    kind: z.literal("SPOT_WEBSOCKET"),
    url: z.literal("wss://data-stream.binance.vision/stream"),
    documentationUrl: z.url(),
    symbols: z.tuple([
      z.literal("BTCUSDT"),
      z.literal("ETHUSDT"),
      z.literal("SOLUSDT"),
      z.literal("VIRTUALUSDT"),
    ]),
    streams: z.tuple([z.literal("aggTrade"), z.literal("bookTicker")]),
    takerSideMapping: z.literal("aggTrade.m=true => taker SELL; false => taker BUY"),
    gapSemantics: z.string().min(1),
    retention: z.string().min(1),
  })
  .strict();

export const SourceRegistrySchema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    reviewedAt: TimestampSchema,
    activeSources: z.tuple([newsSourceSchema, marketSourceSchema]),
    prohibitedRuntimeSources: z.tuple([
      z.literal("RPC"),
      z.literal("CHAIN_MONITORING"),
      z.literal("DEX_QUOTE"),
      z.literal("WALLET_READ"),
      z.literal("DERIVATIVES"),
      z.literal("SECOND_EXCHANGE"),
      z.literal("SECOND_NEWS_SOURCE"),
      z.literal("PAID_SOURCE"),
    ]),
    upgradeRule: z.string().min(1),
  })
  .strict();

export type SourceRegistry = z.infer<typeof SourceRegistrySchema>;

export function parseSourceRegistry(input: unknown): SourceRegistry {
  const registry = SourceRegistrySchema.parse(input);
  const ids = registry.activeSources.map(({ sourceId }) => sourceId);
  if (new Set(ids).size !== ids.length) throw new Error("Source IDs must be globally unique");
  return registry;
}
