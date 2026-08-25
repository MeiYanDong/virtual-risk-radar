import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateNewsAuditJudgment } from "@virtual/decision";
import { timestamp } from "@virtual/domain";
import { normalizeTechFlowItem } from "@virtual/news";
import { NewsAuditJournal } from "@virtual/storage";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer, loadDefaultConfig } from "../../apps/server/src/app";
import { createWarmupDashboardState } from "../../apps/server/src/v3-state";
import type { V3NewsAuditQuery } from "../../apps/server/src/v3-runtime";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
const directories: string[] = [];
const NOW = new Date("2026-08-23T10:15:18.000Z");

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixtureRecord() {
  const directory = await mkdtemp(join(tmpdir(), "virtual-news-api-"));
  directories.push(directory);
  const item = normalizeTechFlowItem({
    item: {
      id: 9101,
      title: "某项目发布新版开发工具",
      abstract: "团队公布产品路线图，这条新闻没有进入宏观风险观察。",
      source: "TechFlow",
      url: "https://example.com/9101",
      created_at: "2026-08-23T10:14:00.000Z",
      updated_at: "2026-08-23T10:14:00.000Z",
      category: { id: 1, name: "项目动态" },
      content_categories: [],
    },
    receivedAt: timestamp("2026-08-23T10:14:01.000Z"),
    accessedAt: timestamp("2026-08-23T10:14:01.000Z"),
    revision: 0,
    bodyExcerptCharacters: 600,
  });
  const judgment = evaluateNewsAuditJudgment({
    item,
    now: item.receivedAt,
    armWindowSeconds: 7_200,
    modelVersion: "0.3.0",
    configVersion: "0.3.2",
  });
  const journal = new NewsAuditJournal(join(directory, "audit.jsonl"), {
    retentionDays: 180,
    now: () => NOW,
  });
  const record = await journal.append({ item, judgment });
  await journal.flush();
  return record;
}

describe("TechFlow news audit API", () => {
  it("serves paginated audit metadata, parses filters, and exposes source health", async () => {
    const config = await loadDefaultConfig();
    const state = createWarmupDashboardState(config, timestamp(NOW));
    state.sources.techflow.status = "HEALTHY";
    state.sources.techflow.lastAttemptAt = timestamp("2026-08-23T10:15:17.000Z");
    state.sources.techflow.lastSuccessAt = timestamp("2026-08-23T10:15:17.000Z");
    state.sources.techflow.dataAgeMs = 1_000;
    const record = await fixtureRecord();
    let receivedQuery: V3NewsAuditQuery | null = null;
    const server = await buildServer({
      now: () => NOW,
      runtime: {
        snapshot: () => structuredClone(state),
        newsAudit: async (query) => {
          receivedQuery = query;
          return {
            items: [{ record, revisionCount: 1 }],
            total: 1,
            filteredTotal: 1,
            counts: {
              ENTERED_RISK_OBSERVATION: 0,
              NOT_TRIGGERED: 1,
              REVIEW_REQUIRED: 0,
            },
            nextCursor: null,
          };
        },
        newsAuditDetails: async (sourceItemId) =>
          sourceItemId === record.item.sourceItemId ? [record] : [],
      },
    });
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: `/api/news/audit?outcome=NOT_TRIGGERED&query=%E5%BC%80%E5%8F%91&limit=25&cursor=${record.recordId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(receivedQuery).toEqual({
      outcome: "NOT_TRIGGERED",
      query: "开发",
      limit: 25,
      cursor: record.recordId,
    });
    expect(response.json()).toMatchObject({
      source: { status: "HEALTHY" },
      total: 1,
      counts: { NOT_TRIGGERED: 1 },
      items: [
        {
          revisionCount: 1,
          record: {
            item: { headline: "某项目发布新版开发工具" },
            judgment: { outcome: "NOT_TRIGGERED" },
          },
        },
      ],
      contentBoundary: expect.stringContaining("complete TechFlow article bodies"),
    });
    expect(JSON.stringify(response.json())).not.toContain("completeArticleBody");
  });

  it("returns revision details and rejects invalid filters, IDs, limits, and missing items", async () => {
    const config = await loadDefaultConfig();
    const state = createWarmupDashboardState(config, timestamp(NOW));
    const record = await fixtureRecord();
    const server = await buildServer({
      now: () => NOW,
      runtime: {
        snapshot: () => structuredClone(state),
        newsAudit: async () => ({
          items: [],
          total: 0,
          filteredTotal: 0,
          counts: {
            ENTERED_RISK_OBSERVATION: 0,
            NOT_TRIGGERED: 0,
            REVIEW_REQUIRED: 0,
          },
          nextCursor: null,
        }),
        newsAuditDetails: async (sourceItemId) =>
          sourceItemId === record.item.sourceItemId ? [record] : [],
      },
    });
    servers.push(server);

    expect(
      (
        await server.inject({ method: "GET", url: `/api/news/audit/${record.item.sourceItemId}` })
      ).json(),
    ).toMatchObject({ sourceItemId: "9101", revisions: [expect.any(Object)] });
    expect((await server.inject({ method: "GET", url: "/api/news/audit/9999" })).statusCode).toBe(
      404,
    );
    expect(
      (await server.inject({ method: "GET", url: "/api/news/audit/not-an-id" })).statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ method: "GET", url: "/api/news/audit?limit=0" })).statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ method: "GET", url: "/api/news/audit?limit=1.5" })).statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ method: "GET", url: "/api/news/audit?cursor=not-a-cursor" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ method: "GET", url: "/api/news/audit?outcome=MAYBE" })).statusCode,
    ).toBe(400);
  });
});
