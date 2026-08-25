// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { V3NewsAuditRecordSchema, type V3NewsAuditJudgment } from "@virtual/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsAuditView } from "../../apps/web/src/NewsAuditPage";
import type { NewsAuditResponse } from "../../apps/web/src/types";

afterEach(cleanup);

const HASH = `sha256:${"1".repeat(64)}` as const;

function record(id: number, outcome: V3NewsAuditJudgment["outcome"], summary: string) {
  return V3NewsAuditRecordSchema.parse({
    schemaVersion: "1.0.0",
    recordId: `news-audit-${id}-r0-${"1".repeat(12)}`,
    recordHash: HASH,
    item: {
      observationId: `techflow-${id}-r0-${"1".repeat(12)}`,
      sourceId: "techflow-public-newsletter",
      sourceItemId: String(id),
      sourceUrl: `https://www.techflowpost.com/newsletter/${id}`,
      originalUrl: `https://example.com/${id}`,
      headline: id === 9201 ? "某项目发布新版开发工具" : "全球贸易谈判暂停",
      bodyExcerpt: "这是程序读取到的必要摘要，用于解释为什么作出当前判断。",
      sourceAttribution: "金十",
      categories: ["快讯"],
      sourceOccurredAt: "2026-08-23T10:14:00.000Z",
      receivedAt: "2026-08-23T10:14:01.000Z",
      accessedAt: "2026-08-23T10:14:01.000Z",
      updatedAt: "2026-08-23T10:14:00.000Z",
      revision: 0,
      rawTextHash: HASH,
      eventType: outcome === "NOT_TRIGGERED" ? "OTHER" : "TRADE_SANCTIONS",
      entities: [],
      countries: [],
      direction: outcome === "ENTERED_RISK_OBSERVATION" ? "RISK_OFF" : "UNKNOWN",
      severity: outcome === "ENTERED_RISK_OBSERVATION" ? "HIGH" : "UNKNOWN",
      scheduledState: "UNKNOWN",
      macroRelevant: outcome !== "NOT_TRIGGERED",
      classificationReason: "fixture",
      schemaVersion: "3.0.0",
    },
    judgment: {
      outcome,
      summary,
      checks: [
        {
          id: "MACRO_RELEVANCE",
          state: outcome === "NOT_TRIGGERED" ? "FAIL" : "PASS",
          label: "属于宏观风险",
          current: outcome === "NOT_TRIGGERED" ? "普通快讯" : "贸易与制裁",
          reason: "逐条判断原因一",
        },
        {
          id: "RISK_DIRECTION",
          state: outcome === "ENTERED_RISK_OBSERVATION" ? "PASS" : "REVIEW_REQUIRED",
          label: "风险正在上升",
          current: "方向待确认",
          reason: "逐条判断原因二",
        },
        {
          id: "IMPACT_SEVERITY",
          state: outcome === "ENTERED_RISK_OBSERVATION" ? "PASS" : "NOT_APPLICABLE",
          label: "达到高影响",
          current: "影响待确认",
          reason: "逐条判断原因三",
        },
        {
          id: "OBSERVATION_WINDOW",
          state: outcome === "ENTERED_RISK_OBSERVATION" ? "PASS" : "NOT_APPLICABLE",
          label: "仍在观察窗口",
          current: "两小时以内",
          reason: "逐条判断原因四",
        },
      ],
      judgedAt: "2026-08-23T10:14:01.000Z",
      observationWindowEndsAt: "2026-08-23T12:14:00.000Z",
      ruleVersion: "news-gate-v1",
      modelVersion: "0.3.0",
      configVersion: "0.3.2",
    },
  });
}

