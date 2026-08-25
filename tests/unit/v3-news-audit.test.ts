import { evaluateNewsAuditJudgment } from "@virtual/decision";
import { timestamp, type V3NewsItem } from "@virtual/domain";
import { normalizeTechFlowItem, type RawTechFlowItem } from "@virtual/news";
import { describe, expect, it } from "vitest";

const RECEIVED = timestamp("2026-08-23T10:00:00.000Z");

function news(overrides: Partial<RawTechFlowItem> = {}): V3NewsItem {
  return normalizeTechFlowItem({
    item: {
      id: 7001,
      title: "全球贸易谈判暂停，多国加征 50% 关税",
      abstract: "多个主要经济体宣布反制，全球贸易风险升级。",
      source: "金十",
      url: "https://example.com/7001",
      created_at: "2026-08-23T09:59:00.000Z",
      updated_at: "2026-08-23T09:59:00.000Z",
      category: { id: 1, name: "全球市场" },
      content_categories: [],
      ...overrides,
    },
    receivedAt: RECEIVED,
    accessedAt: RECEIVED,
    revision: 0,
    bodyExcerptCharacters: 600,
  });
}

function judge(item: V3NewsItem, now = RECEIVED) {
  return evaluateNewsAuditJudgment({
    item,
    now,
    armWindowSeconds: 7_200,
    modelVersion: "0.3.0",
    configVersion: "0.3.2",
  });
}

describe("per-item TechFlow news audit judgment", () => {
  it("enters risk observation only when all four news gates pass", () => {
    const judgment = judge(news());
    expect(judgment.outcome).toBe("ENTERED_RISK_OBSERVATION");
    expect(judgment.checks.map(({ state }) => state)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
    expect(judgment.summary).toContain("仍需市场条件共同确认");
    expect(judgment).toMatchObject({
      ruleVersion: "news-gate-v1",
      modelVersion: "0.3.0",
      configVersion: "0.3.2",
      observationWindowEndsAt: "2026-08-23T11:59:00.000Z",
    });
  });

  it("keeps ordinary news visible with a concrete non-trigger reason", () => {
    const judgment = judge(
      news({
        title: "某项目发布新版开发工具",
        abstract: "团队公布产品路线图。",
      }),
    );
    expect(judgment.outcome).toBe("NOT_TRIGGERED");
    expect(judgment.checks.map(({ state }) => state)).toEqual([
      "FAIL",
      "NOT_APPLICABLE",
      "NOT_APPLICABLE",
      "NOT_APPLICABLE",
    ]);
    expect(judgment.summary).toContain("普通快讯");
  });

  it("routes a relevant event with unknown direction to human review", () => {
    const judgment = judge(
      news({
        title: "美联储召开重大政策会议",
        abstract: "市场等待进一步信息。",
      }),
    );
    expect(judgment.outcome).toBe("REVIEW_REQUIRED");
    expect(judgment.checks[1]).toMatchObject({ state: "REVIEW_REQUIRED" });
    expect(judgment.summary).toContain("无法证明风险正在上升");
  });

  it("does not trigger when severity is known but below the high-impact threshold", () => {
    const judgment = judge(
      news({
        title: "央行收紧部分流动性安排",
        abstract: "相关调整将于下月开始。",
      }),
    );
    expect(judgment.outcome).toBe("NOT_TRIGGERED");
    expect(judgment.checks[2]).toMatchObject({ state: "FAIL", current: "中等影响" });
  });

  it("accepts the exact time boundary and rejects an event one millisecond older", () => {
    const boundary = news({ created_at: "2026-08-23T08:00:00.000Z" });
    expect(judge(boundary).checks[3]?.state).toBe("PASS");

    const expired = news({ created_at: "2026-08-23T07:59:59.999Z" });
    const expiredJudgment = judge(expired);
    expect(expiredJudgment.outcome).toBe("NOT_TRIGGERED");
    expect(expiredJudgment.checks[3]).toMatchObject({ state: "FAIL" });
  });

  it("requires review for future source or receive time instead of treating it as fresh", () => {
    const future = news({ created_at: "2026-08-23T10:00:01.000Z" });
    const judgment = judge(future);
    expect(judgment.outcome).toBe("REVIEW_REQUIRED");
    expect(judgment.checks[3]).toMatchObject({ state: "REVIEW_REQUIRED", current: "时间顺序异常" });
  });
});
