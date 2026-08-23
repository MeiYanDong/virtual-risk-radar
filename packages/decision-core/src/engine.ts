import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import {
  absolute,
  decimal,
  known,
  subtract,
  timestamp,
  unknown,
  type Asset,
  type ChainExecutability,
  type DecisionMode,
  type DecisionSnapshot,
  type DecimalString,
  type FeatureSnapshot,
  type Knowledge,
  type RebuyStage,
  type SellStage,
  type Timestamp,
} from "@virtual/domain";
import type { SystemConfig } from "@virtual/config";
import { evaluateChainExecutability, type ChainQuoteInput } from "./chain-executability";
import { booleanCondition, compositeCondition, directionalCondition } from "./conditions";

type CommonInput = {
  config: SystemConfig;
  features: FeatureSnapshot;
  mode: DecisionMode;
  now: Timestamp;
  quotes: ChainQuoteInput[];
  previousStageEnteredAt?: Timestamp;
};

export type SellDecisionInput = CommonInput & {
  previousStage?: SellStage;
};

export type SellFact =
  | { state: "NONE" }
  | {
      state: "SHADOW_QUOTED" | "MANUAL_RECORDED";
      chainProfileId: string;
      amountSold: DecimalString;
      settlementProceeds: DecimalString;
      evidenceIds: string[];
      observedAt: Timestamp;
    };

export type RebuyDecisionInput = CommonInput & {
  previousStage?: RebuyStage;
  sellFact: SellFact;
  firstTrancheCompletedAt?: Timestamp;
};

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

function decisionId(input: {
  model: "SELL" | "REBUY";
  snapshotId: string;
  modelVersion: string;
  mode: DecisionMode;
  now: Timestamp;
}): string {
  return `${input.model.toLowerCase()}-${stableHash(input).slice(0, 24)}`;
}

function knowledgeNumberAsDecimal(value: Knowledge<number>): Knowledge<DecimalString> {
  if (value.state !== "KNOWN") return value;
  return known(decimal(value.value), value.observedAt, value.evidenceIds, value.expiresAt);
}

function requiredThreshold(asset: Asset, input: SellDecisionInput): Knowledge<DecimalString> {
  const sigma = input.features.robustSigma60s[asset];
  if (sigma.state !== "KNOWN") return sigma;
  const fixed = absolute(input.config.market.sell.fixedReturn60s[asset]);
  const volatility = decimal(
    new Decimal(sigma.value).times(input.config.market.sell.volatilityMultiplier[asset]),
  );
  const required = new Decimal(fixed).gte(volatility) ? fixed : volatility;
  return known(
    subtract(decimal("0"), required),
    sigma.observedAt,
    sigma.evidenceIds,
    sigma.expiresAt,
  );
}

function dataHealthGate(features: FeatureSnapshot, model: "SELL" | "REBUY", now: Timestamp) {
  const healthy = features.dataHealth.state === "PASS" && !features.dataHealth.futureDataDetected;
  return booleanCondition({
    conditionId: "G-DATA",
    modelId: model,
    modelVersion: features.modelVersion,
    value: features.dataHealth.state === "UNKNOWN" ? "UNKNOWN" : healthy,
    now,
    passReason: "Required data is fresh, gap-free, identity-consistent, and future-safe",
    failReason: "Data health blocks the decision",
    evidenceIds: features.evidenceIds,
    veto: true,
  });
}

function anyExecutable(chains: ChainExecutability[]): boolean {
  return chains.some((chain) =>
    ["SHADOW_CANDIDATE", "ACTIONABLE_WITH_EVIDENCE"].includes(chain.actionState),
  );
}

function stageEnteredAt(
  previous: string | undefined,
  next: string,
  previousEnteredAt: Timestamp | undefined,
  now: Timestamp,
): Timestamp {
  return previous === next && previousEnteredAt !== undefined ? previousEnteredAt : now;
}

