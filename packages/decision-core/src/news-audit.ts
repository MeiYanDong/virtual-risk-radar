import {
  V3NewsAuditJudgmentSchema,
  timestamp,
  type Timestamp,
  type V3NewsAuditCheck,
  type V3NewsAuditJudgment,
  type V3NewsItem,
} from "@virtual/domain";

const EVENT_LABELS: Record<V3NewsItem["eventType"], string> = {
  MONETARY_MACRO: "货币与宏观",
  TRADE_SANCTIONS: "贸易与制裁",
  GEOPOLITICS: "地缘政治",
  FINANCIAL_STABILITY: "金融稳定",
  ENERGY_SUPPLY: "能源供给",
  CRYPTO_POLICY: "加密政策",
  OTHER: "普通快讯",
  UNKNOWN: "类型待确认",
};

function notApplicable(
  id: V3NewsAuditCheck["id"],
  label: string,
  reason: string,
): V3NewsAuditCheck {
  return { id, label, state: "NOT_APPLICABLE", current: "无需继续判断", reason };
}

function observationWindowCheck(
  item: V3NewsItem,
  now: Timestamp,
  armWindowSeconds: number,
): { check: V3NewsAuditCheck; endsAt: Timestamp | null } {
  if (item.sourceOccurredAt === null) {
    return {
      check: {
        id: "OBSERVATION_WINDOW",
        label: "仍在观察窗口",
        state: "REVIEW_REQUIRED",
        current: "新闻发生时间无法确认",
        reason: "缺少可信的新闻发生时间，不能证明事件仍然新鲜",
      },
      endsAt: null,
    };
  }
  const nowMs = Date.parse(now);
  const sourceMs = Date.parse(item.sourceOccurredAt);
  const receivedMs = Date.parse(item.receivedAt);
  const windowMs = armWindowSeconds * 1_000;
  const endsAt = timestamp(new Date(Math.min(sourceMs + windowMs, receivedMs + windowMs)));
  if (sourceMs > nowMs || receivedMs > nowMs) {
    return {
      check: {
        id: "OBSERVATION_WINDOW",
        label: "仍在观察窗口",
        state: "REVIEW_REQUIRED",
        current: "时间顺序异常",
        reason: "新闻发生或接收时间晚于判断时间，需要人工复核时钟与来源时间",
      },
      endsAt,
    };
  }
  const sourceAge = nowMs - sourceMs;
  const receivedAge = nowMs - receivedMs;
  if (sourceAge > windowMs || receivedAge > windowMs) {
    return {
      check: {
        id: "OBSERVATION_WINDOW",
        label: "仍在观察窗口",
        state: "FAIL",
        current: `首次判断时已超过 ${armWindowSeconds / 60} 分钟窗口`,
        reason: "事件内容可能仍值得阅读，但不能再作为当前宏观风险启动条件",
      },
      endsAt,
    };
  }
  return {
    check: {
      id: "OBSERVATION_WINDOW",
      label: "仍在观察窗口",
      state: "PASS",
      current: `处于 ${armWindowSeconds / 60} 分钟观察窗口内`,
      reason: "新闻发生时间和系统接收时间都满足当前时效要求",
    },
    endsAt,
  };
}

