import Decimal from "decimal.js";
import type { ActiveSystemConfig } from "@virtual/config";
import {
  V3DecisionPanelSchema,
  timestamp,
  type Asset,
  type Timestamp,
  type V3Condition,
  type V3DecisionPanel,
  type V3NewsItem,
  type V3SourceHealth,
} from "@virtual/domain";
import type { V3MarketFeatureSnapshot } from "@virtual/market";

type TimerName = "sellPressure" | "relativeRecovery" | "flowNormalization";

export type V3SellContext =
  | { state: "NONE" }
  | {
      state: "SHADOW_REFERENCE" | "USER_RECORDED";
      at: Timestamp;
      evidenceIds: string[];
    };

export type V3DecisionResult = {
  sell: V3DecisionPanel;
  rebuy: V3DecisionPanel;
  shadowSellCreated: V3SellContext | null;
};

export type V3DecisionInput = {
  now: Timestamp;
  newsItems: readonly V3NewsItem[];
  newsHealth: V3SourceHealth;
  marketHealth: V3SourceHealth;
  market: V3MarketFeatureSnapshot;
};

function isSourceUsable(health: V3SourceHealth): boolean {
  return health.status === "HEALTHY" || health.status === "DEGRADED";
}

function percentage(value: string | null): string {
  return value === null ? "—" : `${new Decimal(value).times(100).toFixed(3)}%`;
}

function numericProgressLte(current: string, target: string): number {
  const value = new Decimal(current);
  const boundary = new Decimal(target);
  if (value.lte(boundary)) return 1;
  if (boundary.eq(0) || value.gte(0)) return 0;
  return Decimal.min(1, value.abs().dividedBy(boundary.abs())).toNumber();
}

function numericProgressGte(current: string, target: string): number {
  const value = new Decimal(current);
  const boundary = new Decimal(target);
  if (value.gte(boundary)) return 1;
  if (boundary.eq(0) || value.lte(0)) return 0;
  return Decimal.max(0, value.dividedBy(boundary)).toNumber();
}

function gapLte(current: string, target: string): string {
  const gap = Decimal.max(0, new Decimal(current).minus(target));
  return `${gap.times(100).toFixed(3)} 个百分点`;
}

function gapGte(current: string, target: string): string {
  const gap = Decimal.max(0, new Decimal(target).minus(current));
  return `${gap.times(100).toFixed(3)} 个百分点`;
}

function nextGap(conditions: readonly V3Condition[]): string {
  const missing = conditions.find(({ state }) => state !== "PASS");
  return missing === undefined ? "四项条件均已满足" : `${missing.label}：${missing.gap}`;
}

function latestQualifyingMacro(
  items: readonly V3NewsItem[],
  now: Timestamp,
  maximumAgeSeconds: number,
): V3NewsItem | undefined {
  return [...items]
    .filter(({ receivedAt }) => Date.parse(receivedAt) <= Date.parse(now))
    .filter(
      ({ sourceOccurredAt }) =>
        sourceOccurredAt !== null &&
        Date.parse(sourceOccurredAt) <= Date.parse(now) &&
        Date.parse(now) - Date.parse(sourceOccurredAt) <= maximumAgeSeconds * 1_000,
    )
    .filter(
      ({ macroRelevant, direction, severity }) =>
        macroRelevant && direction === "RISK_OFF" && ["HIGH", "SYSTEMIC"].includes(severity),
    )
    .filter(
      ({ receivedAt }) => Date.parse(now) - Date.parse(receivedAt) <= maximumAgeSeconds * 1_000,
    )
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))[0];
}

