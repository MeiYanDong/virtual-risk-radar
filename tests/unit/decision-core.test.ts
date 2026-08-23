import { readFileSync } from "node:fs";
import {
  booleanCondition,
  compositeCondition,
  directionalCondition,
  evaluateChainExecutability,
  evaluateRebuy,
  evaluateSell,
  nextSecond,
  type ChainQuoteInput,
  type SellFact,
} from "@virtual/decision";
import { parseSystemConfig, type SystemConfig } from "@virtual/config";
import {
  decimal,
  knowledgeError,
  known,
  timestamp,
  unknown,
  unsupported,
  type ChainQuote,
  type FeatureSnapshot,
  type Knowledge,
} from "@virtual/domain";
import { describe, expect, it } from "vitest";

const NOW = timestamp("2026-08-22T05:07:13.000Z");
const EXPIRES = timestamp("2026-08-22T05:08:13.000Z");
const STALE = timestamp("2026-08-22T05:07:12.000Z");

function config(options?: {
  economicEvidence?: SystemConfig["economicEvidence"];
  mode?: SystemConfig["mode"];
  quoteLimits?: SystemConfig["quoteLimits"];
}): SystemConfig {
  const raw = JSON.parse(
    readFileSync(new URL("../../config/legacy-v0.2.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  return parseSystemConfig({
    ...raw,
    economicEvidence: options?.economicEvidence ?? "POSITIVE_EV_NOT_PROVEN",
    mode: options?.mode ?? "REPLAY",
    quoteLimits: options?.quoteLimits ?? {
      state: "SET",
      maximumPriceImpactBps: "100",
      maximumRoundTripCostPct: "0.02",
      maximumGasSettlement: "5",
    },
  });
}

function numericKnowledge(value: string, evidenceId = "market-evidence") {
  return known(decimal(value), NOW, [evidenceId], EXPIRES);
}

function integerKnowledge(value: number, evidenceId = "market-evidence") {
  return known(value, NOW, [evidenceId], EXPIRES);
}

function features(overrides: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  const base: FeatureSnapshot = {
    snapshotId: "snapshot-1",
    asOf: NOW,
    modelVersion: "0.1.0",
    formulaVersion: "formula-v1",
    parameterVersion: "parameters-v1",
    return60s: {
      BTC: numericKnowledge("-0.002", "btc-return"),
      ETH: numericKnowledge("-0.003", "eth-return"),
      SOL: numericKnowledge("-0.01", "sol-return"),
      VIRTUAL: numericKnowledge("-0.01", "virtual-return"),
    },
    maxDrawdown60s: {
      BTC: numericKnowledge("-0.002"),
      ETH: numericKnowledge("-0.003"),
      SOL: numericKnowledge("-0.01"),
      VIRTUAL: numericKnowledge("-0.01"),
    },
    robustSigma60s: {
      BTC: numericKnowledge("0.0004"),
      ETH: numericKnowledge("0.0005"),
      SOL: numericKnowledge("0.002"),
      VIRTUAL: numericKnowledge("0.001"),
    },
    virtualTakerBuyNotional60s: numericKnowledge("500", "virtual-flow"),
    virtualTakerSellNotional60s: numericKnowledge("1000", "virtual-flow"),
    virtualTakerBuySellRatio60s: numericKnowledge("0.5", "virtual-flow"),
    virtualNetTakerFlow60s: numericKnowledge("-1000", "virtual-flow"),
    virtualOrderFlowZScore60s: unknown("warm-up incomplete", NOW),
    virtualExcessReturn60s: numericKnowledge("-0.005", "relative-weakness"),
    virtualSellPressureSeconds: integerKnowledge(3, "sell-persistence"),
    virtualOrderFlowRecoverySeconds: integerKnowledge(30, "recovery-persistence"),
    broadMarketStabilitySeconds: integerKnowledge(30, "stability-persistence"),
    marketShockBreadth: integerKnowledge(3, "market-breadth"),
    broadMarketVolumeAnomaly: numericKnowledge("2", "market-volume"),
    riskArmedAt: known(timestamp("2026-08-22T05:00:00.000Z"), NOW, ["risk-arm"]),
    oiBaselineContracts: numericKnowledge("100000", "oi-baseline"),
    oiContractsChangeFromBaselinePct: numericKnowledge("-0.06", "oi-flush"),
    eventRunningLow: numericKnowledge("0.7", "running-low"),
    secondsSinceLastEventLow: integerKnowledge(300, "running-low"),
    newsRiskContext: "NEWS_ARMED",
    permanentDamage: "PASS",
    dataHealth: {
      state: "PASS",
      staleSources: [],
      gapSources: [],
      clockDriftMs: numericKnowledge("0", "clock"),
      futureDataDetected: false,
      observedAt: NOW,
    },
    sourceCoverage: { virtualTrades60s: numericKnowledge("1", "coverage") },
    freshnessByFeature: { virtualFlow60s: "FRESH" },
    evidenceIds: ["snapshot-evidence"],
  };
  return { ...base, ...overrides };
}

function quote(
  side: ChainQuote["side"] = "SELL_VIRTUAL",
  overrides: Partial<ChainQuote> = {},
): ChainQuote {
  return {
    quoteId: `quote-${side.toLowerCase()}`,
    chainProfileId: "base-mainnet-virtual-v1",
    walletProfileId: "public-wallet-1",
    side,
    amountIn: decimal("100"),
    expectedOut: decimal("75"),
    minimumOut: decimal("74"),
    priceImpactBps: decimal("25"),
    totalCostPct: decimal("0.01"),
    routeFees: decimal("0.1"),
    estimatedGas: decimal("0.01"),
    gasCurrency: "ETH",
    effectivePrice: decimal("0.75"),
    routeId: "route-1",
    blockNumber: "123456",
    observedAt: NOW,
    expiresAt: EXPIRES,
    simulationState: "PASS",
    identityState: "PASS",
    routeState: "PASS",
    walletBalanceState: "PASS",
    evidenceIds: ["quote-evidence"],
    ...overrides,
  };
}

function quoteInput(
  side: ChainQuote["side"] = "SELL_VIRTUAL",
  overrides: Partial<ChainQuote> = {},
  knowledgeOverride?: Knowledge<ChainQuote>,
): ChainQuoteInput {
  const value = quote(side, overrides);
  return {
    chainProfileId: value.chainProfileId,
    quote: knowledgeOverride ?? known(value, NOW, value.evidenceIds, EXPIRES),
  };
}

const sellFact: SellFact = {
  state: "SHADOW_QUOTED",
  chainProfileId: "base-mainnet-virtual-v1",
  amountSold: decimal("100"),
  settlementProceeds: decimal("75"),
  evidenceIds: ["shadow-sell-evidence"],
  observedAt: NOW,
};

describe("condition evaluation", () => {
  it.each([
    ["-0.011", "PASS", "1", "0"],
    ["-0.01", "PASS", "1", "0"],
    ["-0.009", "FAIL", "0.9", "0.001"],
  ] as const)(
    "evaluates LTE boundary current=%s as %s",
    (current, expectedState, expectedProgress, expectedGap) => {
      const result = directionalCondition({
        conditionId: "boundary",
        modelId: "SELL",
        modelVersion: "0.1.0",
        current: numericKnowledge(current),
        operator: "LTE",
        target: decimal("-0.01"),
        now: NOW,
        reason: "boundary test",
      });

      expect(result.state).toBe(expectedState);
      expect(result.normalizedProgress).toMatchObject({
        state: "KNOWN",
        value: expectedProgress,
      });
      expect(result.gapToTarget).toMatchObject({ state: "KNOWN", value: expectedGap });
    },
  );

  it("keeps UNKNOWN and STALE distinct from zero and failure", () => {
    const missing = directionalCondition({
      conditionId: "unknown",
      modelId: "SELL",
      modelVersion: "0.1.0",
      current: unknown("not recorded", NOW),
      operator: "GTE",
      target: decimal("3"),
      now: NOW,
      reason: "persistence",
    });
    const stale = directionalCondition({
      conditionId: "stale",
      modelId: "SELL",
      modelVersion: "0.1.0",
      current: known(decimal("3"), NOW, ["old"], STALE),
      operator: "GTE",
      target: decimal("3"),
      now: NOW,
      reason: "persistence",
    });

    expect(missing.state).toBe("UNKNOWN");
    expect(missing.normalizedProgress.state).toBe("UNKNOWN");
    expect(stale.state).toBe("STALE");
    expect(stale.normalizedProgress).toMatchObject({ state: "KNOWN", value: "1" });
  });

  it("uses the weakest child as an AND summary and propagates unknown", () => {
    const pass = booleanCondition({
      conditionId: "pass",
      modelId: "SELL",
      modelVersion: "0.1.0",
      value: true,
      now: NOW,
      passReason: "pass",
      failReason: "fail",
      evidenceIds: ["pass-evidence"],
    });
    const fail = directionalCondition({
      conditionId: "partial",
      modelId: "SELL",
      modelVersion: "0.1.0",
      current: numericKnowledge("5"),
      operator: "GTE",
      target: decimal("10"),
      now: NOW,
      reason: "partial",
    });
    const partial = compositeCondition({
      conditionId: "all",
      modelId: "SELL",
      modelVersion: "0.1.0",
      children: [pass, fail],
      now: NOW,
      passReason: "all pass",
      failReason: "incomplete",
    });
    const missing = compositeCondition({
      conditionId: "all-unknown",
      modelId: "SELL",
      modelVersion: "0.1.0",
      children: [
        pass,
        booleanCondition({
          conditionId: "missing",
          modelId: "SELL",
          modelVersion: "0.1.0",
          value: "UNKNOWN",
          now: NOW,
          passReason: "pass",
          failReason: "fail",
          evidenceIds: [],
        }),
      ],
      now: NOW,
      passReason: "all pass",
      failReason: "incomplete",
    });

    expect(partial.state).toBe("FAIL");
    expect(partial.normalizedProgress).toMatchObject({ state: "KNOWN", value: "0.5" });
    expect(missing.state).toBe("UNKNOWN");
    expect(missing.normalizedProgress.state).toBe("UNKNOWN");
  });
});

describe("chain executability hard gates", () => {
  function evaluate(
    input: {
      quote?: ChainQuoteInput;
      side?: ChainQuote["side"];
      signalReady?: boolean;
      mode?: SystemConfig["mode"];
      economicEvidence?: SystemConfig["economicEvidence"];
      quoteLimits?: SystemConfig["quoteLimits"];
    } = {},
  ) {
    return evaluateChainExecutability({
      quoteInput: input.quote ?? quoteInput(input.side),
      expectedSide: input.side ?? "SELL_VIRTUAL",
      signalReady: input.signalReady ?? true,
      mode: input.mode ?? "REPLAY",
      economicEvidence: input.economicEvidence ?? "POSITIVE_EV_NOT_PROVEN",
      quoteLimits: input.quoteLimits ?? config().quoteLimits,
      now: NOW,
    });
  }

  it("does not request action before the market signal is ready", () => {
    expect(evaluate({ signalReady: false }).actionState).toBe("SIGNAL_NOT_READY");
  });

  it.each([
    [unknown("not recorded", NOW), "QUOTE_PENDING"],
    [unsupported("adapter unavailable"), "UNSUPPORTED"],
    [knowledgeError("provider failed", NOW, true), "BLOCKED_DATA"],
  ] as const)("maps non-known quote state to %s", (quoteState, expected) => {
    expect(
      evaluate({
        quote: { chainProfileId: "base-mainnet-virtual-v1", quote: quoteState },
      }).actionState,
    ).toBe(expected);
  });

  it.each([
    [{ expiresAt: STALE }, "BLOCKED_DATA"],
    [{ side: "BUY_VIRTUAL" as const }, "BLOCKED_IDENTITY"],
    [{ identityState: "UNKNOWN" as const }, "BLOCKED_IDENTITY"],
    [{ routeState: "FAIL" as const }, "BLOCKED_LIQUIDITY"],
    [{ walletBalanceState: "UNKNOWN" as const }, "BLOCKED_DATA"],
    [{ simulationState: "FAIL" as const }, "BLOCKED_LIQUIDITY"],
    [{ priceImpactBps: decimal("101") }, "BLOCKED_COST"],
    [{ totalCostPct: decimal("0.021") }, "BLOCKED_COST"],
    [{ estimatedGas: decimal("5.1") }, "BLOCKED_COST"],
  ] as const)("blocks invalid quote evidence as %s", (overrides, expected) => {
    const value = quote("SELL_VIRTUAL", overrides);
    expect(
      evaluate({
        quote: {
          chainProfileId: value.chainProfileId,
          quote: known(value, NOW, value.evidenceIds, value.expiresAt),
        },
      }).actionState,
    ).toBe(expected);
  });

  it("blocks a valid quote until explicit cost limits exist", () => {
    expect(
      evaluate({
        quoteLimits: { state: "UNSET", reason: "user limits missing" },
      }).actionState,
    ).toBe("BLOCKED_COST");
  });

  it("caps replay and unproven economics at SHADOW_CANDIDATE", () => {
    expect(evaluate().actionState).toBe("SHADOW_CANDIDATE");
    expect(
      evaluate({ mode: "LIVE_READ_ONLY", economicEvidence: "POSITIVE_EV_NOT_PROVEN" }).actionState,
    ).toBe("SHADOW_CANDIDATE");
  });

  it("uses ACTIONABLE_WITH_EVIDENCE only for live read-only mode with proven economics", () => {
    expect(evaluate({ mode: "LIVE_READ_ONLY", economicEvidence: "PASS" }).actionState).toBe(
      "ACTIONABLE_WITH_EVIDENCE",
    );
  });
});

describe("sell decision", () => {
  it("never sells from news alone", () => {
    const snapshot = features({
      return60s: {
        BTC: numericKnowledge("0"),
        ETH: numericKnowledge("0"),
        SOL: numericKnowledge("0"),
        VIRTUAL: numericKnowledge("0"),
      },
      marketShockBreadth: integerKnowledge(0),
      broadMarketVolumeAnomaly: numericKnowledge("1"),
    });
    const decision = evaluateSell({
      config: config(),
      features: snapshot,
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput()],
    });

    expect(decision.stage).toBe("NEWS_ARMED");
    expect(decision.recommendedAction).toBe("WATCH");
    expect(decision.chainExecutability[0]?.actionState).toBe("SIGNAL_NOT_READY");
  });

  it("arms from strict market data without news but waits for the shock", () => {
    const snapshot = features({
      newsRiskContext: "NO_NEWS",
      return60s: {
        BTC: numericKnowledge("0"),
        ETH: numericKnowledge("0"),
        SOL: numericKnowledge("0"),
        VIRTUAL: numericKnowledge("0"),
      },
    });
    const decision = evaluateSell({
      config: config(),
      features: snapshot,
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput()],
    });

    expect(decision.stage).toBe("MARKET_ARMED");
    expect(decision.recommendedAction).toBe("WATCH");
  });

  it("produces first and second shadow tranches at the two market stages", () => {
    const pretrigger = evaluateSell({
      config: config(),
      features: features({
        virtualTakerBuySellRatio60s: numericKnowledge("1.2"),
        virtualSellPressureSeconds: integerKnowledge(0),
      }),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput()],
    });
    const confirmed = evaluateSell({
      config: config(),
      features: features(),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput()],
    });

    expect(pretrigger.stage).toBe("SELL_PRETRIGGER");
    expect(pretrigger.recommendedAction).toBe("SHADOW_SELL_TRANCHE_1");
    expect(pretrigger.recommendedFractionOfTacticalSleeve).toBe("0.25");
    expect(confirmed.stage).toBe("SELL_CONFIRMED");
    expect(confirmed.recommendedAction).toBe("SHADOW_SELL_TRANCHE_2");
    expect(confirmed.recommendedFractionOfTacticalSleeve).toBe("0.75");
    expect(confirmed.absoluteAmount.state).toBe("UNKNOWN");
  });

  it("keeps Base and Robinhood quote evidence isolated", () => {
    const robinhoodUnknown: ChainQuoteInput = {
      chainProfileId: "robinhood-unknown-v1",
      quote: unknown("network identity and route not configured", NOW),
    };
    const decision = evaluateSell({
      config: config(),
      features: features(),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput(), robinhoodUnknown],
    });

    expect(decision.chainExecutability.map(({ actionState }) => actionState)).toEqual([
      "SHADOW_CANDIDATE",
      "QUOTE_PENDING",
    ]);
    expect(decision.recommendedAction).toBe("SHADOW_SELL_TRANCHE_2");
  });

  it("blocks on degraded or future-contaminated data", () => {
    const decision = evaluateSell({
      config: config(),
      features: features({
        dataHealth: {
          state: "PASS",
          staleSources: [],
          gapSources: [],
          clockDriftMs: numericKnowledge("0"),
          futureDataDetected: true,
          observedAt: NOW,
        },
      }),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput()],
    });

    expect(decision.stage).toBe("DATA_BLOCKED");
    expect(decision.recommendedAction).toBe("BLOCKED");
    expect(decision.hardGates[0]?.state).toBe("VETO");
  });

  it("is deterministic and preserves stage entry time while the stage is unchanged", () => {
    const input = {
      config: config(),
      features: features(),
      mode: "REPLAY" as const,
      now: NOW,
      quotes: [quoteInput()],
      previousStage: "SELL_CONFIRMED" as const,
      previousStageEnteredAt: timestamp("2026-08-22T05:07:00.000Z"),
    };
    const first = evaluateSell(input);
    const second = evaluateSell(input);

    expect(first).toEqual(second);
    expect(first.decisionId).toBe(second.decisionId);
    expect(first.stageEnteredAt).toBe("2026-08-22T05:07:00.000Z");
  });

  it("uses live actionable language only after the explicit EV gate passes", () => {
    const decision = evaluateSell({
      config: config({ economicEvidence: "PASS", mode: "LIVE_READ_ONLY" }),
      features: features(),
      mode: "LIVE_READ_ONLY",
      now: NOW,
      quotes: [quoteInput()],
    });

    expect(decision.chainExecutability[0]?.actionState).toBe("ACTIONABLE_WITH_EVIDENCE");
    expect(decision.recommendedAction).toBe("SELL_TRANCHE_2");
  });
});

