import {
  calculateMarketShockBreadth,
  calculateMaxDrawdown,
  calculateOiChange,
  calculateOrderFlow60s,
  calculateReturn,
  computeFeatureSnapshot,
  ConsecutiveConditionTracker,
  freezeOiBaseline,
  orderFlowZScore,
  requiredDrawdown,
  robustMadScale,
  RunningLowTracker,
  secondsAfter,
  unknownFeatureInputs,
} from "@virtual/features";
import {
  decimal,
  known,
  timestamp,
  unknown,
  type Asset,
  type DerivativeObservation,
  type MarketObservation,
  type Timestamp,
} from "@virtual/domain";
import { describe, expect, it } from "vitest";

const AS_OF = timestamp("2026-08-22T05:01:00.000Z");

function marketObservation(input: {
  id: string;
  asset: Asset;
  eventTime: Timestamp;
  receivedAt?: Timestamp;
  price: string;
  quantity?: string | "UNKNOWN";
  side?: MarketObservation["takerSide"];
  role?: MarketObservation["marketRole"];
}): MarketObservation {
  const receivedAt = input.receivedAt ?? input.eventTime;
  return {
    observationId: input.id,
    sourceId: "fixture-market",
    instrumentId: `${input.asset}USDT`,
    asset: input.asset,
    quoteAsset: "USDT",
    venueType: input.role === "ORDER_FLOW_REFERENCE" ? "FUTURES" : "SPOT",
    marketRole: input.role ?? "PRICE_REFERENCE",
    observationKind: input.role === "ORDER_FLOW_REFERENCE" ? "AGGREGATE_TRADE" : "KLINE_CLOSE",
    eventTime: input.eventTime,
    receivedAt,
    price: decimal(input.price),
    quantity:
      input.quantity === "UNKNOWN"
        ? unknown("quantity missing", receivedAt)
        : known(decimal(input.quantity ?? "1"), receivedAt, [input.id]),
    takerSide: input.side ?? "BUY",
    sequence: known(input.id, receivedAt, [input.id]),
    schemaVersion: "1.0.0",
    evidenceIds: [`evidence-${input.id}`],
  };
}

function derivativeObservation(input: {
  id: string;
  observedAt: Timestamp;
  receivedAt?: Timestamp;
  contracts: string;
}): DerivativeObservation {
  const receivedAt = input.receivedAt ?? input.observedAt;
  return {
    observationId: input.id,
    sourceId: "fixture-derivatives",
    instrumentId: "VIRTUALUSDT-PERP",
    observedAt: input.observedAt,
    receivedAt,
    openInterestContracts: known(decimal(input.contracts), input.observedAt, [input.id]),
    openInterestUsd: unknown("not required", receivedAt),
    takerBuySellRatio: unknown("not required", receivedAt),
    liquidationUsd: unknown("not required", receivedAt),
    fundingRate: unknown("not required", receivedAt),
    schemaVersion: "1.0.0",
    evidenceIds: [`evidence-${input.id}`],
  };
}

function twoPointMarket(futureReceivedAt?: Timestamp): MarketObservation[] {
  const starts: Record<Asset, string> = {
    BTC: "100",
    ETH: "100",
    SOL: "100",
    VIRTUAL: "1",
  };
  const ends: Record<Asset, string> = {
    BTC: "99.8",
    ETH: "99.7",
    SOL: "99",
    VIRTUAL: "0.99",
  };
  const result = (["BTC", "ETH", "SOL", "VIRTUAL"] as const).flatMap((asset) => [
    marketObservation({
      id: `${asset}-start`,
      asset,
      eventTime: timestamp("2026-08-22T05:00:00.000Z"),
      price: starts[asset],
      side: "SELL",
    }),
    marketObservation({
      id: `${asset}-end`,
      asset,
      eventTime: AS_OF,
      receivedAt: futureReceivedAt ?? AS_OF,
      price: ends[asset],
      side: asset === "VIRTUAL" ? "SELL" : "BUY",
    }),
  ]);
  result.push(
    marketObservation({
      id: "VIRTUAL-buy",
      asset: "VIRTUAL",
      eventTime: timestamp("2026-08-22T05:00:30.000Z"),
      price: "0.995",
      quantity: "2",
      side: "BUY",
      role: "ORDER_FLOW_REFERENCE",
    }),
  );
  return result;
}

