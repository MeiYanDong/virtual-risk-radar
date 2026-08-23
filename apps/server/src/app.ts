import { readFile } from "node:fs/promises";
import cors from "@fastify/cors";
import {
  createActiveConfigReadback,
  createReadOnlyCapabilityBaseline,
  hashActiveConfig,
  parseActiveSystemConfig,
  type ActiveSystemConfig,
} from "@virtual/config";
import { timestamp, type V3DashboardState } from "@virtual/domain";
import Fastify, { type FastifyInstance } from "fastify";
import { createWarmupDashboardState } from "./v3-state";
import type { V3RuntimeReader } from "./v3-runtime";

const SCHEMA_VERSION = "3.0.0";

export type BuildServerOptions = {
  runtime?: V3RuntimeReader;
  now?: () => Date;
};

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

export async function loadDefaultConfig(): Promise<Readonly<ActiveSystemConfig>> {
  return parseActiveSystemConfig(
    await readJson(new URL("../../../config/default.json", import.meta.url)),
  );
}

function metadata(evidenceRefs: string[], now: () => Date) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now().toISOString(),
    evidenceRefs,
  };
}

function openApiDocument(): Record<string, unknown> {
  const paths = [
    "/api/health",
    "/api/status",
    "/api/config",
    "/api/capabilities",
    "/api/state",
    "/api/sources",
    "/api/news/latest",
    "/api/market/current",
    "/api/decision/current",
    "/api/conditions/current",
    "/api/events/timeline",
    "/api/data-health",
    "/api/soak/current",
    "/api/models/versions",
    "/api/openapi.json",
  ];
  return {
    openapi: "3.1.0",
    info: { title: "VIRTUAL Two-source Read-only Decision API", version: SCHEMA_VERSION },
    paths: Object.fromEntries(
      paths.map((path) => [
        path,
        {
          get: {
            operationId: path.replaceAll(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, ""),
            responses: { "200": { description: "Read-only evidence response" } },
          },
        },
      ]),
    ),
  };
}

