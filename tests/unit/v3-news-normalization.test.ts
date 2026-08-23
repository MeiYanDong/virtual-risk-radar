import { readFileSync } from "node:fs";
import { timestamp } from "@virtual/domain";
import { normalizeTechFlowItem, type RawTechFlowItem } from "@virtual/news";
import { z } from "zod";
import { describe, expect, it } from "vitest";

const CaseSchema = z.object({
  id: z.number().int(),
  region: z.string(),
  title: z.string(),
  abstract: z.string(),
  expectedType: z.string(),
  expectedDirection: z.string(),
  expectedSeverity: z.string(),
  expectedCountries: z.array(z.string()),
  expectedMarketReaction: z.enum(["DOWNTURN", "UPTURN", "NONE"]),
});

const cases = z
  .array(CaseSchema)
  .parse(
    JSON.parse(
      readFileSync(new URL("../fixtures/news-v3/global-macro-cases.json", import.meta.url), "utf8"),
    ),
  );
const NOW = timestamp("2026-08-23T10:00:01.000Z");

function normalize(testCase: (typeof cases)[number]) {
  const item: RawTechFlowItem = {
    id: testCase.id,
    title: testCase.title,
    abstract: testCase.abstract,
    source: "fixture",
    url: `https://example.com/${testCase.id}`,
    created_at: "2026-08-23T10:00:00.000Z",
    updated_at: "2026-08-23T10:00:00.000Z",
    category: { id: 1, name: "fixture" },
    content_categories: [],
  };
  return normalizeTechFlowItem({
    item,
    receivedAt: NOW,
    accessedAt: NOW,
    revision: 0,
    bodyExcerptCharacters: 600,
  });
}

describe("global macro normalization", () => {
  it.each(cases)(
    "$region / $id maps by event semantics rather than a country-specific adapter",
    (testCase) => {
      const event = normalize(testCase);
      expect(event.eventType).toBe(testCase.expectedType);
      expect(event.direction).toBe(testCase.expectedDirection);
      expect(event.severity).toBe(testCase.expectedSeverity);
      expect(event.countries).toEqual(expect.arrayContaining(testCase.expectedCountries));
      expect(event.classificationReason).toMatch(/Deterministic|No deterministic/);
    },
  );

  it("treats the Canada replay as one TRADE_SANCTIONS event and never as a route", () => {
    const canadaCase = cases[0];
    if (canadaCase === undefined) throw new Error("Canada fixture is required");
    const event = normalize(canadaCase);
    expect(event).toMatchObject({
      eventType: "TRADE_SANCTIONS",
      entities: expect.arrayContaining(["美国", "加拿大"]),
      countries: expect.arrayContaining(["US", "CA"]),
    });
    expect(event.classificationReason).toContain("country is an entity, not a routing key");
  });

  it("retains news-with-no-price-reaction fixtures as negative evaluation samples", () => {
    const noReaction = cases.filter(
      ({ expectedMarketReaction }) => expectedMarketReaction === "NONE",
    );
    expect(noReaction).toHaveLength(3);
    expect(noReaction.map(({ id }) => id)).toEqual([2003, 2009, 2010]);
  });

  it("marks an explicit future calendar phrase as scheduled without using an LLM", () => {
    const scheduledCase = cases.find(({ id }) => id === 2009);
    if (scheduledCase === undefined) throw new Error("Scheduled fixture is required");
    expect(normalize(scheduledCase)).toMatchObject({
      scheduledState: "SCHEDULED",
      direction: "UNKNOWN",
    });
  });
});