describe("feature math", () => {
  it("calculates the 60-second return from data visible by receive time", () => {
    const observations = twoPointMarket();
    observations.push(
      marketObservation({
        id: "future-arrival",
        asset: "BTC",
        eventTime: timestamp("2026-08-22T05:00:59.000Z"),
        receivedAt: timestamp("2026-08-22T05:01:01.000Z"),
        price: "50",
      }),
    );

    expect(calculateReturn(observations, "BTC", AS_OF, 60)).toMatchObject({
      state: "KNOWN",
      value: "-0.002",
    });
  });

  it("calculates maximum drawdown using only the rolling path", () => {
    const observations = [
      marketObservation({
        id: "path-1",
        asset: "VIRTUAL",
        eventTime: timestamp("2026-08-22T05:00:00.000Z"),
        price: "10",
      }),
      marketObservation({
        id: "path-2",
        asset: "VIRTUAL",
        eventTime: timestamp("2026-08-22T05:00:20.000Z"),
        price: "12",
      }),
      marketObservation({
        id: "path-3",
        asset: "VIRTUAL",
        eventTime: timestamp("2026-08-22T05:00:40.000Z"),
        price: "9",
      }),
    ];

    expect(calculateMaxDrawdown(observations, "VIRTUAL", AS_OF, 60)).toMatchObject({
      state: "KNOWN",
      value: "-0.25",
    });
  });

  it("uses MAD warm-up and the stricter fixed/dynamic drawdown", () => {
    const warmup = robustMadScale([decimal("0"), decimal("0.01")], AS_OF, []);
    const scale = robustMadScale(
      [decimal("-0.01"), decimal("-0.005"), decimal("0"), decimal("0.005"), decimal("0.01")],
      AS_OF,
      ["history"],
    );

    expect(warmup.state).toBe("UNKNOWN");
    expect(scale).toMatchObject({ state: "KNOWN", value: "0.007413" });
    expect(requiredDrawdown(decimal("-0.01"), scale, decimal("2"), AS_OF)).toMatchObject({
      state: "KNOWN",
      value: "-0.014826",
    });
  });

  it("computes notional order flow and its coverage without confusing UNKNOWN with zero", () => {
    const observations = [
      marketObservation({
        id: "boundary-buy",
        asset: "VIRTUAL",
        eventTime: timestamp("2026-08-22T05:00:00.000Z"),
        price: "2",
        quantity: "3",
        side: "BUY",
        role: "ORDER_FLOW_REFERENCE",
      }),
      marketObservation({
        id: "sell",
        asset: "VIRTUAL",
        eventTime: timestamp("2026-08-22T05:00:30.000Z"),
        price: "2",
        quantity: "2",
        side: "SELL",
        role: "ORDER_FLOW_REFERENCE",
      }),
      marketObservation({
        id: "missing",
        asset: "VIRTUAL",
        eventTime: AS_OF,
        price: "2",
        quantity: "UNKNOWN",
        side: "SELL",
        role: "ORDER_FLOW_REFERENCE",
      }),
      marketObservation({
        id: "outside",
        asset: "VIRTUAL",
        eventTime: timestamp("2026-08-22T04:59:59.999Z"),
        price: "100",
        quantity: "100",
        side: "SELL",
        role: "ORDER_FLOW_REFERENCE",
      }),
    ];
    const flow = calculateOrderFlow60s(observations, AS_OF);

    expect(flow.buyNotional).toMatchObject({ state: "KNOWN", value: "6" });
    expect(flow.sellNotional).toMatchObject({ state: "KNOWN", value: "4" });
    expect(flow.buySellRatio).toMatchObject({ state: "KNOWN", value: "1.5" });
    expect(flow.netTakerFlow).toMatchObject({ state: "KNOWN", value: "2" });
    expect(flow.coverage).toMatchObject({
      state: "KNOWN",
      value: "0.66666666666666666667",
    });
  });

  it("returns UNKNOWN when both known-side notionals are zero", () => {
    const flow = calculateOrderFlow60s(
      [
        marketObservation({
          id: "zero",
          asset: "VIRTUAL",
          eventTime: AS_OF,
          price: "1",
          quantity: "0",
          side: "BUY",
          role: "ORDER_FLOW_REFERENCE",
        }),
      ],
      AS_OF,
    );
    expect(flow.buySellRatio.state).toBe("UNKNOWN");
    expect(flow.netTakerFlow).toMatchObject({ state: "KNOWN", value: "0" });
  });

  it("keeps VIRTUAL out of market-arm breadth", () => {
    const breadth = calculateMarketShockBreadth(
      {
        BTC: known(decimal("0"), AS_OF, ["btc"]),
        ETH: known(decimal("0"), AS_OF, ["eth"]),
        SOL: known(decimal("0"), AS_OF, ["sol"]),
        VIRTUAL: known(decimal("-0.5"), AS_OF, ["virtual"]),
      },
      { BTC: decimal("-0.01"), ETH: decimal("-0.01"), SOL: decimal("-0.01") },
      AS_OF,
    );
    expect(breadth).toMatchObject({ state: "KNOWN", value: 0 });
  });

  it("keeps undersampled and zero-deviation order-flow baselines UNKNOWN", () => {
    const current = known(decimal("10"), AS_OF, ["current"]);
    expect(orderFlowZScore(current, [decimal("1")], AS_OF).state).toBe("UNKNOWN");
    expect(
      orderFlowZScore(
        current,
        Array.from({ length: 20 }, () => decimal("1")),
        AS_OF,
      ).state,
    ).toBe("UNKNOWN");
  });

  it("computes OI contract change and rejects non-positive baselines", () => {
    expect(
      calculateOiChange(
        known(decimal("100"), AS_OF, ["baseline"]),
        known(decimal("94"), AS_OF, ["current"]),
        AS_OF,
      ),
    ).toMatchObject({ state: "KNOWN", value: "-0.06" });
    expect(
      calculateOiChange(
        known(decimal("0"), AS_OF, ["baseline"]),
        known(decimal("94"), AS_OF, ["current"]),
        AS_OF,
      ).state,
    ).toBe("UNKNOWN");
  });
});

