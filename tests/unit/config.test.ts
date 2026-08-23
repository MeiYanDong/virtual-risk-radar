import { readFile } from "node:fs/promises";
import {
  createActiveConfigReadback,
  hashActiveConfig,
  parseActiveSystemConfig,
  parseSystemConfig,
} from "@virtual/config";
import { describe, expect, it } from "vitest";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as unknown;
}

describe("v0.3 active system configuration", () => {
  it("parses the two-source default and exposes a deterministic readback", async () => {
    const config = parseActiveSystemConfig(await readJson("../../config/default.json"));
    const readback = createActiveConfigReadback(config);

    expect(readback).toMatchObject({
      mode: "SHADOW",
      economicEvidence: "POSITIVE_EV_NOT_PROVEN",
      outputBasis: "CEX_REFERENCE",
      externalInputCount: 2,
      activeSources: ["techflow-public-newsletter", "binance-spot-public"],
    });
    expect(readback.prohibitedCapabilities).toEqual([
      "RPC",
      "DEX_QUOTE",
      "WALLET_READ",
      "SIGN",
      "BROADCAST",
    ]);
    expect(readback.configHash).toBe(hashActiveConfig(config));
  });

  it("contains no chain, RPC, DEX quote, wallet, derivative, or fallback-source config", async () => {
    const raw = (await readJson("../../config/default.json")) as Record<string, unknown>;
    expect(raw).not.toHaveProperty("chains");
    expect(raw).not.toHaveProperty("quoteResearch");
    expect(raw).not.toHaveProperty("quoteLimits");
    expect(JSON.stringify(raw)).not.toMatch(/BASE_RPC_URL|openInterest|derivative|secondExchange/i);
    const config = parseActiveSystemConfig(raw);
    expect(config.permissions).toEqual({
      readOnly: true,
      signing: "UNSUPPORTED",
      broadcast: "UNSUPPORTED",
      walletRead: "UNSUPPORTED",
      rpc: "UNSUPPORTED",
      dexQuote: "UNSUPPORTED",
    });
  });

  it("keeps extreme market fallback explicitly uncalibrated", async () => {
    const config = parseActiveSystemConfig(await readJson("../../config/default.json"));
    expect(config.model.sell.extremeMarketBreakdown).toMatchObject({
      calibrationState: "NOT_CALIBRATED",
    });
  });

  it("fails fast on unknown active fields", async () => {
    const raw = await readJson("../../config/default.json");
    expect(() =>
      parseActiveSystemConfig({ ...(raw as object), unexpectedExecutionFlag: true }),
    ).toThrow();
  });

  it("retains the v0.2 config only behind the explicit legacy file", async () => {
    const legacy = parseSystemConfig(await readJson("../../config/legacy-v0.2.json"));
    expect(legacy.configVersion).toBe("0.2.0");
    expect(legacy.mode).toBe("REPLAY");
  });
});