function macroCondition(input: {
  now: Timestamp;
  event: V3NewsItem | undefined;
  health: V3SourceHealth;
  armWindowSeconds: number;
}): V3Condition {
  const usable = isSourceUsable(input.health);
  const state: V3Condition["state"] = !usable
    ? input.health.status === "STALE" || input.health.status === "ERROR"
      ? "STALE"
      : "UNKNOWN"
    : input.event === undefined
      ? "FAIL"
      : "PASS";
  const age =
    input.event === undefined ? null : Date.parse(input.now) - Date.parse(input.event.receivedAt);
  return {
    id: "S1-MACRO-SHOCK",
    label: "宏观冲击",
    state,
    current:
      input.event === undefined
        ? usable
          ? "暂无新鲜高严重度风险事件"
          : input.health.status
        : `${input.event.eventType} / ${input.event.severity}`,
    target: `TechFlow RISK_OFF + HIGH/SYSTEMIC，接收后 ≤ ${input.armWindowSeconds / 60} 分钟`,
    gap:
      state === "PASS"
        ? "0"
        : usable
          ? "等待相关、方向明确且高严重度的新事件"
          : `新闻源 ${input.health.status}，不能确认最新宏观状态`,
    progress: state === "PASS" ? 1 : state === "FAIL" ? 0 : null,
    durationSeconds: age === null ? null : Math.max(0, Math.floor(age / 1_000)),
    source: "techflow-public-newsletter",
    dataAgeMs: input.health.dataAgeMs,
    reason:
      input.event?.classificationReason ??
      "TechFlow only arms risk; this condition cannot independently produce SELL_READY",
    evidenceIds: input.event === undefined ? input.health.evidenceIds : [input.event.observationId],
  };
}

function crossAssetCondition(
  config: ActiveSystemConfig,
  market: V3MarketFeatureSnapshot,
): V3Condition {
  const assets = ["BTC", "ETH", "SOL"] as const;
  const known = assets.filter((asset) => market.assets[asset].return60s !== null);
  const passed = known.filter((asset) => {
    const value = market.assets[asset].return60s;
    return (
      value !== null && new Decimal(value).lte(config.model.sell.crossAssetReturnMaximum[asset])
    );
  });
  const state: V3Condition["state"] =
    known.length < assets.length
      ? assets.some((asset) => market.assets[asset].freshness === "STALE")
        ? "STALE"
        : "UNKNOWN"
      : passed.length >= config.model.sell.crossAssetMinimumPassing
        ? "PASS"
        : "FAIL";
  const current = assets
    .map((asset) => `${asset} ${percentage(market.assets[asset].return60s)}`)
    .join(" · ");
  return {
    id: "S2-CROSS-ASSET-DRAWDOWN",
    label: "跨资产下跌",
    state,
    current,
    target: `BTC/ETH/SOL 至少 ${config.model.sell.crossAssetMinimumPassing}/3 达到各自 60 秒阈值`,
    gap:
      state === "PASS"
        ? "0"
        : known.length < assets.length
          ? `还缺 ${assets.length - known.length} 个新鲜 60 秒窗口`
          : `还差 ${Math.max(0, config.model.sell.crossAssetMinimumPassing - passed.length)} 个资产`,
    progress:
      known.length < assets.length
        ? null
        : Math.min(1, passed.length / config.model.sell.crossAssetMinimumPassing),
    durationSeconds: null,
    source: "binance-spot-public",
    dataAgeMs: Math.max(...assets.map((asset) => market.assets[asset].dataAgeMs ?? 0)),
    reason: "Only Binance Spot bookTicker mid-prices are used",
    evidenceIds: assets
      .map((asset) => market.assets[asset].latestEvidenceId)
      .filter((value): value is string => value !== null),
  };
}

function relativeCondition(input: {
  id: string;
  label: string;
  current: string | null;
  target: string;
  operator: "LTE" | "GTE";
  market: V3MarketFeatureSnapshot;
  durationSeconds?: number | null;
  durationTargetSeconds?: number;
}): V3Condition {
  const stale = [
    input.market.assets.VIRTUAL,
    input.market.assets.BTC,
    input.market.assets.ETH,
    input.market.assets.SOL,
  ].some(({ freshness }) => freshness === "STALE");
  const numericPass =
    input.current !== null &&
    (input.operator === "LTE"
      ? new Decimal(input.current).lte(input.target)
      : new Decimal(input.current).gte(input.target));
  const durationPass =
    input.durationTargetSeconds === undefined ||
    (input.durationSeconds ?? 0) >= input.durationTargetSeconds;
  const state: V3Condition["state"] =
    input.current === null
      ? stale
        ? "STALE"
        : "UNKNOWN"
      : numericPass && durationPass
        ? "PASS"
        : "FAIL";
  const numericProgress =
    input.current === null
      ? null
      : input.operator === "LTE"
        ? numericProgressLte(input.current, input.target)
        : numericProgressGte(input.current, input.target);
  const durationProgress =
    input.durationTargetSeconds === undefined
      ? 1
      : Math.min(1, (input.durationSeconds ?? 0) / input.durationTargetSeconds);
  return {
    id: input.id,
    label: input.label,
    state,
    current: percentage(input.current),
    target: `${input.operator === "LTE" ? "≤" : "≥"} ${percentage(input.target)}${
      input.durationTargetSeconds === undefined ? "" : `，持续 ${input.durationTargetSeconds} 秒`
    }`,
    gap:
      input.current === null
        ? `等待新鲜 60 秒窗口`
        : numericPass && !durationPass
          ? `还差 ${Math.max(0, (input.durationTargetSeconds ?? 0) - (input.durationSeconds ?? 0))} 秒`
          : input.operator === "LTE"
            ? gapLte(input.current, input.target)
            : gapGte(input.current, input.target),
    progress: numericProgress === null ? null : Math.min(numericProgress, durationProgress),
    durationSeconds: input.durationSeconds ?? null,
    source: "binance-spot-public",
    dataAgeMs: input.market.assets.VIRTUAL.dataAgeMs,
    reason: "VIRTUAL return minus the equal-weight BTC/ETH/SOL return",
    evidenceIds: input.market.evidenceIds,
  };
}