describe("online state without future information", () => {
  it("resets consecutive duration on false, stale, error or unknown", () => {
    const tracker = new ConsecutiveConditionTracker();
    const start = timestamp("2026-08-22T05:00:00.000Z");
    tracker.observe({ state: true, observedAt: start, evidenceIds: ["a"] });
    tracker.observe({ state: true, observedAt: secondsAfter(start, 3), evidenceIds: ["b"] });
    expect(tracker.durationAt(secondsAfter(start, 3))).toMatchObject({ state: "KNOWN", value: 3 });
    tracker.observe({ state: "STALE", observedAt: secondsAfter(start, 4), evidenceIds: [] });
    expect(tracker.durationAt(secondsAfter(start, 4)).state).toBe("UNKNOWN");
    tracker.observe({ state: true, observedAt: secondsAfter(start, 5), evidenceIds: ["c"] });
    expect(tracker.durationAt(secondsAfter(start, 6))).toMatchObject({ state: "KNOWN", value: 1 });
  });

  it("resets no-new-low duration at each new running low", () => {
    const start = timestamp("2026-08-22T05:00:00.000Z");
    const tracker = new RunningLowTracker(start);
    tracker.observe({ price: decimal("1"), receivedAt: start, evidenceIds: ["p1"] });
    tracker.observe({
      price: decimal("1.1"),
      receivedAt: secondsAfter(start, 10),
      evidenceIds: ["p2"],
    });
    expect(tracker.snapshot(secondsAfter(start, 20)).secondsSinceLastLow).toMatchObject({
      state: "KNOWN",
      value: 20,
    });
    tracker.observe({
      price: decimal("0.9"),
      receivedAt: secondsAfter(start, 21),
      evidenceIds: ["p3"],
    });
    expect(tracker.snapshot(secondsAfter(start, 21))).toMatchObject({
      low: { state: "KNOWN", value: "0.9" },
      secondsSinceLastLow: { state: "KNOWN", value: 0 },
    });
  });

  it("freezes only the latest fresh OI received before risk arm", () => {
    const armedAt = timestamp("2026-08-22T05:00:00.000Z");
    const frozen = freezeOiBaseline({
      riskEventId: "risk-1",
      riskRevision: 1,
      riskArmedAt: armedAt,
      freshnessSeconds: 360,
      observations: [
        derivativeObservation({
          id: "old",
          observedAt: timestamp("2026-08-22T04:50:00.000Z"),
          contracts: "120",
        }),
        derivativeObservation({
          id: "eligible",
          observedAt: timestamp("2026-08-22T04:59:00.000Z"),
          contracts: "100",
        }),
        derivativeObservation({
          id: "future-observed",
          observedAt: timestamp("2026-08-22T05:00:01.000Z"),
          contracts: "200",
        }),
        derivativeObservation({
          id: "late-received",
          observedAt: timestamp("2026-08-22T04:59:30.000Z"),
          receivedAt: timestamp("2026-08-22T05:00:02.000Z"),
          contracts: "300",
        }),
      ],
    });

    expect(frozen.baseline).toMatchObject({ state: "KNOWN", value: "100" });
    expect(frozen.riskRevision).toBe(1);
  });

  it("fails loudly when a tracker is fed backwards", () => {
    const start = timestamp("2026-08-22T05:00:00.000Z");
    const tracker = new ConsecutiveConditionTracker();
    tracker.observe({ state: true, observedAt: secondsAfter(start, 2), evidenceIds: [] });
    expect(() =>
      tracker.observe({ state: true, observedAt: secondsAfter(start, 1), evidenceIds: [] }),
    ).toThrow("backwards");
  });
});

