import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyzeV3Fixture } from "../../scripts/analyze-v3-2026-08-22";

describe("2026-08-22 v0.3 two-source replay", () => {
  it("replays deterministically with only TechFlow and Binance Spot inputs", async () => {
    const generated = await analyzeV3Fixture();
    const stored = JSON.parse(
      await readFile(new URL("../fixtures/2026-08-22/v3-analysis.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(generated).toEqual(stored);
    expect(JSON.stringify(generated)).not.toMatch(
      /binance-futures|open-interest|chainProfile|rpcEndpoint/i,
    );
    expect(generated["inputPolicy"]).toMatchObject({
      news: ["TechFlow public newsletter item 133044"],
      excluded: expect.arrayContaining(["RPC", "DEX quote", "wallet", "futures"]),
    });
  }, 20_000);

  it("treats Canada as an entity and reproduces at most a CEX-reference Shadow signal", async () => {
    const report = await analyzeV3Fixture();
    expect(report["techflowEvent"]).toMatchObject({
      eventType: "TRADE_SANCTIONS",
      countries: ["US", "CA"],
      direction: "RISK_OFF",
      severity: "HIGH",
      canadaSpecificRouting: false,
    });
    expect(report["firstSellReady"]).toMatchObject({
      panel: {
        stage: "SELL_READY",
        output: "SHADOW_CANDIDATE",
        outputBasis: "CEX_REFERENCE",
        passed: 4,
      },
    });
    expect(report["conclusion"]).toMatchObject({
      outputBasis: "CEX_REFERENCE",
      executionReceipt: "UNKNOWN:not_recorded",
      dexRealizability: "UNKNOWN:not_measured",
      economicEvidence: "POSITIVE_EV_NOT_PROVEN",
    });
  }, 20_000);

  it("does not hide captured Spot aggregate-ID gaps", async () => {
    const report = await analyzeV3Fixture();
    expect(report["spotOrderFlowCoverage"]).toMatchObject({
      gapEvents: 20,
      rule: expect.stringContaining("UNKNOWN"),
    });
  }, 20_000);
});