function flowCondition(input: {
  id: string;
  label: string;
  market: V3MarketFeatureSnapshot;
  target: string;
  operator: "LTE" | "GTE";
  durationSeconds: number;
  durationTargetSeconds: number;
}): V3Condition {
  const buy = input.market.virtualTakerBuyNotional60s;
  const sell = input.market.virtualTakerSellNotional60s;
  const ratio = input.market.virtualTakerBuySellRatio60s;
  const noSellWithBuys =
    input.operator === "GTE" &&
    buy !== null &&
    sell !== null &&
    new Decimal(buy).gt(0) &&
    new Decimal(sell).eq(0);
  const ratioPass =
    noSellWithBuys ||
    (ratio !== null &&
      (input.operator === "LTE"
        ? new Decimal(ratio).lte(input.target)
        : new Decimal(ratio).gte(input.target)));
  const durationPass = input.durationSeconds >= input.durationTargetSeconds;
  const sourceState = input.market.virtualOrderFlowState;
  const state: V3Condition["state"] =
    sourceState === "STALE"
      ? "STALE"
      : sourceState !== "KNOWN"
        ? "UNKNOWN"
        : ratioPass && durationPass
          ? "PASS"
          : "FAIL";
  const numericProgress = noSellWithBuys
    ? 1
    : ratio === null
      ? null
      : input.operator === "LTE"
        ? numericProgressLte(ratio, input.target)
        : numericProgressGte(ratio, input.target);
  return {
    id: input.id,
    label: input.label,
    state,
    current:
      ratio === null
        ? noSellWithBuys
          ? "仅主动买入 / 无主动卖出"
          : `${sourceState}（buy ${buy ?? "—"} / sell ${sell ?? "—"} USDT）`
        : `${new Decimal(ratio).toFixed(3)}（buy/sell）`,
    target: `${input.operator === "LTE" ? "≤" : "≥"} ${input.target}，持续 ${input.durationTargetSeconds} 秒`,
    gap:
      state === "PASS"
        ? "0"
        : sourceState !== "KNOWN"
          ? `订单流 ${sourceState}，不能补 0`
          : ratioPass
            ? `还差 ${Math.max(0, input.durationTargetSeconds - input.durationSeconds)} 秒`
            : `买卖比尚未越过 ${input.target}`,
    progress:
      numericProgress === null
        ? null
        : Math.min(1, numericProgress, input.durationSeconds / input.durationTargetSeconds),
    durationSeconds: input.durationSeconds,
    source: "binance-spot-public",
    dataAgeMs: input.market.virtualOrderFlowAgeMs,
    reason: "VIRTUAL Spot aggTrade quote notional; buyer-maker maps to taker SELL",
    evidenceIds: input.market.evidenceIds,
  };
}

export class V3DecisionEngine {
  readonly #config: ActiveSystemConfig;
  readonly #timers = new Map<TimerName, Timestamp>();
  readonly #runningLow = new Map<Asset, Decimal>();
  #lastLowAt: Timestamp | null = null;
  #sellContext: V3SellContext = { state: "NONE" };

  constructor(config: ActiveSystemConfig) {
    this.#config = config;
  }

