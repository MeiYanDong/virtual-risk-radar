import { readFileSync } from "node:fs";
import { parseSourceRegistry } from "@virtual/config";
import { describe, expect, it } from "vitest";

function registry() {
  return parseSourceRegistry(
    JSON.parse(readFileSync(new URL("../../config/source-registry.json", import.meta.url), "utf8")),
  );
}

describe("v0.3 active source registry", () => {
  it("declares exactly TechFlow public webpage and Binance Spot", () => {
    const value = registry();
    expect(value.activeSources.map(({ sourceId }) => sourceId)).toEqual([
      "techflow-public-newsletter",
      "binance-spot-public",
    ]);
    expect(value.activeSources.every(({ capabilityState }) => capabilityState === "TESTED")).toBe(
      true,
    );
  });

  it("records TechFlow as free public HTML without invented API, RSS, SLA, or license", () => {
    expect(registry().activeSources[0]).toMatchObject({
      category: "NEWS",
      kind: "PUBLIC_WEBPAGE",
      cost: "FREE",
      officialApi: "NOT_VERIFIED",
      rss: "NOT_VERIFIED",
      availabilitySla: "NONE",
      redistributionLicense: "NOT_VERIFIED",
      scope: "LATEST_NEWSLETTER_ITEMS_ONLY",
    });
  });

  it("limits Binance to four Spot symbols and two public streams", () => {
    expect(registry().activeSources[1]).toMatchObject({
      category: "MARKET",
      kind: "SPOT_WEBSOCKET",
      symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "VIRTUALUSDT"],
      streams: ["aggTrade", "bookTicker"],
      takerSideMapping: "aggTrade.m=true => taker SELL; false => taker BUY",
    });
  });

  it("makes every excluded runtime source and all writes explicit", () => {
    const value = registry();
    expect(
      value.activeSources.every(({ writeCapability }) => writeCapability === "UNSUPPORTED"),
    ).toBe(true);
    expect(value.prohibitedRuntimeSources).toEqual([
      "RPC",
      "CHAIN_MONITORING",
      "DEX_QUOTE",
      "WALLET_READ",
      "DERIVATIVES",
      "SECOND_EXCHANGE",
      "SECOND_NEWS_SOURCE",
      "PAID_SOURCE",
    ]);
  });
});
