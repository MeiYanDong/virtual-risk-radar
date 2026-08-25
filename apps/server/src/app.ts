import { readFile } from "node:fs/promises";
import cors from "@fastify/cors";
import {
  createActiveConfigReadback,
  createReadOnlyCapabilityBaseline,
  hashActiveConfig,
  parseActiveSystemConfig,
  type ActiveSystemConfig,
} from "@virtual/config";
import { timestamp, type V3DashboardState, type V3NewsAuditJudgment } from "@virtual/domain";
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
    "/api/news/audit",
    "/api/news/audit/{sourceItemId}",
    "/api/market/current",
    "/api/decision/current",
    "/api/conditions/current",
    "/api/events/timeline",
    "/api/data-health",
    "/api/soak/current",
    "/api/models/versions",
    "/api/openapi.json",
  ];
  const documentPaths: Record<string, unknown> = Object.fromEntries(
    paths.map((path) => [
      path,
      {
        get: {
          operationId: path.replaceAll(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, ""),
          responses: { "200": { description: "Read-only evidence response" } },
        },
      },
    ]),
  );
  documentPaths["/api/news/audit"] = {
    get: {
      operationId: "api_news_audit",
      summary: "List every TechFlow item observed since audit capture was enabled",
      parameters: [
        {
          name: "outcome",
          in: "query",
          schema: {
            type: "string",
            enum: ["ENTERED_RISK_OBSERVATION", "NOT_TRIGGERED", "REVIEW_REQUIRED"],
          },
        },
        { name: "query", in: "query", schema: { type: "string", maxLength: 200 } },
        { name: "cursor", in: "query", schema: { type: "string" } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        "200": { description: "Paginated local news audit metadata and source health" },
        "400": { description: "Invalid filter or pagination input" },
      },
    },
  };
  documentPaths["/api/news/audit/{sourceItemId}"] = {
    get: {
      operationId: "api_news_audit_source_item",
      summary: "Read all immutable revisions captured for one TechFlow item",
      parameters: [
        {
          name: "sourceItemId",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[0-9]+$" },
        },
      ],
      responses: {
        "200": { description: "Captured revisions and their original judgments" },
        "400": { description: "Invalid TechFlow item ID" },
        "404": { description: "No captured item has this ID" },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: { title: "VIRTUAL Two-source Read-only Decision API", version: SCHEMA_VERSION },
    paths: documentPaths,
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

  server.get("/api/news/audit", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const allowedOutcomes = new Set<V3NewsAuditJudgment["outcome"]>([
      "ENTERED_RISK_OBSERVATION",
      "NOT_TRIGGERED",
      "REVIEW_REQUIRED",
    ]);
    const outcome = query["outcome"];
    if (outcome !== undefined && !allowedOutcomes.has(outcome as V3NewsAuditJudgment["outcome"])) {
      return reply.code(400).send({ error: "Unsupported news audit outcome" });
    }
    const parsedLimit = query["limit"] === undefined ? 50 : Number(query["limit"]);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return reply.code(400).send({ error: "News audit limit must be between 1 and 100" });
    }
    if (query["query"] !== undefined && query["query"].length > 200) {
      return reply.code(400).send({ error: "News audit query must be 200 characters or fewer" });
    }
    if (
      query["cursor"] !== undefined &&
      !/^news-audit-[0-9]+-r\d+-[0-9a-f]{12}$/.test(query["cursor"])
    ) {
      return reply.code(400).send({ error: "Invalid news audit cursor" });
    }
    const result = options.runtime?.newsAudit
      ? await options.runtime.newsAudit({
          ...(outcome === undefined ? {} : { outcome: outcome as V3NewsAuditJudgment["outcome"] }),
          ...(query["query"] === undefined ? {} : { query: query["query"] }),
          ...(query["cursor"] === undefined ? {} : { cursor: query["cursor"] }),
          limit: parsedLimit,
        })
      : {
          items: [],
          total: 0,
          filteredTotal: 0,
          counts: {
            ENTERED_RISK_OBSERVATION: 0,
            NOT_TRIGGERED: 0,
            REVIEW_REQUIRED: 0,
          },
          nextCursor: null,
        };
    const state = snapshot();
    return {
      ...metadata(
        result.items.map(({ record }) => record.recordId),
        now,
      ),
      source: state.sources.techflow,
      metrics: options.runtime?.metrics?.().techflow ?? null,
      historyBoundary:
        "Complete normalized audit history starts when v0.3.2 capture is enabled; earlier shadow metadata cannot reconstruct missing headlines or judgments",
      contentBoundary:
        "Local audit metadata and excerpts only; complete TechFlow article bodies are not stored or redistributed",
      ...result,
    };
  });

  server.get<{ Params: { sourceItemId: string } }>(
    "/api/news/audit/:sourceItemId",
    async (request, reply) => {
      if (!/^\d+$/.test(request.params.sourceItemId)) {
        return reply.code(400).send({ error: "TechFlow source item ID must be numeric" });
      }
      const revisions = options.runtime?.newsAuditDetails
        ? await options.runtime.newsAuditDetails(request.params.sourceItemId)
        : [];
      if (revisions.length === 0) {
        return reply.code(404).send({ error: "News audit item not found" });
      }
      return {
        ...metadata(
          revisions.map(({ recordId }) => recordId),
          now,
        ),
        sourceItemId: request.params.sourceItemId,
        revisions,
        contentBoundary:
          "Local audit metadata and excerpts only; complete TechFlow article bodies are not stored or redistributed",
      };
    },
  );

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