  sellContext(): V3SellContext {
    return structuredClone(this.#sellContext);
  }

  recordUserSell(at: Timestamp, evidenceIds: string[]): void {
    this.#sellContext = { state: "USER_RECORDED", at, evidenceIds: [...evidenceIds] };
  }

  evaluate(input: V3DecisionInput): V3DecisionResult {
    this.#updateRunningLow(input.market, input.now);
    const latestMacro = latestQualifyingMacro(
      input.newsItems,
      input.now,
      this.#config.newsSource.macroArmWindowSeconds,
    );
    const macro = macroCondition({
      now: input.now,
      event: latestMacro,
      health: input.newsHealth,
      armWindowSeconds: this.#config.newsSource.macroArmWindowSeconds,
    });
    const crossAsset = crossAssetCondition(this.#config, input.market);
    const weakness = relativeCondition({
      id: "S3-VIRTUAL-RELATIVE-WEAKNESS",
      label: "VIRTUAL 相对弱势",
      current: input.market.virtualExcessReturn60s,
      target: this.#config.model.sell.virtualRelativeReturnMaximum,
      operator: "LTE",
      market: input.market,
    });
    const sellRatio = input.market.virtualTakerBuySellRatio60s;
    const sellPressureNow =
      input.market.virtualOrderFlowState === "KNOWN" &&
      sellRatio !== null &&
      new Decimal(sellRatio).lte(this.#config.model.sell.virtualBuySellRatioMaximum);
    const sellPressureDuration = this.#timerDuration("sellPressure", sellPressureNow, input.now);
    const sellPressure = flowCondition({
      id: "S4-VIRTUAL-SELL-PRESSURE",
      label: "VIRTUAL 主动卖压",
      market: input.market,
      target: this.#config.model.sell.virtualBuySellRatioMaximum,
      operator: "LTE",
      durationSeconds: sellPressureDuration,
      durationTargetSeconds: this.#config.model.sell.sellPressurePersistenceSeconds,
    });
    const sellConditions = [macro, crossAsset, weakness, sellPressure] as const;
    const normalSellReady = sellConditions.every(({ state }) => state === "PASS");
    const marketStressReady = [crossAsset, weakness, sellPressure].every(
      ({ state }) => state === "PASS",
    );
    const essentialUnknown = [crossAsset, weakness, sellPressure].some(({ state }) =>
      ["UNKNOWN", "STALE"].includes(state),
    );
    const sellStage: V3DecisionPanel["stage"] = normalSellReady
      ? "SELL_READY"
      : macro.state === "PASS"
        ? "NEWS_ARMED"
        : marketStressReady
          ? "MARKET_ARMED"
          : essentialUnknown ||
              !isSourceUsable(input.marketHealth) ||
              !isSourceUsable(input.newsHealth)
            ? "DATA_UNAVAILABLE"
            : "NO_ACTION";
    const sellOutput: V3DecisionPanel["output"] = normalSellReady
      ? "SHADOW_CANDIDATE"
      : sellStage === "NEWS_ARMED" || sellStage === "MARKET_ARMED"
        ? "WATCH"
        : "NO_ACTION";

    let shadowSellCreated: V3SellContext | null = null;
    if (normalSellReady && this.#sellContext.state === "NONE") {
      this.#sellContext = {
        state: "SHADOW_REFERENCE",
        at: input.now,
        evidenceIds: sellConditions.flatMap(({ evidenceIds }) => evidenceIds),
      };
      shadowSellCreated = this.sellContext();
    }

    const noEscalation = this.#noMacroEscalationCondition(input, latestMacro);
    const noNewLow = this.#noNewLowCondition(input);
    const relativeRecoveryNow =
      input.market.virtualExcessReturn60s !== null &&
      new Decimal(input.market.virtualExcessReturn60s).gte(
        this.#config.model.rebuy.virtualRelativeReturnMinimum,
      );
    const relativeRecoveryDuration = this.#timerDuration(
      "relativeRecovery",
      relativeRecoveryNow,
      input.now,
    );
    const relativeRecovery = relativeCondition({
      id: "B3-VIRTUAL-RELATIVE-RECOVERY",
      label: "VIRTUAL 相对恢复",
      current: input.market.virtualExcessReturn60s,
      target: this.#config.model.rebuy.virtualRelativeReturnMinimum,
      operator: "GTE",
      market: input.market,
      durationSeconds: relativeRecoveryDuration,
      durationTargetSeconds: this.#config.model.rebuy.relativeRecoveryPersistenceSeconds,
    });
    const ratio = input.market.virtualTakerBuySellRatio60s;
    const noSellWithBuys =
      input.market.virtualTakerBuyNotional60s !== null &&
      input.market.virtualTakerSellNotional60s !== null &&
      new Decimal(input.market.virtualTakerBuyNotional60s).gt(0) &&
      new Decimal(input.market.virtualTakerSellNotional60s).eq(0);
    const flowNormalizedNow =
      input.market.virtualOrderFlowState === "KNOWN" &&
      (noSellWithBuys ||
        (ratio !== null &&
          new Decimal(ratio).gte(this.#config.model.rebuy.virtualBuySellRatioMinimum)));
    const flowNormalizationDuration = this.#timerDuration(
      "flowNormalization",
      flowNormalizedNow,
      input.now,
    );
    const flowNormalized = flowCondition({
      id: "B4-SELL-PRESSURE-NORMALIZED",
      label: "主动卖压归一",
      market: input.market,
      target: this.#config.model.rebuy.virtualBuySellRatioMinimum,
      operator: "GTE",
      durationSeconds: flowNormalizationDuration,
      durationTargetSeconds: this.#config.model.rebuy.flowNormalizationPersistenceSeconds,
    });
    const rebuyConditions = [noEscalation, noNewLow, relativeRecovery, flowNormalized] as const;
    const recoveryReady = rebuyConditions.every(({ state }) => state === "PASS");
    const hasSellContext = this.#sellContext.state !== "NONE";
    const rebuyStage: V3DecisionPanel["stage"] =
      recoveryReady && hasSellContext
        ? "REBUY_READY"
        : rebuyConditions.some(({ state }) => ["UNKNOWN", "STALE"].includes(state))
          ? "DATA_UNAVAILABLE"
          : hasSellContext || rebuyConditions.some(({ state }) => state === "PASS")
            ? "REBUY_WAIT"
            : "NO_ACTION";
    const rebuyOutput: V3DecisionPanel["output"] =
      recoveryReady && hasSellContext ? "SHADOW_CANDIDATE" : "NO_ACTION";
    const contextState = this.#sellContext.state;

    return {
      sell: V3DecisionPanelSchema.parse({
        model: "SELL",
        stage: sellStage,
        output: sellOutput,
        outputBasis: "CEX_REFERENCE",
        passed: sellConditions.filter(({ state }) => state === "PASS").length,
        required: 4,
        conditions: sellConditions,
        nextGap: nextGap(sellConditions),
        extremeMarketFallback: normalSellReady ? "NOT_USED" : "NOT_CALIBRATED",
        sellContext: contextState,
        reason: normalSellReady
          ? "TechFlow macro arm and all three Binance confirmations pass; Shadow only"
          : "Normal path requires all four conditions; extreme market path remains NOT_CALIBRATED",
        evidenceIds: sellConditions.flatMap(({ evidenceIds }) => evidenceIds),
      }),
      rebuy: V3DecisionPanelSchema.parse({
        model: "REBUY",
        stage: rebuyStage,
        output: rebuyOutput,
        outputBasis: "CEX_REFERENCE",
        passed: rebuyConditions.filter(({ state }) => state === "PASS").length,
        required: 4,
        conditions: rebuyConditions,
        nextGap:
          recoveryReady && !hasSellContext
            ? "恢复条件已满足，但没有用户卖出事实或明确 Shadow 参考卖出"
            : nextGap(rebuyConditions),
        extremeMarketFallback: "NOT_USED",
        sellContext: contextState,
        reason: hasSellContext
          ? "Rebuy evaluates recovery from the recorded sell context"
          : "Recovery progress is visible, but original exposure must not be increased without a sell context",
        evidenceIds: rebuyConditions.flatMap(({ evidenceIds }) => evidenceIds),
      }),
      shadowSellCreated,
    };
  }

  #timerDuration(name: TimerName, passing: boolean, now: Timestamp): number {
    if (!passing) {
      this.#timers.delete(name);
      return 0;
    }
    const startedAt = this.#timers.get(name) ?? now;
    this.#timers.set(name, startedAt);
    return Math.max(0, Math.floor((Date.parse(now) - Date.parse(startedAt)) / 1_000));
  }

  #updateRunningLow(market: V3MarketFeatureSnapshot, now: Timestamp): void {
    for (const asset of ["BTC", "ETH", "SOL", "VIRTUAL"] as const) {
      const price = market.assets[asset].price;
      if (price === null || market.assets[asset].freshness !== "FRESH") continue;
      const current = new Decimal(price);
      const previous = this.#runningLow.get(asset);
      if (previous === undefined || current.lt(previous)) {
        this.#runningLow.set(asset, current);
        this.#lastLowAt = now;
      }
    }
  }

  #noMacroEscalationCondition(
    input: V3DecisionInput,
    latestMacro: V3NewsItem | undefined,
  ): V3Condition {
    const usable = isSourceUsable(input.newsHealth);
    const ageSeconds =
      latestMacro === undefined
        ? null
        : Math.max(
            0,
            Math.floor((Date.parse(input.now) - Date.parse(latestMacro.receivedAt)) / 1_000),
          );
    const quiet =
      latestMacro === undefined || (ageSeconds ?? 0) >= this.#config.model.rebuy.macroQuietSeconds;
    const state: V3Condition["state"] = !usable
      ? input.newsHealth.status === "ERROR" || input.newsHealth.status === "STALE"
        ? "STALE"
        : "UNKNOWN"
      : quiet
        ? "PASS"
        : "FAIL";
    return {
      id: "B1-NO-NEW-MACRO-ESCALATION",
      label: "无新宏观升级",
      state,
      current:
        latestMacro === undefined
          ? "当前窗口无高严重度 RISK_OFF 事件"
          : `最近升级 ${ageSeconds ?? 0} 秒前`,
      target: `最近一次升级后安静 ≥ ${this.#config.model.rebuy.macroQuietSeconds} 秒`,
      gap:
        state === "PASS"
          ? "0"
          : usable
            ? `还差 ${Math.max(0, this.#config.model.rebuy.macroQuietSeconds - (ageSeconds ?? 0))} 秒`
            : `新闻源 ${input.newsHealth.status}，无法确认没有新升级`,
      progress: !usable
        ? null
        : latestMacro === undefined
          ? 1
          : Math.min(1, (ageSeconds ?? 0) / this.#config.model.rebuy.macroQuietSeconds),
      durationSeconds: ageSeconds,
      source: "techflow-public-newsletter",
      dataAgeMs: input.newsHealth.dataAgeMs,
      reason: "Any new qualifying macro escalation restarts the quiet window",
      evidenceIds:
        latestMacro === undefined ? input.newsHealth.evidenceIds : [latestMacro.observationId],
    };
  }

  #noNewLowCondition(input: V3DecisionInput): V3Condition {
    const freshAssets = Object.values(input.market.assets).filter(
      ({ freshness, price }) => freshness === "FRESH" && price !== null,
    );
    const duration =
      this.#lastLowAt === null
        ? 0
        : Math.max(0, Math.floor((Date.parse(input.now) - Date.parse(this.#lastLowAt)) / 1_000));
    const state: V3Condition["state"] =
      freshAssets.length < 4
        ? Object.values(input.market.assets).some(({ freshness }) => freshness === "STALE")
          ? "STALE"
          : "UNKNOWN"
        : duration >= this.#config.model.rebuy.noNewLowSeconds
          ? "PASS"
          : "FAIL";
    return {
      id: "B2-CROSS-ASSET-NO-NEW-LOW",
      label: "跨资产无新低",
      state,
      current: `${duration} 秒未出现新的运行低点`,
      target: `BTC/ETH/SOL/VIRTUAL 均新鲜，持续 ≥ ${this.#config.model.rebuy.noNewLowSeconds} 秒`,
      gap:
        state === "PASS"
          ? "0"
          : freshAssets.length < 4
            ? `还缺 ${4 - freshAssets.length} 个新鲜价格`
            : `还差 ${Math.max(0, this.#config.model.rebuy.noNewLowSeconds - duration)} 秒`,
      progress:
        freshAssets.length < 4
          ? null
          : Math.min(1, duration / this.#config.model.rebuy.noNewLowSeconds),
      durationSeconds: duration,
      source: "binance-spot-public",
      dataAgeMs: Math.max(
        ...Object.values(input.market.assets).map(({ dataAgeMs }) => dataAgeMs ?? 0),
      ),
      reason: "A fresh lower mid-price in any tracked asset resets this timer",
      evidenceIds: input.market.evidenceIds,
    };
  }
}

export function decisionTimestamp(value: string | Date): Timestamp {
  return timestamp(value);
}
