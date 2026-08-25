import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  MemoryTechFlowCursorStore,
  TechFlowPublicAdapter,
  normalizeTechFlowItem,
  parseTechFlowDetailHtml,
  parseTechFlowListHtml,
  type RawTechFlowItem,
} from "@virtual/news";
import { timestamp } from "@virtual/domain";
import { describe, expect, it, vi } from "vitest";

const NOW = timestamp("2026-08-23T10:15:18.000Z");
const LIST_FIXTURE = readFileSync(
  new URL("../fixtures/techflow/2026-08-23/list.html", import.meta.url),
  "utf8",
);
const DETAIL_FIXTURE = readFileSync(
  new URL("../fixtures/techflow/2026-08-23/detail-133124.html", import.meta.url),
  "utf8",
);
const MANIFEST = JSON.parse(
  readFileSync(new URL("../fixtures/techflow/2026-08-23/manifest.json", import.meta.url), "utf8"),
) as {
  capturedAt: string;
  privacy: string;
  files: Array<{ path: string; sourceUrl: string; sha256: string }>;
};

function raw(id: number, overrides: Partial<RawTechFlowItem> = {}): RawTechFlowItem {
  return {
    id,
    title: `快讯 ${id}`,
    abstract: "美国宣布加征关税，贸易谈判暂停。",
    source: "金十",
    url: "https://example.com/original",
    created_at: "2026-08-23T10:00:00.000Z",
    updated_at: "2026-08-23T10:00:00.000Z",
    category: { id: 1006, name: "加密动态" },
    content_categories: ["web3"],
    ...overrides,
  };
}

function page(items: RawTechFlowItem[]): string {
  const payload = `fixture:${JSON.stringify({ data: items })}`;
  return `<html><body><h1>7x24h快讯</h1><script>self.__next_f.push(${JSON.stringify([
    1,
    payload,
  ])})</script></body></html>`;
}

function adapter(input: {
  responses: Response[];
  store?: MemoryTechFlowCursorStore;
  now?: string | (() => Date);
}) {
  const now = input.now;
  const requests: (RequestInfo | URL)[] = [];
  const headers: Headers[] = [];
  let index = 0;
  const instance = new TechFlowPublicAdapter({
    pollIntervalMs: 10_000,
    requestTimeoutMs: 1_000,
    freshnessMs: 30_000,
    maxItemsPerPoll: 50,
    bodyExcerptCharacters: 600,
    cursorStore: input.store ?? new MemoryTechFlowCursorStore(),
    fetch: async (request, init) => {
      requests.push(request);
      headers.push(new Headers(init?.headers));
      const response = input.responses[index];
      index += 1;
      if (response === undefined) throw new Error("missing mocked response");
      return response;
    },
    now: typeof now === "function" ? now : () => new Date(now ?? NOW),
  });
  return { instance, requests, headers };
}

