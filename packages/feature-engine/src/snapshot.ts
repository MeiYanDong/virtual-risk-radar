import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import {
  decimal,
  known,
  unknown,
  type Asset,
  type DataHealth,
  type DecimalString,
  type FeatureSnapshot,
  type Knowledge,
  type MarketObservation,
  type Timestamp,
} from "@virtual/domain";
import {
  calculateBroadMarketVolumeAnomaly,
  calculateMarketShockBreadth,
  calculateMaxDrawdown,
  calculateOiChange,
  calculateOrderFlow60s,
  calculateReturn,
  calculateVirtualExcessReturn,
  orderFlowZScore,
  robustMadScale,
} from "./math";

const ASSETS = ["BTC", "ETH", "SOL", "VIRTUAL"] as const satisfies readonly Asset[];

function stableHash(value: unknown): string {
  function canonicalize(current: unknown): unknown {
    if (Array.isArray(current)) return current.map(canonicalize);
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return current;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function assetMap<T>(factory: (asset: Asset) => T): Record<Asset, T> {
  return Object.fromEntries(ASSETS.map((asset) => [asset, factory(asset)])) as Record<Asset, T>;
}

function latestAgeSeconds(
  observations: MarketObservation[],
  asset: Asset,
  asOf: Timestamp,
): number | undefined {
  const latest = observations
    .filter(
      (observation) =>
        observation.asset === asset && Date.parse(observation.receivedAt) <= Date.parse(asOf),
    )
    .filter((observation) => observation.marketRole === "PRICE_REFERENCE")
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))[0];
  return latest === undefined
    ? undefined
    : (Date.parse(asOf) - Date.parse(latest.receivedAt)) / 1_000;
}

function evaluateDataHealth(input: {
  observations: MarketObservation[];
  asOf: Timestamp;
  gapSources: string[];
  futureDataDetected: boolean;
  clockDriftMs: Knowledge<DecimalString>;
  maximumClockDriftMs: number;
  oiCurrentContracts: Knowledge<DecimalString>;
}): {
  health: DataHealth;
  freshness: Record<string, FeatureSnapshot["freshnessByFeature"][string]>;
} {
  const freshness: Record<string, FeatureSnapshot["freshnessByFeature"][string]> = {};
  const staleSources: string[] = [];
  for (const asset of ASSETS) {
    const age = latestAgeSeconds(input.observations, asset, input.asOf);
    const state = age === undefined ? "UNKNOWN" : age <= 3 ? "FRESH" : "STALE";
    freshness[`market.${asset}`] = state;
    if (state !== "FRESH") staleSources.push(`market.${asset}`);
  }
  const oiAge =
    input.oiCurrentContracts.state === "KNOWN"
      ? (Date.parse(input.asOf) - Date.parse(input.oiCurrentContracts.observedAt)) / 1_000
      : undefined;
  freshness["derivatives.VIRTUAL.oiContracts"] =
    oiAge === undefined ? "UNKNOWN" : oiAge <= 360 ? "FRESH" : "STALE";

  const clockBlocked =
    input.clockDriftMs.state === "KNOWN" &&
    new Decimal(input.clockDriftMs.value).abs().gt(input.maximumClockDriftMs);
  const essentialStale = ["market.BTC", "market.SOL", "market.VIRTUAL"].some(
    (source) => freshness[source] !== "FRESH",
  );
  const state: DataHealth["state"] = input.futureDataDetected
    ? "BLOCKED"
    : input.clockDriftMs.state !== "KNOWN"
      ? "UNKNOWN"
      : clockBlocked || essentialStale || input.gapSources.length > 0
        ? "BLOCKED"
        : staleSources.length > 0
          ? "DEGRADED"
          : "PASS";
  return {
    health: {
      state,
      staleSources,
      gapSources: input.gapSources,
      clockDriftMs: input.clockDriftMs,
      futureDataDetected: input.futureDataDetected,
      observedAt: input.asOf,
    },
    freshness,
  };
}

export type FeatureComputationInput = {
  asOf: Timestamp;
  modelVersion: string;
  formulaVersion: string;
  parameterVersion: string;
  observations: MarketObservation[];
  returnHistory60s: Record<Asset, DecimalString[]>;
  historicalVirtualNetFlows60s: DecimalString[];
  strictMarketArmThresholds: Record<"BTC" | "ETH" | "SOL", DecimalString>;
  broadVolumeBaseline60s: Knowledge<DecimalString>;
  riskArmedAt: Knowledge<Timestamp>;
  oiBaselineContracts: Knowledge<DecimalString>;
  oiCurrentContracts: Knowledge<DecimalString>;
  eventRunningLow: Knowledge<DecimalString>;
  secondsSinceLastEventLow: Knowledge<number>;
  virtualSellPressureSeconds: Knowledge<number>;
  virtualOrderFlowRecoverySeconds: Knowledge<number>;
  broadMarketStabilitySeconds: Knowledge<number>;
  newsRiskContext: FeatureSnapshot["newsRiskContext"];
  permanentDamage: FeatureSnapshot["permanentDamage"];
  gapSources: string[];
  clockDriftMs: Knowledge<DecimalString>;
  maximumClockDriftMs: number;
  evidenceIds: string[];
};

