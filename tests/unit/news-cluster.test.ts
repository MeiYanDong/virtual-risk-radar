import { readFileSync } from "node:fs";
import { timestamp, type NewsObservation } from "@virtual/domain";
import { clusterNewsObservations, FixtureNewsSourceAdapter, newsArmState } from "@virtual/news";
import { describe, expect, it } from "vitest";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/2026-08-22/news-observations.json", import.meta.url), "utf8"),
) as NewsObservation[];

const policy = {
  relaySourceIds: new Set(["techflow", "watcher-guru-x", "unusual-whales-x"]),
  eventTypeByFingerprint: {
    "canada-us-trade-talks-paused-50pct-reciprocal-tariffs": "MACRO" as const,
    "iran-military-geopolitical-risk-statement": "GEOPOLITICS" as const,
  },
  severityByFingerprint: {
    "canada-us-trade-talks-paused-50pct-reciprocal-tariffs": "HIGH" as const,
    "iran-military-geopolitical-risk-statement": "MEDIUM" as const,
  },
};

describe("news clustering", () => {
  it("clusters the Canada propagation chain once and keeps Iran separate", () => {
    const clusters = clusterNewsObservations(fixture, policy);
    expect(clusters).toHaveLength(2);
    const canada = clusters.find(({ eventType }) => eventType === "MACRO");
    const iran = clusters.find(({ eventType }) => eventType === "GEOPOLITICS");
    expect(canada?.observationIds).toHaveLength(7);
    expect(canada?.factConfidence).toBe("VERIFIED");
    expect(canada?.attentionState).toBe("SATURATED");
    expect(canada?.independentSourceCount).toBe(4);
    expect(iran?.observationIds).toHaveLength(1);
  });

  it("lets a TechFlow relay raise attention without raising fact confidence", () => {
    const jin10 = fixture.find(
      ({ sourceId, claimFingerprint }) =>
        sourceId === "jin10" &&
        claimFingerprint.state === "KNOWN" &&
        claimFingerprint.value === "canada-us-trade-talks-paused-50pct-reciprocal-tariffs",
    );
    const techflow = fixture.find(({ sourceId }) => sourceId === "techflow");
    if (jin10 === undefined || techflow === undefined) throw new Error("Missing relay fixtures");
    const before = clusterNewsObservations([jin10], policy)[0];
    const after = clusterNewsObservations([jin10, techflow], policy)[0];
    expect(before?.factConfidence).toBe("UNKNOWN");
    expect(after?.factConfidence).toBe("UNKNOWN");
    expect(before?.attentionState).toBe("QUIET");
    expect(after?.attentionState).toBe("WATCH");
  });

  it("uses only observations received by the replay clock", async () => {
    const adapter = new FixtureNewsSourceAdapter(
      {
        sourceId: "fixture-all",
        tier: "T1",
        liveCapability: "PLANNED",
        failureSemantics: "fixture only",
      },
      fixture,
    );
    const beforeTechFlow = await adapter.readReceivedThrough(timestamp("2026-08-22T04:02:18.999Z"));
    expect(beforeTechFlow.some(({ sourceId }) => sourceId === "techflow")).toBe(false);
    expect(adapter.capability().liveCapability).toBe("PLANNED");
  });

  it("arms only fresh, corroborated high-severity clusters", () => {
    const canada = clusterNewsObservations(fixture, policy).find(
      ({ eventType }) => eventType === "MACRO",
    );
    if (canada === undefined) throw new Error("Missing Canada cluster");
    expect(newsArmState(canada, timestamp("2026-08-22T05:00:00.000Z"))).toBe("NEWS_ARMED");
    expect(newsArmState(canada, timestamp("2026-08-22T06:00:00.001Z"))).toBe("NO_NEWS");
  });
});