describe("feature snapshot", () => {
  function input(observations = twoPointMarket()) {
    const unknownInputs = unknownFeatureInputs(AS_OF);
    return {
      asOf: AS_OF,
      modelVersion: "0.1.0",
      formulaVersion: "feature-formulas-v1",
      parameterVersion: "candidate-2026-08-22-v1",
      observations,
      returnHistory60s: {
        BTC: ["-0.001", "0", "0.001", "-0.002", "0.002"].map(decimal),
        ETH: ["-0.001", "0", "0.001", "-0.002", "0.002"].map(decimal),
        SOL: ["-0.002", "0", "0.002", "-0.004", "0.004"].map(decimal),
        VIRTUAL: ["-0.003", "0", "0.003", "-0.006", "0.006"].map(decimal),
      },
      historicalVirtualNetFlows60s: Array.from({ length: 20 }, (_, index) => decimal(index - 10)),
      strictMarketArmThresholds: {
        BTC: decimal("-0.001"),
        ETH: decimal("-0.0015"),
        SOL: decimal("-0.005"),
      },
      broadVolumeBaseline60s: known(decimal("100"), AS_OF, ["volume-baseline"]),
      ...unknownInputs,
      riskArmedAt: known(timestamp("2026-08-22T05:00:00.000Z"), AS_OF, ["risk-arm"]),
      oiBaselineContracts: known(decimal("100"), AS_OF, ["oi-baseline"]),
      oiCurrentContracts: known(decimal("94"), AS_OF, ["oi-current"]),
      eventRunningLow: known(decimal("0.99"), AS_OF, ["low"]),
      secondsSinceLastEventLow: known(300, AS_OF, ["low"]),
      virtualSellPressureSeconds: known(3, AS_OF, ["sell-pressure"]),
      virtualOrderFlowRecoverySeconds: known(0, AS_OF, ["recovery"]),
      broadMarketStabilitySeconds: known(0, AS_OF, ["stability"]),
      newsRiskContext: "NO_NEWS" as const,
      permanentDamage: "PASS" as const,
      gapSources: [],
      clockDriftMs: known(decimal("0"), AS_OF, ["clock"]),
      maximumClockDriftMs: 1000,
      evidenceIds: ["fixture-run"],
    };
  }

  it("is deterministic and records formula, parameter, coverage and freshness metadata", () => {
    const first = computeFeatureSnapshot(input());
    const second = computeFeatureSnapshot(input());

    expect(first).toEqual(second);
    expect(first.snapshotId).toMatch(/^feature-[0-9a-f]{24}$/);
    expect(first.return60s.BTC).toMatchObject({ state: "KNOWN", value: "-0.002" });
    expect(first.marketShockBreadth).toMatchObject({ state: "KNOWN", value: 3 });
    expect(first.oiContractsChangeFromBaselinePct).toMatchObject({
      state: "KNOWN",
      value: "-0.06",
    });
    expect(first.formulaVersion).toBe("feature-formulas-v1");
    expect(first.sourceCoverage["virtualOrderFlow60s"]?.state).toBe("KNOWN");
    expect(first.freshnessByFeature["market.VIRTUAL"]).toBe("FRESH");
    expect(first.dataHealth.state).toBe("PASS");
  });

  it("detects future-received observations and blocks the health gate without consuming them", () => {
    const observations = twoPointMarket();
    observations.push(
      marketObservation({
        id: "future-input",
        asset: "VIRTUAL",
        eventTime: timestamp("2026-08-22T05:00:59.000Z"),
        receivedAt: secondsAfter(AS_OF, 1),
        price: "0.1",
      }),
    );
    const snapshot = computeFeatureSnapshot(input(observations));

    expect(snapshot.dataHealth.futureDataDetected).toBe(true);
    expect(snapshot.dataHealth.state).toBe("BLOCKED");
    expect(snapshot.return60s.VIRTUAL).toMatchObject({ state: "KNOWN", value: "-0.01" });
  });

  it("marks only missing components stale or unknown while preserving values", () => {
    const observations = twoPointMarket().filter(({ asset }) => asset !== "ETH");
    const snapshot = computeFeatureSnapshot(input(observations));

    expect(snapshot.freshnessByFeature["market.ETH"]).toBe("UNKNOWN");
    expect(snapshot.return60s.ETH.state).toBe("UNKNOWN");
    expect(snapshot.dataHealth.state).toBe("DEGRADED");
    expect(snapshot.return60s.BTC.state).toBe("KNOWN");
  });
});
