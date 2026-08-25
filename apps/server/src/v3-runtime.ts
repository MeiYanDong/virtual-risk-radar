import { resolve } from "node:path";
import type { ActiveSystemConfig } from "@virtual/config";
import {
  V3DecisionEngine,
  evaluateNewsAuditJudgment,
  type V3DecisionResult,
} from "@virtual/decision";
import {
  V3DashboardStateSchema,
  timestamp,
  type Timestamp,
  type V3DashboardState,
  type V3MarketTick,
  type V3NewsAuditRecord,
  type V3NewsAuditJudgment,
  type V3NewsItem,
  type V3TimelineEvent,
} from "@virtual/domain";
import { BinanceSpotAdapter, V3MarketWindow } from "@virtual/market";
import {
  FileTechFlowCursorStore,
  TechFlowPublicAdapter,
  type TechFlowSoakMetrics,
} from "@virtual/news";
import type { BinanceSoakMetrics } from "@virtual/market";
import { NewsAuditJournal, V3ShadowJournal, type V3ShadowJournalRecord } from "@virtual/storage";
import { createWarmupDashboardState } from "./v3-state";

export type V3RuntimeReader = {
  snapshot(): V3DashboardState;
  metrics?(): V3RuntimeMetrics;
  newsAudit?(query: V3NewsAuditQuery): Promise<V3NewsAuditPage>;
  newsAuditDetails?(sourceItemId: string): Promise<readonly V3NewsAuditRecord[]>;
};

export type V3NewsAuditQuery = {
  outcome?: V3NewsAuditJudgment["outcome"];
  query?: string;
  cursor?: string;
  limit: number;
};

export type V3NewsAuditListItem = {
  record: V3NewsAuditRecord;
  revisionCount: number;
};

export type V3NewsAuditPage = {
  items: V3NewsAuditListItem[];
  total: number;
  filteredTotal: number;
  counts: Record<V3NewsAuditJudgment["outcome"], number>;
  nextCursor: string | null;
};

export type V3RuntimeMetrics = {
  asOf: Timestamp;
  startedAt: Timestamp | null;
  elapsedMs: number;
  requiredSoakMs: 3_600_000;
  soakProgress: number;
  soakStatus: "NOT_STARTED" | "IN_PROGRESS" | "ELAPSED_NOT_YET_REVIEWED";
  techflow: TechFlowSoakMetrics;
  binance: BinanceSoakMetrics;
};

export type V3RuntimeOptions = {
  now?: () => Date;
  techFlowFetch?: typeof fetch;
  binanceSocketFactory?: ConstructorParameters<typeof BinanceSpotAdapter>[0]["socketFactory"];
  cursorPath?: string;
  journalPath?: string;
  newsAuditPath?: string;
};

export class V3Runtime implements V3RuntimeReader {
  readonly #config: ActiveSystemConfig;
  readonly #now: () => Date;
  readonly #newsAdapter: TechFlowPublicAdapter;
  readonly #marketAdapter: BinanceSpotAdapter;
  readonly #marketWindow: V3MarketWindow;
  readonly #decisionEngine: V3DecisionEngine;
  readonly #journal: V3ShadowJournal;
  readonly #newsAuditJournal: NewsAuditJournal;
  readonly #news = new Map<string, V3NewsItem>();
  readonly #timeline: V3TimelineEvent[] = [];
  #state: V3DashboardState;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;
  #previousSellStage: string | null = null;
  #previousRebuyStage: string | null = null;
  #lastJournalSnapshotAt: Timestamp | null = null;
  #journalErrorRecorded = false;
  #newsAuditErrorRecorded = false;
  #startedAt: Timestamp | null = null;