function publicNewsMetadata(state: V3DashboardState) {
  const item = state.latestMacroEvent;
  if (item === null) return null;
  return {
    observationId: item.observationId,
    sourceItemId: item.sourceItemId,
    sourceUrl: item.sourceUrl,
    originalUrl: item.originalUrl,
    headline: item.headline,
    sourceAttribution: item.sourceAttribution,
    categories: item.categories,
    sourceOccurredAt: item.sourceOccurredAt,
    receivedAt: item.receivedAt,
    revision: item.revision,
    eventType: item.eventType,
    entities: item.entities,
    countries: item.countries,
    direction: item.direction,
    severity: item.severity,
    scheduledState: item.scheduledState,
    rawTextHash: item.rawTextHash,
  };
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = await loadDefaultConfig();
  const now = options.now ?? (() => new Date());
  const warmup = createWarmupDashboardState(config, timestamp(now()));
  const snapshot = (): V3DashboardState => options.runtime?.snapshot() ?? warmup;
  const server = Fastify({ logger: false });

  await server.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/],
    methods: ["GET"],
  });

  server.get("/api/health", async () => {
    const state = snapshot();
    return {
      ...metadata(["CURRENT_PROCESS_RESPONSE"], now),
      status: "ok",
      service: "virtual-two-source-risk-decision",
      runtimeEvidence: "CURRENT_PROCESS_RESPONSE",
      mode: state.mode,
      economicEvidence: state.economicEvidence,
      outputBasis: state.outputBasis,
      externalInputCount: 2,
      activeSources: [state.sources.techflow.sourceId, state.sources.binance.sourceId],
      sourceStatus: {
        techflow: state.sources.techflow.status,
        binance: state.sources.binance.status,
      },
      writeCapabilities: "UNSUPPORTED",
      rpc: "UNSUPPORTED",
      dexQuote: "UNSUPPORTED",
      walletRead: "UNSUPPORTED",
    };
  });

  server.get("/api/status", async () => {
    const state = snapshot();
    return {
      ...metadata(["CURRENT_PROCESS_RESPONSE"], now),
      mode: state.mode,
      source: state.source,
      evidenceLevel: state.evidenceLevel,
      economicEvidence: state.economicEvidence,
      outputBasis: state.outputBasis,
      sellStage: state.sell.stage,
      rebuyStage: state.rebuy.stage,
      sources: state.sources,
      boundaryNotice: state.boundaryNotice,
    };
  });

  server.get("/api/config", async () => ({
    ...metadata(["config/default.json"], now),
    ...createActiveConfigReadback(config),
  }));

  server.get("/api/capabilities", async () => ({
    ...metadata(["config/source-registry.json"], now),
    ...createReadOnlyCapabilityBaseline(),
  }));

  server.get("/api/state", async () => snapshot());

  server.get("/api/sources", async () => {
    const state = snapshot();
    return {
      ...metadata(["config/source-registry.json", "CURRENT_PROCESS_RESPONSE"], now),
      activeSourceCount: 2,
      sources: [state.sources.techflow, state.sources.binance],
      prohibitedFallbacks: [
        "RPC",
        "DEX_QUOTE",
        "WALLET_READ",
        "DERIVATIVES",
        "SECOND_EXCHANGE",
        "SECOND_NEWS_SOURCE",
        "PAID_SOURCE",
      ],
    };
  });

  server.get("/api/news/latest", async () => {
    const state = snapshot();
    return {
      ...metadata(
        state.latestMacroEvent === null ? [] : [state.latestMacroEvent.observationId],
        now,
      ),
      source: state.sources.techflow,
      item: publicNewsMetadata(state),
      limitation:
        "Internal decision metadata only; this endpoint does not redistribute TechFlow article bodies",
    };
  });

  server.get("/api/market/current", async () => {
    const state = snapshot();
    return {
      ...metadata(state.sell.evidenceIds, now),
      source: state.sources.binance,
      basis: "BINANCE_SPOT_CEX_REFERENCE",
      assets: state.market,
    };
  });

  server.get("/api/decision/current", async () => {
    const state = snapshot();
    return {
      ...metadata([...state.sell.evidenceIds, ...state.rebuy.evidenceIds], now),
      sell: state.sell,
      rebuy: state.rebuy,
      economicEvidence: state.economicEvidence,
      outputBasis: state.outputBasis,
      boundaryNotice: state.boundaryNotice,
    };
  });

  server.get("/api/conditions/current", async (request, reply) => {
    const query = request.query as { model?: string; chain?: string };
    if (query.chain !== undefined) {
      return reply.code(400).send({
        ...metadata([], now),
        error: "chain is outside v0.3; conditions are CEX_REFERENCE only",
      });
    }
    if (query.model !== "SELL" && query.model !== "REBUY") {
      return reply.code(400).send({
        ...metadata([], now),
        error: "model must be SELL or REBUY",
      });
    }
    const state = snapshot();
    const decision = query.model === "SELL" ? state.sell : state.rebuy;
    return {
      ...metadata(decision.evidenceIds, now),
      model: query.model,
      stage: decision.stage,
      conditions: decision.conditions,
      outputBasis: decision.outputBasis,
    };
  });

  server.get("/api/events/timeline", async () => {
    const state = snapshot();
    return {
      ...metadata(
        state.timeline.map(({ eventId }) => eventId),
        now,
      ),
      events: state.timeline,
    };
  });

  server.get("/api/data-health", async () => {
    const state = snapshot();
    return {
      ...metadata(["CURRENT_PROCESS_RESPONSE"], now),
      sources: state.sources,
      marketFreshness: Object.fromEntries(
        state.market.map(({ symbol, freshness, dataAgeMs }) => [symbol, { freshness, dataAgeMs }]),
      ),
      failVisible: true,
    };
  });

  server.get("/api/soak/current", async () => {
    const metrics = options.runtime?.metrics?.();
    return {
      ...metadata(["CURRENT_PROCESS_RESPONSE", config.retention.journalPath], now),
      status: metrics?.soakStatus ?? "NOT_STARTED",
      metrics: metrics ?? null,
      acceptance:
        "Elapsed time alone does not pass the soak; success, freshness, gaps, reconnects, and latency must be reviewed",
    };
  });

  server.get("/api/models/versions", async () => ({
    ...metadata(["config/default.json"], now),
    modelVersion: config.modelVersion,
    configVersion: config.configVersion,
    configHash: hashActiveConfig(config),
    formulaVersion: "v3-four-condition-deterministic-v1",
    schemaVersion: SCHEMA_VERSION,
    extremeMarketBreakdown: config.model.sell.extremeMarketBreakdown,
  }));

  server.get("/api/openapi.json", async () => openApiDocument());

  return server;
}

export type { V3DashboardState };