describe("TechFlow public newsletter parser", () => {
  it("pins public fixture provenance, acquisition time, URLs, and content hashes", () => {
    expect(MANIFEST.capturedAt).toBe("2026-08-23T10:15:18.000Z");
    expect(MANIFEST.privacy).toContain("No authentication");
    for (const file of MANIFEST.files) {
      const body = readFileSync(
        new URL(`../fixtures/techflow/2026-08-23/${file.path}`, import.meta.url),
      );
      expect(createHash("sha256").update(body).digest("hex")).toBe(file.sha256);
      expect(file.sourceUrl).toMatch(/^https:\/\/www\.techflowpost\.com\/newsletter/);
    }
  });

  it("parses the captured list and detail with stable public IDs and canonical UTC fields", () => {
    const items = parseTechFlowListHtml(LIST_FIXTURE);
    expect(items.map(({ id }) => id)).toEqual([133124, 133121]);
    expect(items[0]).toMatchObject({
      title: expect.stringContaining("The Sandbox"),
      created_at: "2026-08-23T10:05:25.722Z",
      url: "https://news.bitcoin.com/example-sandbox-bridge",
    });
    expect(
      parseTechFlowDetailHtml(DETAIL_FIXTURE, "https://www.techflowpost.com/newsletter/133124"),
    ).toMatchObject({ id: 133124, source: "" });
  });

  it("keeps missing original link and attribution explicit instead of inventing values", () => {
    const normalized = normalizeTechFlowItem({
      item: raw(7, { source: "", url: "", abstract: "一条无法归因的普通消息" }),
      receivedAt: NOW,
      accessedAt: NOW,
      revision: 0,
      bodyExcerptCharacters: 600,
    });
    expect(normalized.originalUrl).toBeNull();
    expect(normalized.sourceAttribution).toBeNull();
    expect(normalized.eventType).toBe("OTHER");
    expect(normalized.direction).toBe("UNKNOWN");
  });

  it.each([
    ["<html><body>请先登录后查看</body></html>", "TECHFLOW_LOGIN_WALL"],
    ["<html><body><h1>7x24h快讯</h1></body></html>", "TECHFLOW_SCHEMA_DRIFT"],
    [page([]), "TECHFLOW_SCHEMA_DRIFT"],
  ])("fails visibly for login, empty, and schema-drift pages", (html, message) => {
    expect(() => parseTechFlowListHtml(html)).toThrow(message);
  });

  it("orders same-second items deterministically and handles cross-day ISO times", () => {
    const items = parseTechFlowListHtml(
      page([
        raw(2, { created_at: "2026-08-23T00:00:00.000Z" }),
        raw(3, { created_at: "2026-08-23T00:00:00.000Z" }),
        raw(1, { created_at: "2026-08-22T23:59:59.999Z" }),
      ]),
    );
    expect(items.map(({ id }) => id)).toEqual([3, 2, 1]);
  });

  it("treats a pinned item as an ordinary ID and trusts structured UTC over visible Chinese time", () => {
    const html = page([
      raw(10, { created_at: "2026-08-23T10:00:00.000Z", is_starting: true }),
      raw(11, { created_at: "2026-08-23T10:01:00.000Z" }),
    ]).replace("</body>", "<time>08月23日 18:00</time></body>");
    const items = parseTechFlowListHtml(html);
    expect(items.map(({ id }) => id)).toEqual([11, 10]);
    expect(items[1]?.is_starting).toBe(true);
    expect(items[1]?.created_at).toBe("2026-08-23T10:00:00.000Z");
  });

  it("fails visibly when a requested detail no longer contains that item", () => {
    expect(() =>
      parseTechFlowDetailHtml(page([raw(12)]), "https://www.techflowpost.com/newsletter/11"),
    ).toThrow("TECHFLOW_DETAIL_ITEM_MISSING");
  });
});

