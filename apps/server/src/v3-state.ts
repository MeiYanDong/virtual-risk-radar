import type { ActiveSystemConfig } from "@virtual/config";
import {
  V3DashboardStateSchema,
  V3SourceHealthSchema,
  type Timestamp,
  type V3Condition,
  type V3DashboardState,
  type V3DecisionPanel,
} from "@virtual/domain";

function sourceHealth(source: "NEWS" | "MARKET", config: ActiveSystemConfig) {
  return V3SourceHealthSchema.parse({
    sourceId: source === "NEWS" ? config.newsSource.sourceId : config.marketSource.sourceId,
    label: source === "NEWS" ? "TechFlow 7×24h" : "Binance Spot",
    category: source,
    capabilityState: "TESTED",
    status: "WARMING_UP",
    transport: source === "NEWS" ? "PUBLIC_WEBPAGE" : "SPOT_WEBSOCKET",
    endpoint: source === "NEWS" ? config.newsSource.url : config.marketSource.websocketBaseUrl,
    lastAttemptAt: null,
    lastSuccessAt: null,
    dataAgeMs: null,
    messagesReceived: 0,
    uniqueItems: 0,
    duplicates: 0,
    gaps: 0,
    reconnects: 0,
    errorCode: null,
    reason: "Runtime has not completed the first semantically valid read",
    evidenceIds: ["tests/unit/v3-runtime.test.ts"],
  });
}

function unknownCondition(id: string, label: string, source: V3Condition["source"]): V3Condition {
  return {
    id,
    label,
    state: "UNKNOWN",
    current: "—",
    target: "等待实时数据",
    gap: "source warm-up",
    progress: null,
    durationSeconds: null,
    source,
    dataAgeMs: null,
    reason: "No current observation is available",
    evidenceIds: [],
  };
}

function panel(model: "SELL" | "REBUY"): V3DecisionPanel {
  const conditions =
    model === "SELL"
      ? [
          unknownCondition("S1-MACRO-SHOCK", "宏观冲击", "techflow-public-newsletter"),
          unknownCondition("S2-CROSS-ASSET-DRAWDOWN", "跨资产下跌", "binance-spot-public"),
          unknownCondition(
            "S3-VIRTUAL-RELATIVE-WEAKNESS",
            "VIRTUAL 相对弱势",
            "binance-spot-public",
          ),
          unknownCondition("S4-VIRTUAL-SELL-PRESSURE", "VIRTUAL 主动卖压", "binance-spot-public"),
        ]
      : [
          unknownCondition(
            "B1-NO-NEW-MACRO-ESCALATION",
            "无新宏观升级",
            "techflow-public-newsletter",
          ),
          unknownCondition("B2-CROSS-ASSET-NO-NEW-LOW", "跨资产无新低", "binance-spot-public"),
          unknownCondition(
            "B3-VIRTUAL-RELATIVE-RECOVERY",
            "VIRTUAL 相对恢复",
            "binance-spot-public",
          ),
          unknownCondition("B4-SELL-PRESSURE-NORMALIZED", "主动卖压归一", "binance-spot-public"),
        ];
  return {
    model,
    stage: "DATA_UNAVAILABLE",
    output: "NO_ACTION",
    outputBasis: "CEX_REFERENCE",
    passed: 0,
    required: 4,
    conditions,
    nextGap: "等待 TechFlow 与 Binance 完成 warm-up",
    extremeMarketFallback: model === "SELL" ? "NOT_CALIBRATED" : "NOT_USED",
    sellContext: "NONE",
    reason: "Runtime warm-up; UNKNOWN is not treated as zero or failure",
    evidenceIds: [],
  };
}

export function createWarmupDashboardState(
  config: ActiveSystemConfig,
  now: Timestamp,
): V3DashboardState {
  return V3DashboardStateSchema.parse({
    schemaVersion: "3.0.0",
    mode: config.mode,
    asOf: now,
    evidenceLevel: "TESTED",
    economicEvidence: config.economicEvidence,
    outputBasis: config.outputBasis,
    source: "WARMUP_FIXTURE",
    boundaryNotice: "仅 CEX 参考；请在 DEX 钱包检查即时 quote，本系统未连接钱包或链。",
    sources: {
      techflow: sourceHealth("NEWS", config),
      binance: sourceHealth("MARKET", config),
    },
    latestMacroEvent: null,
    market: config.marketSource.assets.map((asset) => ({
      asset,
      symbol: config.marketSource.symbols[asset],
      price: null,
      return60s: null,
      dataAgeMs: null,
      freshness: "UNKNOWN",
    })),
    sell: panel("SELL"),
    rebuy: panel("REBUY"),
    timeline: [
      {
        eventId: "runtime-warmup",
        at: now,
        kind: "SYSTEM",
        message: "v0.3 two-source runtime is warming up",
        evidence: "CURRENT_PROCESS_RESPONSE",
      },
    ],
  });
}
