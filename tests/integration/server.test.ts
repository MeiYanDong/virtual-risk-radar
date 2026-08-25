import { afterEach, describe, expect, it } from "vitest";
import { buildServer, loadDefaultConfig } from "../../apps/server/src/app";
import { createWarmupDashboardState } from "../../apps/server/src/v3-state";
import { timestamp } from "@virtual/domain";

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];
const NOW = new Date("2026-08-23T10:15:18.000Z");

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("v0.3 two-source read-only API", () => {
  it("returns honest warm-up, configuration, and capability boundaries", async () => {
    const server = await buildServer({ now: () => NOW });
    servers.push(server);
    const [health, config, capabilities, state] = await Promise.all([
      server.inject({ method: "GET", url: "/api/health" }),
      server.inject({ method: "GET", url: "/api/config" }),
      server.inject({ method: "GET", url: "/api/capabilities" }),
      server.inject({ method: "GET", url: "/api/state" }),
    ]);

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      externalInputCount: 2,
      activeSources: ["techflow-public-newsletter", "binance-spot-public"],
      economicEvidence: "POSITIVE_EV_NOT_PROVEN",
      outputBasis: "CEX_REFERENCE",
      writeCapabilities: "UNSUPPORTED",
      rpc: "UNSUPPORTED",
      dexQuote: "UNSUPPORTED",
      walletRead: "UNSUPPORTED",
    });
    expect(config.json()).toMatchObject({
      externalInputCount: 2,
      activeSources: ["techflow-public-newsletter", "binance-spot-public"],
      prohibitedCapabilities: ["RPC", "DEX_QUOTE", "WALLET_READ", "SIGN", "BROADCAST"],
    });
    expect(capabilities.json().claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "transport", level: "TESTED" }),
        expect.objectContaining({ capability: "quote", level: "UNSUPPORTED" }),
        expect.objectContaining({ capability: "sign", level: "UNSUPPORTED" }),
        expect.objectContaining({ capability: "broadcast", level: "UNSUPPORTED" }),
      ]),
    );
    expect(state.json()).toMatchObject({
      schemaVersion: "3.0.0",
      source: "WARMUP_FIXTURE",
      economicEvidence: "POSITIVE_EV_NOT_PROVEN",
      sell: { stage: "DATA_UNAVAILABLE", passed: 0, required: 4 },
      rebuy: { stage: "DATA_UNAVAILABLE", passed: 0, required: 4 },
    });
  });

  it("serves only the minimal source, market, decision, condition, health, and evidence reads", async () => {
    const server = await buildServer({ now: () => NOW });
    servers.push(server);
    const urls = [
      "/api/status",
      "/api/sources",
      "/api/news/latest",
      "/api/news/audit",
      "/api/market/current",
      "/api/decision/current",
      "/api/conditions/current?model=SELL",
      "/api/conditions/current?model=REBUY",
      "/api/events/timeline",
      "/api/data-health",
      "/api/soak/current",
      "/api/models/versions",
    ];
    for (const url of urls) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.json(), url).toMatchObject({
        schemaVersion: "3.0.0",
        generatedAt: NOW.toISOString(),
        evidenceRefs: expect.any(Array),
      });
    }
    const sources = await server.inject({ method: "GET", url: "/api/sources" });
    expect(sources.json()).toMatchObject({
      activeSourceCount: 2,
      sources: [
        expect.objectContaining({ sourceId: "techflow-public-newsletter" }),
        expect.objectContaining({ sourceId: "binance-spot-public" }),
      ],
    });
    const news = await server.inject({ method: "GET", url: "/api/news/latest" });
    expect(news.json()).not.toHaveProperty("body");
    expect(news.json()).not.toHaveProperty("bodyExcerpt");
    expect(news.json().limitation).toContain("does not redistribute");
    const soak = await server.inject({ method: "GET", url: "/api/soak/current" });
    expect(soak.json()).toMatchObject({
      status: "NOT_STARTED",
      metrics: null,
      acceptance: expect.stringContaining("Elapsed time alone does not pass"),
    });
  });

  it("rejects removed chain semantics and never registers quote or wallet routes", async () => {
    const server = await buildServer({ now: () => NOW });
    servers.push(server);
    const badModel = await server.inject({
      method: "GET",
      url: "/api/conditions/current?model=BUY",
    });
    expect(badModel.statusCode).toBe(400);
    const removedChain = await server.inject({
      method: "GET",
      url: "/api/conditions/current?model=SELL&chain=base",
    });
    expect(removedChain.statusCode).toBe(400);
    expect(removedChain.json().error).toContain("outside v0.3");
    expect((await server.inject({ method: "GET", url: "/api/quotes/current" })).statusCode).toBe(
      404,
    );
    expect((await server.inject({ method: "GET", url: "/api/wallets/read-only" })).statusCode).toBe(
      404,
    );
  });

  it("reads an injected current runtime snapshot without inventing a deployment receipt", async () => {
    const config = await loadDefaultConfig();
    const state = createWarmupDashboardState(config, timestamp(NOW));
    state.source = "LIVE_TWO_SOURCE_RUNTIME";
    state.sell.stage = "NEWS_ARMED";
    state.sell.output = "WATCH";
    state.sell.passed = 1;
    const macroCondition = state.sell.conditions[0];
    if (macroCondition === undefined) throw new Error("Warm-up Sell panel must contain S1");
    macroCondition.state = "PASS";
    macroCondition.progress = 1;
    const server = await buildServer({
      now: () => NOW,
      runtime: { snapshot: () => structuredClone(state) },
    });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/api/decision/current" });
    expect(response.json()).toMatchObject({
      sell: { stage: "NEWS_ARMED", output: "WATCH", passed: 1 },
      outputBasis: "CEX_REFERENCE",
    });
    expect(response.json().boundaryNotice).toContain("DEX 钱包");
  });

  it("publishes a GET-only OpenAPI document without removed endpoints", async () => {
    const server = await buildServer({ now: () => NOW });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/api/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).not.toHaveProperty("/api/quotes/current");
    expect(document.paths).not.toHaveProperty("/api/wallets/read-only");
    expect(document.paths["/api/news/audit"].get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "outcome", in: "query" })]),
    );
    expect(document.paths["/api/news/audit/{sourceItemId}"].get.responses).toHaveProperty("404");
    expect(
      Object.values(document.paths).every(
        (path: unknown) =>
          path !== null && typeof path === "object" && Object.keys(path).join(",") === "get",
      ),
    ).toBe(true);
  });

  it("does not register write HTTP routes", async () => {
    const server = await buildServer({ now: () => NOW });
    servers.push(server);
    const routes = server.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/\b(?:POST|PUT|PATCH|DELETE)\b/);
    expect(routes).not.toMatch(/\/(?:sign|broadcast|approve-token|execute-trade)\b/);
  });
});