describe("TechFlow conservative polling and cursor semantics", () => {
  it("deduplicates repeated list items and emits a revision only when content changes", async () => {
    const store = new MemoryTechFlowCursorStore();
    const first = raw(100);
    const changed = raw(100, {
      abstract: "美国宣布将关税提高至 50%，贸易谈判暂停。",
      updated_at: "2026-08-23T10:01:00.000Z",
    });
    const { instance } = adapter({
      store,
      responses: [
        new Response(page([first]), { status: 200 }),
        new Response(page([first]), { status: 200 }),
        new Response(page([changed]), { status: 200 }),
      ],
    });

    expect((await instance.pollOnce()).items[0]).toMatchObject({ revision: 0 });
    expect((await instance.pollOnce()).items).toHaveLength(0);
    expect((await instance.pollOnce()).items[0]).toMatchObject({ revision: 1 });
    expect(instance.health()).toMatchObject({
      status: "HEALTHY",
      messagesReceived: 3,
      uniqueItems: 2,
      duplicates: 1,
    });
    expect(instance.health().evidenceIds[0]).toMatch(/^techflow-page-/);
    expect(instance.metrics()).toMatchObject({
      attempts: 3,
      successes: 3,
      uniqueItems: 2,
      bootstrapItems: 1,
      duplicates: 1,
      liveItemLatencySampleSize: 1,
    });
  });

  it("restores a persisted cursor across adapter restart without re-emitting old items", async () => {
    const store = new MemoryTechFlowCursorStore();
    const first = adapter({ store, responses: [new Response(page([raw(100)]), { status: 200 })] });
    expect((await first.instance.pollOnce()).items).toHaveLength(1);

    const restarted = adapter({
      store,
      responses: [new Response(page([raw(101), raw(100)]), { status: 200 })],
    });
    const result = await restarted.instance.pollOnce();
    expect(result.items.map(({ sourceItemId }) => sourceItemId)).toEqual(["101"]);
    expect(result.coverageGap).toBeNull();
  });

  it("does not create a signal when a previously visible non-cursor item is deleted", async () => {
    const { instance } = adapter({
      responses: [
        new Response(page([raw(100), raw(99)]), { status: 200 }),
        new Response(page([raw(100)]), { status: 200 }),
      ],
    });
    await instance.pollOnce();
    const result = await instance.pollOnce();
    expect(result.items).toHaveLength(0);
    expect(result.coverageGap).toBeNull();
  });

  it("uses ETag and Last-Modified validators on later polls", async () => {
    const { instance, headers } = adapter({
      responses: [
        new Response(page([raw(100)]), {
          status: 200,
          headers: { etag: '"fixture-v1"', "last-modified": "Sat, 23 Aug 2026 10:00:00 GMT" },
        }),
        new Response(null, { status: 304 }),
      ],
    });
    await instance.pollOnce();
    const second = await instance.pollOnce();
    expect(headers[1]?.get("if-none-match")).toBe('"fixture-v1"');
    expect(headers[1]?.get("if-modified-since")).toBe("Sat, 23 Aug 2026 10:00:00 GMT");
    expect(second).toMatchObject({ notModified: true, items: [] });
  });

  it("surfaces a cursor coverage gap when restart state falls out of the visible page", async () => {
    const store = new MemoryTechFlowCursorStore();
    const { instance } = adapter({
      store,
      responses: [
        new Response(page([raw(100), raw(99)]), { status: 200 }),
        new Response(page([raw(105), raw(104)]), { status: 200 }),
      ],
    });
    await instance.pollOnce();
    const result = await instance.pollOnce();
    expect(result.coverageGap).toBe("CURSOR_NOT_VISIBLE:100->105");
    expect(result.health).toMatchObject({ status: "DEGRADED", errorCode: "COVERAGE_GAP" });
  });

  it.each([403, 429, 500])("keeps HTTP %s as an explicit source error", async (status) => {
    const { instance } = adapter({ responses: [new Response("failure", { status })] });
    await expect(instance.pollOnce()).rejects.toThrow(`TECHFLOW_HTTP_${status}`);
    expect(instance.health()).toMatchObject({
      status: "ERROR",
      errorCode: `TECHFLOW_HTTP_${status}`,
    });
    expect(instance.metrics().errorsByCode).toMatchObject({
      [`TECHFLOW_HTTP_${status}`]: 1,
    });
  });

  it("does not return old items as fresh after a schema drift", async () => {
    const { instance } = adapter({
      responses: [
        new Response(page([raw(100)]), { status: 200 }),
        new Response("<html><body>redesigned</body></html>", { status: 200 }),
      ],
    });
    expect((await instance.pollOnce()).items).toHaveLength(1);
    await expect(instance.pollOnce()).rejects.toThrow("TECHFLOW_SCHEMA_DRIFT_OR_EMPTY_LIST");
    expect(instance.health().status).toBe("ERROR");
  });

  it("marks a once-healthy source stale after 30 seconds and recovers on the next semantic parse", async () => {
    let now = new Date("2026-08-23T10:00:00.000Z");
    const { instance } = adapter({
      now: () => now,
      responses: [
        new Response(page([raw(100)]), { status: 200 }),
        new Response(page([raw(101), raw(100)]), { status: 200 }),
      ],
    });
    await instance.pollOnce();
    expect(instance.health().status).toBe("HEALTHY");

    now = new Date("2026-08-23T10:00:30.001Z");
    expect(instance.health()).toMatchObject({
      status: "STALE",
      errorCode: "TECHFLOW_STALE",
      dataAgeMs: 30_001,
    });

    await instance.pollOnce();
    expect(instance.health()).toMatchObject({ status: "HEALTHY", errorCode: null, dataAgeMs: 0 });
  });

  it("turns an old successful parse into stale even when the latest attempt failed", async () => {
    let now = new Date("2026-08-23T10:00:00.000Z");
    const { instance } = adapter({
      now: () => now,
      responses: [
        new Response(page([raw(100)]), { status: 200 }),
        new Response("failure", { status: 500 }),
      ],
    });
    await instance.pollOnce();
    now = new Date("2026-08-23T10:00:10.000Z");
    await expect(instance.pollOnce()).rejects.toThrow("TECHFLOW_HTTP_500");
    expect(instance.health().status).toBe("ERROR");

    now = new Date("2026-08-23T10:00:30.001Z");
    expect(instance.health()).toMatchObject({
      status: "STALE",
      errorCode: "TECHFLOW_STALE",
      dataAgeMs: 30_001,
    });
    expect(instance.metrics().errorsByCode).toMatchObject({ TECHFLOW_HTTP_500: 1 });
  });

  it("uses an explicit deadline so a fetch promise that ignores abort cannot stop later polling", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const instance = new TechFlowPublicAdapter({
        pollIntervalMs: 10,
        requestTimeoutMs: 5,
        freshnessMs: 30_000,
        maxItemsPerPoll: 50,
        bodyExcerptCharacters: 600,
        cursorStore: new MemoryTechFlowCursorStore(),
        fetch: async () => {
          calls += 1;
          if (calls === 1) return await new Promise<Response>(() => undefined);
          return new Response(page([raw(102)]), { status: 200 });
        },
        now: () => new Date("2026-08-23T10:00:00.000Z"),
      });
      instance.start();
      await vi.advanceTimersByTimeAsync(6);
      expect(instance.health()).toMatchObject({ status: "ERROR", errorCode: "TECHFLOW_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(11);
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(instance.health().status).toBe("HEALTHY");
      instance.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
