import { readFileSync } from "node:fs";
import { parseActiveStateMachineSpec } from "@virtual/config";
import { describe, expect, it } from "vitest";

function spec() {
  return parseActiveStateMachineSpec(
    JSON.parse(readFileSync(new URL("../../config/state-machines.json", import.meta.url), "utf8")),
  );
}

describe("v0.3 active state-machine contract", () => {
  it("freezes four sell and four rebuy conditions with CEX-only output", () => {
    const value = spec();
    expect(value.sell.requiredConditionDenominator).toBe(4);
    expect(value.rebuy.requiredConditionDenominator).toBe(4);
    expect(value.sell.confirmationRule).toBe("ALL_FOUR_PASS");
    expect(value.rebuy.confirmationRule).toBe("ALL_FOUR_PASS_AND_SELL_CONTEXT");
    expect(value.outputBasis).toBe("CEX_REFERENCE");
    expect(value.execution).toMatchObject({
      maximumOutput: "SHADOW_CANDIDATE",
      rpc: "UNSUPPORTED",
      dexQuote: "UNSUPPORTED",
      walletRead: "UNSUPPORTED",
      signing: "UNSUPPORTED",
      broadcast: "UNSUPPORTED",
    });
  });

  it("keeps the market-only fallback visibly uncalibrated", () => {
    expect(spec().sell.extremeMarketFallback).toBe("NOT_CALIBRATED");
  });

  it("rejects a missing or reordered active condition", () => {
    const raw = JSON.parse(
      readFileSync(new URL("../../config/state-machines.json", import.meta.url), "utf8"),
    ) as { sell: { conditionIds: string[] } };
    raw.sell.conditionIds.reverse();
    expect(() => parseActiveStateMachineSpec(raw)).toThrow();
  });
});