function response(): NewsAuditResponse {
  const ordinary = record(
    9201,
    "NOT_TRIGGERED",
    "未匹配当前全球宏观风险类别，作为普通快讯保留供人工核对",
  );
  const alert = record(9202, "ENTERED_RISK_OBSERVATION", "已进入风险观察；仍需市场条件共同确认");
  return {
    generatedAt: "2026-08-23T10:15:18.000Z",
    source: {
      sourceId: "techflow-public-newsletter",
      label: "TechFlow 7×24h",
      category: "NEWS",
      capabilityState: "VERIFIED_CURRENT",
      status: "HEALTHY",
      transport: "PUBLIC_WEBPAGE",
      endpoint: "https://www.techflowpost.com/newsletter",
      lastAttemptAt: "2026-08-23T10:15:17.000Z",
      lastSuccessAt: "2026-08-23T10:15:17.000Z",
      dataAgeMs: 1_000,
      messagesReceived: 12,
      uniqueItems: 2,
      duplicates: 10,
      gaps: 0,
      reconnects: 0,
      errorCode: null,
      reason: "Parsed current public newsletter items",
      evidenceIds: ["fixture"],
    },
    metrics: {
      attempts: 12,
      successes: 12,
      currentPageItems: 9,
      uniqueItems: 2,
      duplicates: 10,
      gaps: 0,
      errorsByCode: {},
      lastAttemptAt: "2026-08-23T10:15:17.000Z",
      dataAgeMs: 1_000,
    },
    items: [
      { record: ordinary, revisionCount: 1 },
      { record: alert, revisionCount: 1 },
    ],
    total: 2,
    filteredTotal: 2,
    counts: { ENTERED_RISK_OBSERVATION: 1, NOT_TRIGGERED: 1, REVIEW_REQUIRED: 0 },
    nextCursor: null,
    historyBoundary: "fixture",
    contentBoundary: "fixture",
  };
}

describe("reader-facing TechFlow news audit page", () => {
  it("shows every captured outcome, source heartbeat, and official comparison links", () => {
    render(
      <NewsAuditView
        data={response()}
        loading={false}
        error={null}
        outcome="ALL"
        query=""
        onOutcomeChange={() => undefined}
        onQueryChange={() => undefined}
        onLoadMore={() => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "每一条，都有判断。" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "TechFlow 采集状态" })).toHaveTextContent(
      "新闻采集正常",
    );
    expect(screen.getByRole("region", { name: "TechFlow 采集状态" })).toHaveTextContent(
      "官网当前列表9 条",
    );
    expect(screen.getByText("某项目发布新版开发工具")).toBeInTheDocument();
    expect(screen.getByText("全球贸易谈判暂停")).toBeInTheDocument();
    expect(screen.getByText("未进入风险观察")).toBeInTheDocument();
    expect(screen.getByText("进入风险观察")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "去 TechFlow 核对 ↗" })[0]).toHaveAttribute(
      "href",
      "https://www.techflowpost.com/newsletter/9201",
    );
  });

  it("expands the four-step explanation without exposing backend enums or hashes", () => {
    render(
      <NewsAuditView
        data={response()}
        loading={false}
        error={null}
        outcome="ALL"
        query=""
        onOutcomeChange={() => undefined}
        onQueryChange={() => undefined}
        onLoadMore={() => undefined}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "展开判断" })[0] as HTMLElement);
    const path = screen.getByRole("list", { name: "这条新闻的四步判断" });
    expect(within(path).getAllByText(/第 [1-4] 步/)).toHaveLength(4);
    expect(screen.getByText(/这是程序读取到的必要摘要/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("NOT_TRIGGERED");
    expect(document.body).not.toHaveTextContent("techflow-public-newsletter");
    expect(document.body).not.toHaveTextContent(HASH);
  });

  it("exposes understandable filters and sends the selected outcome to the controller", () => {
    const onOutcomeChange = vi.fn();
    render(
      <NewsAuditView
        data={response()}
        loading={false}
        error={null}
        outcome="ALL"
        query=""
        onOutcomeChange={onOutcomeChange}
        onQueryChange={() => undefined}
        onLoadMore={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /未进入\s*1/ }));
    expect(onOutcomeChange).toHaveBeenCalledWith("NOT_TRIGGERED");
  });
});
