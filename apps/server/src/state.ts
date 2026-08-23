import Decimal from "decimal.js";
import type { SystemConfig } from "@virtual/config";
import { z } from "zod";

export type DashboardCondition = {
  id: string;
  label: string;
  state: "PASS" | "FAIL" | "UNKNOWN" | "STALE" | "VETO";
  current: string;
  target: string;
  gap: string;
  progress: number | null;
  duration: string;
  freshness: string;
  source: string;
};

export type DashboardGate = {
  id: string;
  label: string;
  state: "PASS" | "FAIL" | "UNKNOWN" | "VETO";
  reason: string;
};

export type DashboardState = {
  evidenceLevel: "REPOSITORY_RECORD" | "HISTORICAL_RECEIPT";
  source: "DEFAULT_FIXTURE" | "HISTORICAL_REPLAY_2026_08_22";
  asOf: string;
  mode: SystemConfig["mode"];
  economicEvidence: SystemConfig["economicEvidence"];
  replayConclusion: string;
  sell: {
    stage: string;
    recommendedAction: string;
    passed: number;
    required: number;
    nextGap: string;
    conditions: DashboardCondition[];
    hardGates: DashboardGate[];
  };
  rebuy: {
    stage: string;
    recommendedAction: string;
    passed: number;
    required: number;
    nextGap: string;
    conditions: DashboardCondition[];
    hardGates: DashboardGate[];
  };
  chains: Array<{
    id: "base" | "robinhood";
    label: string;
    state: "BLOCKED_IDENTITY" | "QUOTE_PENDING" | "BLOCKED_COST" | "UNSUPPORTED" | "UNKNOWN";
    identity: string;
    quote: string;
    wallet: string;
    reason: string;
  }>;
  dataHealth: {
    marketFixture: "PASS";
    futureDataDetected: false;
    dexQuoteCoverage: "UNKNOWN";
    liveState: "NOT_RUNNING";
  };
  timeline: Array<{
    eventId: string;
    at: string;
    kind: string;
    message: string;
    evidence: string;
  }>;
};

export const FixtureAnalysisSchema = z
  .object({
    reportId: z.string(),
    evidenceLevel: z.literal("HISTORICAL_RECEIPT"),
    rawManifestChecksum: z.string(),
    verifiedMarketTimeline: z.object({
      newsArmedAt: z.string(),
      firstSellPretriggerAt: z.string(),
      firstSellConfirmedAt: z.string(),
      eventLow: z.object({ at: z.string(), price: z.string(), source: z.string() }),
      noNewLowConditionFirstPassAt: z.string(),
      orderFlowRecoveryFirstPassAt: z.string(),
      broadMarketStabilityFirstPassAt: z.string(),
    }),
    oiAudit: z.object({
      minimumObservedChange: z.object({
        at: z.string(),
        changeFromRiskArmBaselinePct: z.string(),
      }),
      fivePercentFlushEverPassed: z.literal(false),
    }),
    replayConclusion: z.object({
      previousExpectedTimelineStatus: z.literal("FALSIFIED_BY_CAPTURED_DATA"),
      rebuyActionStatus: z.literal("BLOCKED"),
      rebuyBlockers: z.array(z.string()),
      maximumActionLevel: z.string(),
    }),
  })
  .passthrough();
export type FixtureAnalysis = z.infer<typeof FixtureAnalysisSchema>;

function condition(
  input: Omit<DashboardCondition, "duration" | "freshness" | "source"> &
    Partial<Pick<DashboardCondition, "duration" | "freshness" | "source">>,
): DashboardCondition {
  return {
    duration: "—",
    freshness: "HISTORICAL RECEIPT",
    source: "2026-08-22 FIXTURE",
    ...input,
  };
}