export function evaluateSell(input: SellDecisionInput): DecisionSnapshot {
  const { config, features, now } = input;
  const modelVersion = features.modelVersion;
  const dataGate = dataHealthGate(features, "SELL", now);

  const breadth = features.marketShockBreadth;
  const volume = features.broadMarketVolumeAnomaly;
  const marketArmKnown = breadth.state === "KNOWN" && volume.state === "KNOWN";
  const marketArmed =
    marketArmKnown &&
    breadth.value >= config.market.sell.marketArmBreadth &&
    new Decimal(volume.value).gte(config.market.sell.broadMarketVolumeAnomalyMinimum);
  const newsArmed = features.newsRiskContext === "NEWS_ARMED";
  const riskUnknown = features.newsRiskContext === "UNKNOWN" && !marketArmKnown;
  const riskContext = booleanCondition({
    conditionId: "S0-RISK-CONTEXT",
    modelId: "SELL",
    modelVersion,
    value: riskUnknown ? "UNKNOWN" : newsArmed || marketArmed,
    now,
    passReason: newsArmed
      ? "News context arms the model"
      : "Strict market-only context arms the model",
    failReason: "Neither news-assisted nor strict market-only context is armed",
    evidenceIds: features.evidenceIds,
  });

  const drawdownChildren = (["BTC", "SOL", "VIRTUAL"] as const).map((asset) => {
    const threshold = requiredThreshold(asset, input);
    if (threshold.state !== "KNOWN") {
      return directionalCondition({
        conditionId: `S1-${asset}`,
        modelId: "SELL",
        modelVersion,
        current: unknown("Robust volatility threshold is unknown", now),
        operator: "LTE",
        target: config.market.sell.fixedReturn60s[asset],
        now,
        reason: `${asset} drawdown threshold`,
      });
    }
    return directionalCondition({
      conditionId: `S1-${asset}`,
      modelId: "SELL",
      modelVersion,
      current: features.return60s[asset],
      operator: "LTE",
      target: threshold.value,
      now,
      reason: `${asset} return reaches the hybrid drawdown threshold`,
    });
  });
  const marketShock = compositeCondition({
    conditionId: "S1-MARKET-SHOCK",
    modelId: "SELL",
    modelVersion,
    children: drawdownChildren,
    now,
    passReason: "BTC, SOL, and VIRTUAL all pass their hybrid drawdown thresholds",
    failReason: "At least one required asset has not confirmed the shock",
  });

  const sellRatio = directionalCondition({
    conditionId: "S2-RATIO",
    modelId: "SELL",
    modelVersion,
    current: features.virtualTakerBuySellRatio60s,
    operator: "LTE",
    target: config.market.sell.virtualSellRatioMaximum,
    now,
    reason: "VIRTUAL taker buy/sell ratio confirms active selling",
  });
  const sellPersistence = directionalCondition({
    conditionId: "S2-PERSISTENCE",
    modelId: "SELL",
    modelVersion,
    current: knowledgeNumberAsDecimal(features.virtualSellPressureSeconds),
    operator: "GTE",
    target: decimal(config.market.sell.virtualSellPersistenceSeconds),
    now,
    reason: "Active selling persists long enough to reject one-tick noise",
  });
  const sellFlow = compositeCondition({
    conditionId: "S2-SELL-FLOW",
    modelId: "SELL",
    modelVersion,
    children: [sellRatio, sellPersistence],
    now,
    passReason: "VIRTUAL active sell flow and persistence both pass",
    failReason: "VIRTUAL active sell flow is not fully confirmed",
  });

  let stage: SellStage;
  if (dataGate.state !== "PASS") stage = "DATA_BLOCKED";
  else if (riskContext.state !== "PASS") stage = "SELL_IDLE";
  else if (marketShock.state !== "PASS") stage = newsArmed ? "NEWS_ARMED" : "MARKET_ARMED";
  else if (sellFlow.state !== "PASS") stage = "SELL_PRETRIGGER";
  else stage = "SELL_CONFIRMED";

  const signalReady = stage === "SELL_PRETRIGGER" || stage === "SELL_CONFIRMED";
  const chains = input.quotes.map((quoteInput) =>
    evaluateChainExecutability({
      quoteInput,
      expectedSide: "SELL_VIRTUAL",
      signalReady,
      mode: input.mode,
      economicEvidence: config.economicEvidence,
      quoteLimits: config.quoteLimits,
      now,
    }),
  );
  const executable = anyExecutable(chains);
  const chainCondition = booleanCondition({
    conditionId: "S5-CHAIN-EXECUTABILITY",
    modelId: "SELL",
    modelVersion,
    value: executable,
    now,
    passReason: "At least one isolated chain has a fresh executable quote",
    failReason: "No chain has complete identity, wallet, quote, and cost evidence",
    evidenceIds: chains.flatMap((chain) => chain.evidenceIds),
  });
  const conditions = [riskContext, marketShock, sellFlow, chainCondition];
  const passedRequiredCount = conditions.filter((condition) => condition.state === "PASS").length;

  let recommendedAction: DecisionSnapshot["recommendedAction"] = "NO_ACTION";
  let fraction = decimal("0");
  if (stage === "DATA_BLOCKED") recommendedAction = "BLOCKED";
  else if (signalReady && !executable) recommendedAction = "BLOCKED";
  else if (stage === "SELL_PRETRIGGER" && executable) {
    recommendedAction =
      input.mode === "LIVE_READ_ONLY" && config.economicEvidence === "PASS"
        ? "SELL_TRANCHE_1"
        : "SHADOW_SELL_TRANCHE_1";
    fraction = decimal("0.25");
  } else if (stage === "SELL_CONFIRMED" && executable) {
    recommendedAction =
      input.mode === "LIVE_READ_ONLY" && config.economicEvidence === "PASS"
        ? "SELL_TRANCHE_2"
        : "SHADOW_SELL_TRANCHE_2";
    fraction = decimal("0.75");
  } else if (stage !== "SELL_IDLE") recommendedAction = "WATCH";

  const enteredAt = stageEnteredAt(input.previousStage, stage, input.previousStageEnteredAt, now);
  return {
    decisionId: decisionId({
      model: "SELL",
      snapshotId: features.snapshotId,
      modelVersion,
      mode: input.mode,
      now,
    }),
    mode: input.mode,
    model: "SELL",
    stage,
    stageEnteredAt: enteredAt,
    conditions,
    passedRequiredCount,
    requiredCount: 4,
    hardGates: [dataGate],
    chainExecutability: chains,
    recommendedAction,
    recommendedFractionOfTacticalSleeve: fraction,
    absoluteAmount: unknown("Tactical sleeve percentage and wallet balance are unset", now),
    dataHealth: features.dataHealth,
    economicEvidence: config.economicEvidence,
    modelVersion,
    evidenceIds: [
      ...new Set([...features.evidenceIds, ...chains.flatMap((chain) => chain.evidenceIds)]),
    ],
    createdAt: now,
  };
}

