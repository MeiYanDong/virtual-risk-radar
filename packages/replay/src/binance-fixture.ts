import {
  decimal,
  known,
  MarketObservationSchema,
  timestamp,
  type Asset,
  type MarketObservation,
} from "@virtual/domain";
import { z } from "zod";
import type { ReplayEvent } from "./replay";

export const BinanceSpotKlineSchema = z.tuple([
  z.number().int(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.number().int(),
  z.string(),
  z.number().int(),
  z.string(),
  z.string(),
  z.string(),
]);
export type BinanceSpotKline = z.infer<typeof BinanceSpotKlineSchema>;

export const BinanceAggregateTradeSchema = z
  .object({
    a: z.number().int().nonnegative(),
    p: z.string(),
    q: z.string(),
    T: z.number().int(),
    m: z.boolean(),
  })
  .passthrough();
export type BinanceAggregateTrade = z.infer<typeof BinanceAggregateTradeSchema>;

export function normalizeSpotKlineCloses(
  rawRows: unknown[],
  asset: Asset,
  sourceId = "binance-spot-public",
): MarketObservation[] {
  return rawRows.map((raw) => {
    const row = BinanceSpotKlineSchema.parse(raw);
    const observedAt = timestamp(new Date(row[6]));
    return MarketObservationSchema.parse({
      observationId: `${sourceId}:${asset}:kline-1s:${row[0]}`,
      sourceId,
      instrumentId: `${asset}USDT`,
      asset,
      quoteAsset: "USDT",
      venueType: "SPOT",
      marketRole: "PRICE_REFERENCE",
      observationKind: "KLINE_CLOSE",
      eventTime: observedAt,
      receivedAt: observedAt,
      price: decimal(row[4]),
      quantity: known(decimal(row[5]), observedAt, [`${sourceId}:kline:${row[0]}`]),
      takerSide: "UNKNOWN",
      sequence: known(String(row[0]), observedAt, [`${sourceId}:kline:${row[0]}`]),
      schemaVersion: "1.0.0",
      evidenceIds: [`${sourceId}:kline:${row[0]}`],
    });
  });
}

export function normalizeVirtualFuturesAggregateTrades(
  rawRows: unknown[],
  sourceId = "binance-usdm-public",
): MarketObservation[] {
  return rawRows.map((raw) => {
    const row = BinanceAggregateTradeSchema.parse(raw);
    const observedAt = timestamp(new Date(row.T));
    return MarketObservationSchema.parse({
      observationId: `${sourceId}:VIRTUAL:aggTrade:${row.a}`,
      sourceId,
      instrumentId: "VIRTUALUSDT-PERP",
      asset: "VIRTUAL",
      quoteAsset: "USDT",
      venueType: "FUTURES",
      marketRole: "ORDER_FLOW_REFERENCE",
      observationKind: "AGGREGATE_TRADE",
      eventTime: observedAt,
      receivedAt: observedAt,
      price: decimal(row.p),
      quantity: known(decimal(row.q), observedAt, [`${sourceId}:aggTrade:${row.a}`]),
      takerSide: row.m ? "SELL" : "BUY",
      sequence: known(String(row.a), observedAt, [`${sourceId}:aggTrade:${row.a}`]),
      schemaVersion: "1.0.0",
      evidenceIds: [`${sourceId}:aggTrade:${row.a}`],
    });
  });
}

export function marketObservationsToReplayEvents(observations: MarketObservation[]): ReplayEvent[] {
  return [...observations]
    .sort((left, right) => {
      const time = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
      return time === 0 ? left.observationId.localeCompare(right.observationId) : time;
    })
    .map((observation, index) => ({
      eventId: observation.observationId,
      sourceOccurredAt: observation.eventTime,
      receivedAt: observation.receivedAt,
      ingestionSequence: index + 1,
      kind: "MARKET_OBSERVATION",
      payload: { observation },
    }));
}

export function replayPayloadAsMarketObservation(event: ReplayEvent): MarketObservation {
  const observation = event.payload["observation"];
  if (observation === undefined) throw new TypeError("Replay payload lacks a market observation");
  return MarketObservationSchema.parse(observation);
}