  constructor(config: ActiveSystemConfig, options: V3RuntimeOptions = {}) {
    this.#config = config;
    this.#now = options.now ?? (() => new Date());
    const now = timestamp(this.#now());
    this.#state = createWarmupDashboardState(config, now);
    this.#marketWindow = new V3MarketWindow({
      rollingWindowSeconds: config.marketSource.rollingWindowSeconds,
      freshnessMs: config.marketSource.freshnessMs,
    });
    this.#decisionEngine = new V3DecisionEngine(config);
    this.#journal = new V3ShadowJournal(
      options.journalPath ?? resolve(process.cwd(), config.retention.journalPath),
    );
    this.#newsAuditJournal = new NewsAuditJournal(
      options.newsAuditPath ?? resolve(process.cwd(), config.retention.newsAuditPath),
      { retentionDays: config.retention.rawDays, now: this.#now },
    );
    this.#newsAdapter = new TechFlowPublicAdapter({
      url: config.newsSource.url,
      pollIntervalMs: config.newsSource.pollIntervalMs,
      requestTimeoutMs: config.newsSource.requestTimeoutMs,
      freshnessMs: config.newsSource.freshnessSeconds * 1_000,
      maxItemsPerPoll: config.newsSource.maxItemsPerPoll,
      bodyExcerptCharacters: config.newsSource.bodyExcerptCharacters,
      cursorStore: new FileTechFlowCursorStore(
        options.cursorPath ?? resolve(process.cwd(), config.retention.cursorPath),
      ),
      ...(options.techFlowFetch === undefined ? {} : { fetch: options.techFlowFetch }),
      now: this.#now,
      onItems: (items) => {
        for (const item of items) this.#recordNews(item);
        this.#evaluate();
      },
    });
    this.#marketAdapter = new BinanceSpotAdapter({
      websocketBaseUrl: config.marketSource.websocketBaseUrl,
      freshnessMs: config.marketSource.freshnessMs,
      reconnectMinimumMs: config.marketSource.reconnectMinimumMs,
      reconnectMaximumMs: config.marketSource.reconnectMaximumMs,
      gapImpactMs: config.model.sell.returnWindowSeconds * 1_000,
      ...(options.binanceSocketFactory === undefined
        ? {}
        : { socketFactory: options.binanceSocketFactory }),
      now: this.#now,
      onTick: (tick, gap) => {
        this.#recordMarket(tick, gap);
      },
    });
  }

  async start(): Promise<void> {
    if (this.#running) return;
    await this.#restoreNewsAudit();
    this.#running = true;
    this.#startedAt = timestamp(this.#now());
    this.#recordTimeline({
      eventId: `system-start-${Date.parse(timestamp(this.#now()))}`,
      at: timestamp(this.#now()),
      kind: "SYSTEM",
      message: "Started v0.3 runtime with exactly TechFlow and Binance Spot",
      evidence: "CURRENT_PROCESS_RESPONSE",
    });
    this.#appendJournal("RUNTIME_START", timestamp(this.#now()), {
      modelVersion: this.#config.modelVersion,
      configVersion: this.#config.configVersion,
      mode: this.#config.mode,
      outputBasis: this.#config.outputBasis,
      activeSources: [this.#config.newsSource.sourceId, this.#config.marketSource.sourceId],
      externalInputCount: 2,
    });
    this.#newsAdapter.start();
    this.#marketAdapter.start();
    this.#timer = setInterval(() => this.#evaluate(), 1_000);
  }

  async stop(): Promise<void> {
    if (!this.#running) {
      await this.#journal.flush();
      await this.#newsAuditJournal.flush();
      return;
    }
    this.#running = false;
    this.#newsAdapter.stop();
    this.#marketAdapter.stop();
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#appendJournal("RUNTIME_STOP", timestamp(this.#now()), {
      sellStage: this.#state.sell.stage,
      rebuyStage: this.#state.rebuy.stage,
      newsMessages: this.#state.sources.techflow.messagesReceived,
      marketMessages: this.#state.sources.binance.messagesReceived,
    });
    await this.#journal.flush();
    await this.#newsAuditJournal.flush();
  }

  async flushJournal(): Promise<void> {
    await this.#journal.flush();
    await this.#newsAuditJournal.flush();
  }

  async newsAudit(query: V3NewsAuditQuery): Promise<V3NewsAuditPage> {
    const records = [...(await this.#newsAuditJournal.list())];
    const grouped = new Map<string, V3NewsAuditRecord[]>();
    for (const record of records) {
      const revisions = grouped.get(record.item.sourceItemId) ?? [];
      revisions.push(record);
      grouped.set(record.item.sourceItemId, revisions);
    }
    const latest = [...grouped.values()]
      .map((revisions) => {
        const ordered = [...revisions].sort(
          (left, right) =>
            right.item.revision - left.item.revision ||
            Date.parse(right.judgment.judgedAt) - Date.parse(left.judgment.judgedAt),
        );
        const record = ordered[0];
        if (record === undefined) throw new Error("News audit group is unexpectedly empty");
        const firstReceivedAt = revisions.reduce(
          (earliest, candidate) =>
            Date.parse(candidate.item.receivedAt) < Date.parse(earliest)
              ? candidate.item.receivedAt
              : earliest,
          record.item.receivedAt,
        );
        return { record, revisionCount: revisions.length, firstReceivedAt };
      })
      .sort(
        (left, right) =>
          Date.parse(right.firstReceivedAt) - Date.parse(left.firstReceivedAt) ||
          right.record.item.sourceItemId.localeCompare(left.record.item.sourceItemId, "en", {
            numeric: true,
          }),
      );
    const counts: V3NewsAuditPage["counts"] = {
      ENTERED_RISK_OBSERVATION: 0,
      NOT_TRIGGERED: 0,
      REVIEW_REQUIRED: 0,
    };
    for (const { record } of latest) counts[record.judgment.outcome] += 1;
    const normalizedQuery = query.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
    const filtered = latest.filter(({ record }) => {
      if (query.outcome !== undefined && record.judgment.outcome !== query.outcome) return false;
      if (normalizedQuery.length === 0) return true;
      return [
        record.item.headline,
        record.item.bodyExcerpt,
        record.item.sourceAttribution ?? "",
        record.judgment.summary,
      ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    });
    const cursorIndex =
      query.cursor === undefined
        ? -1
        : filtered.findIndex(({ record }) => record.recordId === query.cursor);
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageItems = filtered.slice(start, start + query.limit);
    const hasMore = start + pageItems.length < filtered.length;
    return {
      items: pageItems.map(({ record, revisionCount }) =>
        structuredClone({ record, revisionCount }),
      ),
      total: latest.length,
      filteredTotal: filtered.length,
      counts,
      nextCursor: hasMore ? (pageItems.at(-1)?.record.recordId ?? null) : null,
    };
  }

  async newsAuditDetails(sourceItemId: string): Promise<readonly V3NewsAuditRecord[]> {
    return (await this.#newsAuditJournal.list())
      .filter((record) => record.item.sourceItemId === sourceItemId)
      .sort(
        (left, right) =>
          right.item.revision - left.item.revision ||
          Date.parse(right.judgment.judgedAt) - Date.parse(left.judgment.judgedAt),
      )
      .map((record) => structuredClone(record));
  }

  snapshot(): V3DashboardState {
    if (this.#running) this.#evaluate();
    return structuredClone(this.#state);
  }

  metrics(): V3RuntimeMetrics {
    const asOf = timestamp(this.#now());
    const elapsedMs =
      this.#startedAt === null ? 0 : Math.max(0, Date.parse(asOf) - Date.parse(this.#startedAt));
    return {
      asOf,
      startedAt: this.#startedAt,
      elapsedMs,
      requiredSoakMs: 3_600_000,
      soakProgress: Math.min(1, elapsedMs / 3_600_000),
      soakStatus:
        this.#startedAt === null
          ? "NOT_STARTED"
          : elapsedMs < 3_600_000
            ? "IN_PROGRESS"
            : "ELAPSED_NOT_YET_REVIEWED",
      techflow: this.#newsAdapter.metrics(),
      binance: this.#marketAdapter.metrics(),
    };
  }

  newsAdapter(): TechFlowPublicAdapter {
    return this.#newsAdapter;
  }

  marketAdapter(): BinanceSpotAdapter {
    return this.#marketAdapter;
  }

  #recordNews(item: V3NewsItem): void {
    const previous = this.#news.get(item.sourceItemId);
    if (previous !== undefined && previous.revision > item.revision) return;
    this.#news.set(item.sourceItemId, structuredClone(item));
    const judgment = evaluateNewsAuditJudgment({
      item,
      now: item.receivedAt,
      armWindowSeconds: this.#config.newsSource.macroArmWindowSeconds,
      modelVersion: this.#config.modelVersion,
      configVersion: this.#config.configVersion,
    });
    void this.#newsAuditJournal.append({ item, judgment }).catch((error: unknown) => {
      if (this.#newsAuditErrorRecorded) return;
      this.#newsAuditErrorRecorded = true;
      this.#recordTimeline({
        eventId: `news-audit-error-${Date.parse(item.receivedAt)}`,
        at: item.receivedAt,
        kind: "SYSTEM",
        message: "News audit persistence failed; the audit page may be incomplete",
        evidence: error instanceof Error ? error.message : "NEWS_AUDIT_WRITE_ERROR",
      });
    });
    this.#appendJournal("NEWS_OBSERVED", item.receivedAt, {
      observationId: item.observationId,
      sourceItemId: item.sourceItemId,
      revision: item.revision,
      eventType: item.eventType,
      direction: item.direction,
      severity: item.severity,
      rawTextHash: item.rawTextHash,
    });
    this.#recordTimeline({
      eventId: item.observationId,
      at: item.receivedAt,
      kind: "NEWS",
      message: `${item.eventType} / ${item.direction} / ${item.severity} · ${item.headline}`,
      evidence: item.rawTextHash,
    });
  }

  async #restoreNewsAudit(): Promise<void> {
    const records = await this.#newsAuditJournal.list();
    for (const { item } of records) {
      const previous = this.#news.get(item.sourceItemId);
      if (previous === undefined || item.revision >= previous.revision) {
        this.#news.set(item.sourceItemId, structuredClone(item));
      }
    }
  }

  #recordMarket(tick: V3MarketTick, gap: string | null): void {
    this.#marketWindow.add(tick);
    if (gap !== null) {
      this.#appendJournal("MARKET_GAP", tick.receivedAt, {
        gap,
        symbol: tick.symbol,
        evidenceId: tick.observationId,
      });
      this.#recordTimeline({
        eventId: `gap-${gap}-${Date.parse(tick.receivedAt)}`,
        at: tick.receivedAt,
        kind: "GAP",
        message: `Unfilled Binance coverage gap: ${gap}`,
        evidence: tick.observationId,
      });
    }
  }

  #evaluate(): void {
    const now = timestamp(this.#now());
    const newsHealth = this.#newsAdapter.health();
    const marketHealth = this.#marketAdapter.health();
    const market = this.#marketWindow.snapshot(now, this.#marketAdapter.processor.gaps(now));
    const newsItems = [...this.#news.values()].sort(
      (left, right) => Date.parse(left.receivedAt) - Date.parse(right.receivedAt),
    );
    const decision = this.#decisionEngine.evaluate({
      now,
      newsItems,
      newsHealth,
      marketHealth,
      market,
    });
    this.#recordDecisionChanges(decision, now);
    const latestMacroEvent =
      [...newsItems]
        .filter(({ macroRelevant }) => macroRelevant)
        .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))[0] ??
      null;
    const bothCurrent =
      newsHealth.capabilityState === "VERIFIED_CURRENT" &&
      marketHealth.capabilityState === "VERIFIED_CURRENT";
    this.#state = V3DashboardStateSchema.parse({
      schemaVersion: "3.0.0",
      mode: this.#config.mode,
      asOf: now,
      evidenceLevel: bothCurrent ? "VERIFIED_CURRENT" : "TESTED",
      economicEvidence: this.#config.economicEvidence,
      outputBasis: this.#config.outputBasis,
      source: "LIVE_TWO_SOURCE_RUNTIME",
      boundaryNotice: "仅 CEX 参考；请在 DEX 钱包检查即时 quote，本系统未连接钱包或链。",
      sources: { techflow: newsHealth, binance: marketHealth },
      latestMacroEvent,
      market: this.#config.marketSource.assets.map((asset) => {
        const value = market.assets[asset];
        return {
          asset: value.asset,
          symbol: value.symbol,
          price: value.price,
          return60s: value.return60s,
          dataAgeMs: value.dataAgeMs,
          freshness: value.freshness,
        };
      }),
      sell: decision.sell,
      rebuy: decision.rebuy,
      timeline: [...this.#timeline].reverse(),
    });
    if (
      this.#lastJournalSnapshotAt === null ||
      Date.parse(now) - Date.parse(this.#lastJournalSnapshotAt) >= 10_000
    ) {
      this.#lastJournalSnapshotAt = now;
      this.#appendJournal("SOURCE_SNAPSHOT", now, {
        techflow: newsHealth,
        binance: marketHealth,
        marketFreshness: Object.fromEntries(
          this.#state.market.map(({ symbol, freshness, dataAgeMs }) => [
            symbol,
            { freshness, dataAgeMs },
          ]),
        ),
        sellStage: decision.sell.stage,
        rebuyStage: decision.rebuy.stage,
        soak: this.metrics(),
      });
    }
  }

  #recordDecisionChanges(decision: V3DecisionResult, now: Timestamp): void {
    if (decision.sell.stage !== this.#previousSellStage) {
      this.#recordTimeline({
        eventId: `sell-${decision.sell.stage}-${Date.parse(now)}`,
        at: now,
        kind: "SELL",
        message: `Sell stage → ${decision.sell.stage}; ${decision.sell.passed}/4`,
        evidence: decision.sell.evidenceIds[0] ?? "CURRENT_DECISION_SNAPSHOT",
      });
      this.#appendJournal("SELL_STAGE_CHANGED", now, {
        from: this.#previousSellStage,
        to: decision.sell.stage,
        passed: decision.sell.passed,
        required: decision.sell.required,
        nextGap: decision.sell.nextGap,
        evidenceIds: decision.sell.evidenceIds,
      });
      this.#previousSellStage = decision.sell.stage;
    }
    if (decision.rebuy.stage !== this.#previousRebuyStage) {
      this.#recordTimeline({
        eventId: `rebuy-${decision.rebuy.stage}-${Date.parse(now)}`,
        at: now,
        kind: "REBUY",
        message: `Rebuy stage → ${decision.rebuy.stage}; ${decision.rebuy.passed}/4`,
        evidence: decision.rebuy.evidenceIds[0] ?? "CURRENT_DECISION_SNAPSHOT",
      });
      this.#appendJournal("REBUY_STAGE_CHANGED", now, {
        from: this.#previousRebuyStage,
        to: decision.rebuy.stage,
        passed: decision.rebuy.passed,
        required: decision.rebuy.required,
        nextGap: decision.rebuy.nextGap,
        evidenceIds: decision.rebuy.evidenceIds,
      });
      this.#previousRebuyStage = decision.rebuy.stage;
    }
    if (decision.shadowSellCreated?.state === "SHADOW_REFERENCE") {
      this.#recordTimeline({
        eventId: `shadow-sell-${Date.parse(decision.shadowSellCreated.at)}`,
        at: decision.shadowSellCreated.at,
        kind: "SELL",
        message: "Created CEX_REFERENCE Shadow sell context; no wallet or trade was touched",
        evidence: decision.shadowSellCreated.evidenceIds[0] ?? "CURRENT_DECISION_SNAPSHOT",
      });
      this.#appendJournal("SHADOW_SELL_CREATED", decision.shadowSellCreated.at, {
        outputBasis: "CEX_REFERENCE",
        execution: "NONE",
        evidenceIds: decision.shadowSellCreated.evidenceIds,
      });
    }
  }

  #recordTimeline(event: V3TimelineEvent): void {
    if (this.#timeline.some(({ eventId }) => eventId === event.eventId)) return;
    this.#timeline.push(structuredClone(event));
    if (this.#timeline.length > 100) this.#timeline.shift();
  }

  #appendJournal(
    kind: V3ShadowJournalRecord["kind"],
    recordedAt: Timestamp,
    payload: Record<string, unknown>,
  ): void {
    void this.#journal.append({ kind, recordedAt, payload }).catch((error: unknown) => {
      if (this.#journalErrorRecorded) return;
      this.#journalErrorRecorded = true;
      this.#recordTimeline({
        eventId: `journal-error-${Date.parse(recordedAt)}`,
        at: recordedAt,
        kind: "SYSTEM",
        message: "Shadow journal write failed; evidence persistence is not current",
        evidence: error instanceof Error ? error.message : "V3_SHADOW_JOURNAL_ERROR",
      });
    });
  }
}