export function evaluateRebuy(input: RebuyDecisionInput): DecisionSnapshot {
  const { config, features, now } = input;
  const modelVersion = features.modelVersion;
  const dataGate = dataHealthGate(features, "REBUY", now);

  const noNewLow = directionalCondition({
    conditionId: "B1-NO-NEW-LOW",
    modelId: "REBUY",
    modelVersion,
    current: knowledgeNumberAsDecimal(features.secondsSinceLastEventLow),
    operator: "GTE",
    target: decimal(config.market.rebuy.noNewLowSeconds),
    now,
    reason: "The running event low has held for the required time",
  });
  const oiFlush = directionalCondition({
    conditionId: "B2-OI-FLUSH",
    modelId: "REBUY",
    modelVersion,
    current: features.oiContractsChangeFromBaselinePct,
    operator: "LTE",
    target: config.market.rebuy.oiContractsDeclineMinimumPct,
    now,
    reason: "OI contracts declined from the pre-shock baseline",
  });
  const recoveryRatio = directionalCondition({
    conditionId: "B3-RATIO",
    modelId: "REBUY",
    modelVersion,
    current: features.virtualTakerBuySellRatio60s,
    operator: "GTE",
    target: config.market.rebuy.virtualBuySellRatioMinimum,
    now,
    reason: "VIRTUAL order flow has recovered",
  });
  const recoveryPersistence = directionalCondition({
    conditionId: "B3-PERSISTENCE",
    modelId: "REBUY",
    modelVersion,
    current: knowledgeNumberAsDecimal(features.virtualOrderFlowRecoverySeconds),
    operator: "GTE",
    target: decimal(config.market.rebuy.orderFlowPersistenceSeconds),
    now,
    reason: "Order-flow recovery persists long enough",
  });
  const orderFlowRecovery = compositeCondition({
    conditionId: "B3-ORDER-FLOW",
    modelId: "REBUY",
    modelVersion,
    children: [recoveryRatio, recoveryPersistence],
    now,
    passReason: "VIRTUAL order flow value and persistence pass",
    failReason: "VIRTUAL order flow recovery is incomplete",
  });
  const btcStable = directionalCondition({
    conditionId: "B4-BTC",
    modelId: "REBUY",
    modelVersion,
    current: features.return60s.BTC,
    operator: "GTE",
    target: config.market.rebuy.btcReturn60sMinimum,
    now,
    reason: "BTC return is inside the stability boundary",
  });
  const solStable = directionalCondition({
    conditionId: "B4-SOL",
    modelId: "REBUY",
    modelVersion,
    current: features.return60s.SOL,
    operator: "GTE",
    target: config.market.rebuy.solReturn60sMinimum,
    now,
    reason: "SOL return is inside the stability boundary",
  });
  const stabilityPersistence = directionalCondition({
    conditionId: "B4-PERSISTENCE",
    modelId: "REBUY",
    modelVersion,
    current: knowledgeNumberAsDecimal(features.broadMarketStabilitySeconds),
    operator: "GTE",
    target: decimal(config.market.rebuy.marketStabilitySeconds),
    now,
    reason: "Broad-market stability persists long enough",
  });
  const marketStability = compositeCondition({
    conditionId: "B4-MARKET-STABILITY",
    modelId: "REBUY",
    modelVersion,
    children: [btcStable, solStable, stabilityPersistence],
    now,
    passReason: "BTC, SOL, and persistence all pass",
    failReason: "Broad-market stability is incomplete",
  });

  const permanentPass = features.permanentDamage === "PASS";
  const permanentDamage = booleanCondition({
    conditionId: "G-PERMANENT-DAMAGE",
    modelId: "REBUY",
    modelVersion,
    value: permanentPass,
    now,
    passReason: "No predefined permanent-damage condition is observed",
    failReason:
      features.permanentDamage === "FAIL"
        ? "Permanent damage is confirmed"
        : "Permanent damage evidence is unknown or requires review",
    evidenceIds: features.evidenceIds,
    veto: true,
  });
  const hasSellFact = input.sellFact.state !== "NONE";
  const baseConditions = [noNewLow, oiFlush, orderFlowRecovery, marketStability];
  const marketReady = baseConditions.every((condition) => condition.state === "PASS");

  const preliminarySignalReady =
    hasSellFact && permanentDamage.state === "PASS" && dataGate.state === "PASS" && marketReady;
  const chains = input.quotes.map((quoteInput) =>
    evaluateChainExecutability({
      quoteInput,
      expectedSide: "BUY_VIRTUAL",
      signalReady: preliminarySignalReady,
      mode: input.mode,
      economicEvidence: config.economicEvidence,
      quoteLimits: config.quoteLimits,
      now,
    }),
  );
  const executable = anyExecutable(chains);
  const chainCondition = booleanCondition({
    conditionId: "B5-CHAIN-EXECUTABILITY",
    modelId: "REBUY",
    modelVersion,
    value: executable,
    now,
    passReason: "At least one chain can buy VIRTUAL with this cycle's settlement proceeds",
    failReason: "No chain has a fresh buy quote and complete identity, wallet, and cost evidence",
    evidenceIds: chains.flatMap((chain) => chain.evidenceIds),
  });
  const conditions = [...baseConditions, chainCondition];
  const passedRequiredCount = conditions.filter((condition) => condition.state === "PASS").length;

  let stage: RebuyStage;
  if (!hasSellFact) stage = "REBUY_INACTIVE";
  else if (permanentDamage.state !== "PASS") stage = "REBUY_VETOED";
  else if (dataGate.state !== "PASS") stage = "REBUY_WAIT";
  else if (!marketReady) {
    const passedMarket = baseConditions.filter((condition) => condition.state === "PASS").length;
    stage =
      input.firstTrancheCompletedAt === undefined && passedMarket >= 3
        ? "REBUY_ARMED"
        : "REBUY_WAIT";
  } else if (!executable) stage = "REBUY_ARMED";
  else if (input.firstTrancheCompletedAt === undefined) stage = "REBUY_TRANCHE_1";
  else {
    const elapsedSeconds = (Date.parse(now) - Date.parse(input.firstTrancheCompletedAt)) / 1_000;
    stage =
      elapsedSeconds >= config.market.rebuy.secondTrancheStabilitySeconds
        ? "REBUY_COMPLETE"
        : "REBUY_TRANCHE_2_WAIT";
  }

  let recommendedAction: DecisionSnapshot["recommendedAction"] = "NO_ACTION";
  let fraction = decimal("0");
  if (stage === "REBUY_VETOED") recommendedAction = "VETOED";
  else if (stage === "REBUY_ARMED") recommendedAction = "PREPARE_REBUY_QUOTE";
  else if (stage === "REBUY_TRANCHE_1") {
    recommendedAction =
      input.mode === "LIVE_READ_ONLY" && config.economicEvidence === "PASS"
        ? "REBUY_TRANCHE_1"
        : "SHADOW_REBUY_TRANCHE_1";
    fraction = decimal("0.5");
  } else if (stage === "REBUY_COMPLETE") {
    recommendedAction =
      input.mode === "LIVE_READ_ONLY" && config.economicEvidence === "PASS"
        ? "REBUY_TRANCHE_2"
        : "SHADOW_REBUY_TRANCHE_2";
    fraction = decimal("0.5");
  } else if (stage !== "REBUY_INACTIVE") recommendedAction = "WATCH";

  return {
    decisionId: decisionId({
      model: "REBUY",
      snapshotId: features.snapshotId,
      modelVersion,
      mode: input.mode,
      now,
    }),
    mode: input.mode,
    model: "REBUY",
    stage,
    stageEnteredAt: stageEnteredAt(input.previousStage, stage, input.previousStageEnteredAt, now),
    conditions,
    passedRequiredCount,
    requiredCount: 5,
    hardGates: [dataGate, permanentDamage],
    chainExecutability: chains,
    recommendedAction,
    recommendedFractionOfTacticalSleeve: fraction,
    absoluteAmount: unknown(
      "Rebuy quantity requires a sell fact, tactical sleeve, and wallet readback",
      now,
    ),
    dataHealth: features.dataHealth,
    economicEvidence: config.economicEvidence,
    modelVersion,
    evidenceIds: [
      ...new Set([
        ...features.evidenceIds,
        ...(input.sellFact.state === "NONE" ? [] : input.sellFact.evidenceIds),
        ...chains.flatMap((chain) => chain.evidenceIds),
      ]),
    ],
    createdAt: now,
  };
}

export function nextSecond(now: Timestamp): Timestamp {
  return timestamp(new Date(Date.parse(now) + 1_000));
}