export function createFixtureDashboardState(
  config: SystemConfig,
  rawAnalysis: unknown,
): DashboardState {
  const analysis = FixtureAnalysisSchema.parse(rawAnalysis);
  const timeline = analysis.verifiedMarketTimeline;
  const oiChange = new Decimal(analysis.oiAudit.minimumObservedChange.changeFromRiskArmBaselinePct);
  const oiTarget = new Decimal(config.market.rebuy.oiContractsDeclineMinimumPct);
  const oiProgress = Decimal.min(1, oiChange.abs().dividedBy(oiTarget.abs())).toNumber();
  const oiGapPercentagePoints = oiTarget.abs().minus(oiChange.abs()).times(100).toFixed(4);

  return {
    evidenceLevel: "HISTORICAL_RECEIPT",
    source: "HISTORICAL_REPLAY_2026_08_22",
    asOf: analysis.oiAudit.minimumObservedChange.at,
    mode: "REPLAY",
    economicEvidence: config.economicEvidence,
    replayConclusion:
      "旧时间线已被原始数据推翻；市场阶段可重现，但没有历史 DEX 报价、卖出事实或已证明经济优势。",
    sell: {
      stage: "SELL_CONFIRMED / MARKET STAGE ONLY",
      recommendedAction: "BLOCKED — NO HISTORICAL DEX QUOTE",
      passed: 3,
      required: 4,
      nextGap: "S5：缺少 Base / Robinhood 当时、指定数量、未过期的 DEX 报价",
      conditions: [
        condition({
          id: "S0",
          label: "风险上下文",
          state: "PASS",
          current: `NEWS_ARMED @ ${timeline.newsArmedAt}`,
          target: "NEWS_ARMED 或严格 MARKET_ARMED",
          gap: "0",
          progress: 1,
        }),
        condition({
          id: "S1",
          label: "跨资产冲击",
          state: "PASS",
          current: `首次通过 @ ${timeline.firstSellPretriggerAt}`,
          target: "BTC / SOL / VIRTUAL 同时通过",
          gap: "0",
          progress: 1,
        }),
        condition({
          id: "S2",
          label: "VIRTUAL 主动卖盘",
          state: "PASS",
          current: `首次连续确认 @ ${timeline.firstSellConfirmedAt}`,
          target: "买卖比 ≤ 0.60，连续 ≥ 3 秒",
          gap: "0",
          progress: 1,
          duration: "3 秒连续条件已满足",
        }),
        condition({
          id: "S5",
          label: "当前链 DEX 可执行",
          state: "UNKNOWN",
          current: "未记录",
          target: "指定数量的新鲜 DEX 报价",
          gap: "缺 quote / route / cost / wallet evidence",
          progress: null,
          freshness: "NOT RECORDED",
          source: "BASE + ROBINHOOD",
        }),
      ],
      hardGates: [
        {
          id: "G-DATA",
          label: "回放数据",
          state: "PASS",
          reason: "原始数据 checksum 与未来函数测试通过",
        },
        {
          id: "G-ECON",
          label: "经济证据",
          state: "VETO",
          reason: "POSITIVE_EV_NOT_PROVEN",
        },
      ],
    },
    rebuy: {
      stage: "REBUY_INACTIVE",
      recommendedAction: "NO_ACTION",
      passed: 3,
      required: 5,
      nextGap: `B2：OI 仅下降 ${oiChange.abs().times(100).toFixed(4)}%，距离 5% 还差 ${oiGapPercentagePoints} 个百分点；同时没有 DEX-backed 卖出事实`,
      conditions: [
        condition({
          id: "B1",
          label: "无新低",
          state: "PASS",
          current: `事件低点 ${timeline.eventLow.price}；首次通过 @ ${timeline.noNewLowConditionFirstPassAt}`,
          target: "≥ 300 秒",
          gap: "0 秒",
          progress: 1,
          duration: "300 秒",
        }),
        condition({
          id: "B2",
          label: "OI 冲洗",
          state: "FAIL",
          current: `${oiChange.times(100).toFixed(4)}%`,
          target: "≤ -5.0000%",
          gap: `${oiGapPercentagePoints} 个百分点`,
          progress: oiProgress,
          source: "风险警戒前冻结的 OI contracts 基线",
        }),
        condition({
          id: "B3",
          label: "订单流恢复",
          state: "PASS",
          current: `首次通过 @ ${timeline.orderFlowRecoveryFirstPassAt}`,
          target: "买卖比 ≥ 1.10，连续 ≥ 30 秒",
          gap: "0",
          progress: 1,
          duration: "30 秒连续条件已满足",
        }),
        condition({
          id: "B4",
          label: "主流资产稳定",
          state: "PASS",
          current: `首次通过 @ ${timeline.broadMarketStabilityFirstPassAt}`,
          target: "BTC / SOL 稳定 ≥ 30 秒",
          gap: "0",
          progress: 1,
          duration: "30 秒连续条件已满足",
        }),
        condition({
          id: "B5",
          label: "当前链 DEX 可执行",
          state: "UNKNOWN",
          current: "未记录",
          target: "本轮卖出所得的反向 DEX 报价",
          gap: "没有卖出事实，也没有历史 quote",
          progress: null,
          freshness: "NOT RECORDED",
        }),
      ],
      hardGates: [
        {
          id: "G-SELL-FACT",
          label: "卖出事实",
          state: "VETO",
          reason: "没有人工记录或 DEX-backed Shadow fill",
        },
        {
          id: "G-DAMAGE",
          label: "永久损伤",
          state: "UNKNOWN",
          reason: "本 fixture 未完成 VIRTUAL 永久损伤强证据审核",
        },
        {
          id: "G-ECON",
          label: "经济证据",
          state: "VETO",
          reason: "POSITIVE_EV_NOT_PROVEN",
        },
      ],
    },
    chains: [
      {
        id: "base",
        label: "BASE",
        state: "QUOTE_PENDING",
        identity: "VERIFIED_CURRENT / OUTSIDE REPLAY",
        quote: "UNKNOWN:not_recorded",
        wallet: "UNKNOWN",
        reason: "当前 ERC-20 身份已核验；历史指定数量 DEX 报价和用户钱包均缺失",
      },
      {
        id: "robinhood",
        label: "ROBINHOOD",
        state: "UNKNOWN",
        identity: "UNKNOWN",
        quote: "UNKNOWN:not_recorded",
        wallet: "UNKNOWN",
        reason: "chain ID、资产映射、DEX、钱包和历史报价均没有强证据",
      },
    ],
    dataHealth: {
      marketFixture: "PASS",
      futureDataDetected: false,
      dexQuoteCoverage: "UNKNOWN",
      liveState: "NOT_RUNNING",
    },
    timeline: [
      {
        eventId: "news-armed",
        at: timeline.newsArmedAt,
        kind: "NEWS",
        message: "加拿大关税事件聚类进入 NEWS_ARMED；新闻单独不触发卖出",
        evidence: "HISTORICAL_REFERENCE",
      },
      {
        eventId: "sell-pretrigger-corrected",
        at: timeline.firstSellPretriggerAt,
        kind: "SELL",
        message: "跨资产冲击首次通过；旧计划时间 13:05:01 被数据推翻",
        evidence: analysis.rawManifestChecksum,
      },
      {
        eventId: "sell-confirmed-corrected",
        at: timeline.firstSellConfirmedAt,
        kind: "SELL",
        message: "订单流连续条件首次通过；仅为市场阶段，未形成 DEX 行动事实",
        evidence: analysis.rawManifestChecksum,
      },
      {
        eventId: "event-low",
        at: timeline.eventLow.at,
        kind: "LOW",
        message: `VIRTUAL 事件运行低点 ${timeline.eventLow.price}`,
        evidence: timeline.eventLow.source,
      },
      {
        eventId: "rebuy-blocked-oi",
        at: analysis.oiAudit.minimumObservedChange.at,
        kind: "REBUY",
        message: "OI 冲洗从未达到 5%；Rebuy 保持 INACTIVE / NO_ACTION",
        evidence: analysis.reportId,
      },
    ],
  };
}