export function evaluateNewsAuditJudgment(input: {
  item: V3NewsItem;
  now: Timestamp;
  armWindowSeconds: number;
  modelVersion: string;
  configVersion: string;
}): V3NewsAuditJudgment {
  const { item } = input;
  const relevance: V3NewsAuditCheck = item.macroRelevant
    ? {
        id: "MACRO_RELEVANCE",
        label: "属于宏观风险",
        state: "PASS",
        current: EVENT_LABELS[item.eventType],
        reason: "命中全球宏观、政策、贸易、地缘、金融稳定、能源或加密政策规则",
      }
    : {
        id: "MACRO_RELEVANCE",
        label: "属于宏观风险",
        state: "FAIL",
        current: EVENT_LABELS[item.eventType],
        reason: "未匹配当前全球宏观风险类别，作为普通快讯保留供人工核对",
      };

  const direction: V3NewsAuditCheck = !item.macroRelevant
    ? notApplicable("RISK_DIRECTION", "风险正在上升", "非宏观风险快讯无需继续判断方向门槛")
    : item.direction === "RISK_OFF"
      ? {
          id: "RISK_DIRECTION",
          label: "风险正在上升",
          state: "PASS",
          current: "风险偏高",
          reason: "文本包含冲突、制裁、加征、暂停、危机或其他风险升级语义",
        }
      : item.direction === "UNKNOWN"
        ? {
            id: "RISK_DIRECTION",
            label: "风险正在上升",
            state: "REVIEW_REQUIRED",
            current: "方向无法确认",
            reason: "事件相关，但现有确定性规则无法证明风险正在上升或缓和",
          }
        : {
            id: "RISK_DIRECTION",
            label: "风险正在上升",
            state: "FAIL",
            current: item.direction === "RISK_ON" ? "风险缓和" : "影响中性",
            reason: "事件方向没有显示风险上升，因此不启动减仓观察",
          };

  const severity: V3NewsAuditCheck = !item.macroRelevant
    ? notApplicable("IMPACT_SEVERITY", "达到高影响", "非宏观风险快讯无需继续判断影响门槛")
    : item.severity === "HIGH" || item.severity === "SYSTEMIC"
      ? {
          id: "IMPACT_SEVERITY",
          label: "达到高影响",
          state: "PASS",
          current: item.severity === "SYSTEMIC" ? "系统性影响" : "高影响",
          reason: "影响级别达到新闻风险启动门槛",
        }
      : item.severity === "UNKNOWN"
        ? {
            id: "IMPACT_SEVERITY",
            label: "达到高影响",
            state: "REVIEW_REQUIRED",
            current: "影响程度无法确认",
            reason: "现有确定性规则无法可靠判断影响程度，需要人工复核",
          }
        : {
            id: "IMPACT_SEVERITY",
            label: "达到高影响",
            state: "FAIL",
            current: item.severity === "MEDIUM" ? "中等影响" : "低影响",
            reason: "影响级别尚未达到高或系统性门槛",
          };

  const window = item.macroRelevant
    ? observationWindowCheck(item, input.now, input.armWindowSeconds)
    : {
        check: notApplicable(
          "OBSERVATION_WINDOW",
          "仍在观察窗口",
          "非宏观风险快讯无需进入风险观察窗口",
        ),
        endsAt: null,
      };
  const checks = [relevance, direction, severity, window.check] as const;
  const failed = checks.find(({ state }) => state === "FAIL");
  const review = checks.find(({ state }) => state === "REVIEW_REQUIRED");
  const outcome: V3NewsAuditJudgment["outcome"] =
    failed !== undefined
      ? "NOT_TRIGGERED"
      : review !== undefined
        ? "REVIEW_REQUIRED"
        : "ENTERED_RISK_OBSERVATION";
  const summary =
    outcome === "ENTERED_RISK_OBSERVATION"
      ? "符合宏观相关、风险上升、高影响和时效要求，已进入风险观察；仍需市场条件共同确认"
      : ((failed ?? review)?.reason ?? "判断信息不足，需要人工复核");

  return V3NewsAuditJudgmentSchema.parse({
    outcome,
    summary,
    checks,
    judgedAt: input.now,
    observationWindowEndsAt: window.endsAt,
    ruleVersion: "news-gate-v1",
    modelVersion: input.modelVersion,
    configVersion: input.configVersion,
  });
}

export function qualifiesForMacroObservation(input: {
  item: V3NewsItem;
  now: Timestamp;
  armWindowSeconds: number;
}): boolean {
  return (
    evaluateNewsAuditJudgment({
      ...input,
      modelVersion: "runtime-gate",
      configVersion: "runtime-gate",
    }).outcome === "ENTERED_RISK_OBSERVATION"
  );
}