export function computeFeatureSnapshot(input: FeatureComputationInput): FeatureSnapshot {
  const return60s = assetMap((asset) => calculateReturn(input.observations, asset, input.asOf, 60));
  const maxDrawdown60s = assetMap((asset) =>
    calculateMaxDrawdown(input.observations, asset, input.asOf, 60),
  );
  const robustSigma60s = assetMap((asset) =>
    robustMadScale(
      input.returnHistory60s[asset],
      input.asOf,
      input.observations
        .filter((observation) => observation.asset === asset)
        .map((observation) => observation.observationId),
    ),
  );
  const orderFlow = calculateOrderFlow60s(input.observations, input.asOf);
  const marketShockBreadth = calculateMarketShockBreadth(
    return60s,
    input.strictMarketArmThresholds,
    input.asOf,
  );
  const broadMarketVolumeAnomaly = calculateBroadMarketVolumeAnomaly(
    input.observations,
    input.asOf,
    input.broadVolumeBaseline60s,
  );
  const oiContractsChangeFromBaselinePct = calculateOiChange(
    input.oiBaselineContracts,
    input.oiCurrentContracts,
    input.asOf,
  );
  const futureDataDetected = input.observations.some(
    (observation) => Date.parse(observation.receivedAt) > Date.parse(input.asOf),
  );
  const { health, freshness } = evaluateDataHealth({
    observations: input.observations,
    asOf: input.asOf,
    gapSources: input.gapSources,
    futureDataDetected,
    clockDriftMs: input.clockDriftMs,
    maximumClockDriftMs: input.maximumClockDriftMs,
    oiCurrentContracts: input.oiCurrentContracts,
  });
  const sourceCoverage = {
    virtualOrderFlow60s: orderFlow.coverage,
    marketPrice60s: known(
      decimal(ASSETS.filter((asset) => return60s[asset].state === "KNOWN").length / ASSETS.length),
      input.asOf,
      input.evidenceIds,
    ),
  };
  const content = {
    asOf: input.asOf,
    modelVersion: input.modelVersion,
    formulaVersion: input.formulaVersion,
    parameterVersion: input.parameterVersion,
    return60s,
    maxDrawdown60s,
    robustSigma60s,
    virtualTakerBuyNotional60s: orderFlow.buyNotional,
    virtualTakerSellNotional60s: orderFlow.sellNotional,
    virtualTakerBuySellRatio60s: orderFlow.buySellRatio,
    virtualNetTakerFlow60s: orderFlow.netTakerFlow,
    virtualOrderFlowZScore60s: orderFlowZScore(
      orderFlow.netTakerFlow,
      input.historicalVirtualNetFlows60s,
      input.asOf,
    ),
    virtualExcessReturn60s: calculateVirtualExcessReturn(return60s, input.asOf),
    virtualSellPressureSeconds: input.virtualSellPressureSeconds,
    virtualOrderFlowRecoverySeconds: input.virtualOrderFlowRecoverySeconds,
    broadMarketStabilitySeconds: input.broadMarketStabilitySeconds,
    marketShockBreadth,
    broadMarketVolumeAnomaly,
    riskArmedAt: input.riskArmedAt,
    oiBaselineContracts: input.oiBaselineContracts,
    oiContractsChangeFromBaselinePct,
    eventRunningLow: input.eventRunningLow,
    secondsSinceLastEventLow: input.secondsSinceLastEventLow,
    newsRiskContext: input.newsRiskContext,
    permanentDamage: input.permanentDamage,
    sourceCoverage,
    freshnessByFeature: freshness,
    dataHealth: health,
    evidenceIds: [...new Set(input.evidenceIds)],
  } satisfies Omit<FeatureSnapshot, "snapshotId">;
  return {
    snapshotId: `feature-${stableHash(content).slice(0, 24)}`,
    ...content,
  };
}

export function unknownFeatureInputs(
  asOf: Timestamp,
): Pick<
  FeatureComputationInput,
  | "riskArmedAt"
  | "oiBaselineContracts"
  | "oiCurrentContracts"
  | "eventRunningLow"
  | "secondsSinceLastEventLow"
  | "virtualSellPressureSeconds"
  | "virtualOrderFlowRecoverySeconds"
  | "broadMarketStabilitySeconds"
> {
  return {
    riskArmedAt: unknown("Risk context is not armed", asOf),
    oiBaselineContracts: unknown("OI baseline is not frozen", asOf),
    oiCurrentContracts: unknown("Current OI is unavailable", asOf),
    eventRunningLow: unknown("No event low exists", asOf),
    secondsSinceLastEventLow: unknown("No event low exists", asOf),
    virtualSellPressureSeconds: unknown("Sell-pressure timer is inactive", asOf),
    virtualOrderFlowRecoverySeconds: unknown("Recovery timer is inactive", asOf),
    broadMarketStabilitySeconds: unknown("Stability timer is inactive", asOf),
  };
}