describe("rebuy decision", () => {
  function recoveredFeatures(overrides: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
    return features({
      newsRiskContext: "NO_NEWS",
      return60s: {
        BTC: numericKnowledge("0"),
        ETH: numericKnowledge("0"),
        SOL: numericKnowledge("0"),
        VIRTUAL: numericKnowledge("0.002"),
      },
      virtualTakerBuySellRatio60s: numericKnowledge("1.2"),
      virtualNetTakerFlow60s: numericKnowledge("1000"),
      ...overrides,
    });
  }

  it("stays inactive without an auditable sell fact", () => {
    const decision = evaluateRebuy({
      config: config(),
      features: recoveredFeatures(),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput("BUY_VIRTUAL")],
      sellFact: { state: "NONE" },
    });

    expect(decision.stage).toBe("REBUY_INACTIVE");
    expect(decision.recommendedAction).toBe("NO_ACTION");
    expect(decision.chainExecutability[0]?.actionState).toBe("SIGNAL_NOT_READY");
  });

  it.each(["FAIL", "UNKNOWN", "UNKNOWN_REVIEW_REQUIRED"] as const)(
    "vetoes rebuy when permanent damage is %s",
    (permanentDamage) => {
      const decision = evaluateRebuy({
        config: config(),
        features: recoveredFeatures({ permanentDamage }),
        mode: "REPLAY",
        now: NOW,
        quotes: [quoteInput("BUY_VIRTUAL")],
        sellFact,
      });

      expect(decision.stage).toBe("REBUY_VETOED");
      expect(decision.recommendedAction).toBe("VETOED");
      expect(decision.hardGates[1]?.state).toBe("VETO");
    },
  );

  it("arms when four market components are close but not all pass", () => {
    const decision = evaluateRebuy({
      config: config(),
      features: recoveredFeatures({ secondsSinceLastEventLow: integerKnowledge(299) }),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput("BUY_VIRTUAL")],
      sellFact,
    });

    expect(decision.stage).toBe("REBUY_ARMED");
    expect(decision.recommendedAction).toBe("PREPARE_REBUY_QUOTE");
    expect(
      decision.conditions.find(({ conditionId }) => conditionId === "B1-NO-NEW-LOW")?.state,
    ).toBe("FAIL");
  });

  it("produces a first shadow rebuy only after all conditions and quote pass", () => {
    const decision = evaluateRebuy({
      config: config(),
      features: recoveredFeatures(),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput("BUY_VIRTUAL")],
      sellFact,
    });

    expect(decision.stage).toBe("REBUY_TRANCHE_1");
    expect(decision.passedRequiredCount).toBe(5);
    expect(decision.recommendedAction).toBe("SHADOW_REBUY_TRANCHE_1");
    expect(decision.recommendedFractionOfTacticalSleeve).toBe("0.5");
  });

  it("waits five minutes before the second tranche", () => {
    const firstCompletedAt = timestamp("2026-08-22T05:02:14.000Z");
    const waiting = evaluateRebuy({
      config: config(),
      features: recoveredFeatures(),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput("BUY_VIRTUAL")],
      sellFact,
      firstTrancheCompletedAt: firstCompletedAt,
    });
    const complete = evaluateRebuy({
      config: config(),
      features: recoveredFeatures(),
      mode: "REPLAY",
      now: nextSecond(NOW),
      quotes: [
        quoteInput(
          "BUY_VIRTUAL",
          {
            observedAt: nextSecond(NOW),
            expiresAt: timestamp("2026-08-22T05:09:00.000Z"),
          },
          known(
            quote("BUY_VIRTUAL", {
              observedAt: nextSecond(NOW),
              expiresAt: timestamp("2026-08-22T05:09:00.000Z"),
            }),
            nextSecond(NOW),
            ["quote-evidence"],
            timestamp("2026-08-22T05:09:00.000Z"),
          ),
        ),
      ],
      sellFact,
      firstTrancheCompletedAt: firstCompletedAt,
    });

    expect(waiting.stage).toBe("REBUY_TRANCHE_2_WAIT");
    expect(waiting.recommendedAction).toBe("WATCH");
    expect(complete.stage).toBe("REBUY_COMPLETE");
    expect(complete.recommendedAction).toBe("SHADOW_REBUY_TRANCHE_2");
  });

  it("returns to wait if a new low invalidates recovery after tranche one", () => {
    const decision = evaluateRebuy({
      config: config(),
      features: recoveredFeatures({ secondsSinceLastEventLow: integerKnowledge(0) }),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput("BUY_VIRTUAL")],
      sellFact,
      firstTrancheCompletedAt: timestamp("2026-08-22T05:00:00.000Z"),
    });

    expect(decision.stage).toBe("REBUY_WAIT");
    expect(decision.recommendedAction).toBe("WATCH");
  });

  it("blocks on unknown OI instead of treating it as zero", () => {
    const decision = evaluateRebuy({
      config: config(),
      features: recoveredFeatures({
        oiContractsChangeFromBaselinePct: unknown("baseline not recorded", NOW),
      }),
      mode: "REPLAY",
      now: NOW,
      quotes: [quoteInput("BUY_VIRTUAL")],
      sellFact,
    });

    expect(decision.stage).toBe("REBUY_ARMED");
    expect(
      decision.conditions.find(({ conditionId }) => conditionId === "B2-OI-FLUSH")?.state,
    ).toBe("UNKNOWN");
    expect(decision.chainExecutability[0]?.actionState).toBe("SIGNAL_NOT_READY");
  });
});
