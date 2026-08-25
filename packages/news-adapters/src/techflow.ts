import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  HashSchema,
  V3NewsItemSchema,
  V3SourceHealthSchema,
  timestamp,
  type Hash,
  type Timestamp,
  type V3MacroEventType,
  type V3NewsItem,
  type V3SourceHealth,
} from "@virtual/domain";
import { z } from "zod";

const SOURCE_ID = "techflow-public-newsletter" as const;
const SOURCE_URL = "https://www.techflowpost.com/newsletter";

const RawTechFlowItemSchema = z
  .object({
    id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
    title: z.string().min(1),
    abstract: z.string().default(""),
    source: z.string().nullable().default(""),
    url: z.string().nullable().default(""),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }).nullable().default(null),
    category: z
      .object({ id: z.number().int(), name: z.string().min(1) })
      .nullable()
      .default(null),
    content_categories: z.array(z.string()).default([]),
    is_starting: z.boolean().optional(),
  })
  .passthrough();

export type RawTechFlowItem = z.infer<typeof RawTechFlowItemSchema>;

export type TechFlowCursor = {
  schemaVersion: "1.0.0";
  lastSeenId: string | null;
  hashesById: Record<string, Hash>;
  revisionsById: Record<string, number>;
  etag: string | null;
  lastModified: string | null;
  savedAt: Timestamp;
};

export type TechFlowCursorStore = {
  load(): Promise<TechFlowCursor | null>;
  save(cursor: TechFlowCursor): Promise<void>;
};

export class MemoryTechFlowCursorStore implements TechFlowCursorStore {
  #cursor: TechFlowCursor | null = null;

  async load(): Promise<TechFlowCursor | null> {
    return this.#cursor === null ? null : structuredClone(this.#cursor);
  }

  async save(cursor: TechFlowCursor): Promise<void> {
    this.#cursor = structuredClone(cursor);
  }
}

export class FileTechFlowCursorStore implements TechFlowCursorStore {
  constructor(readonly path: string) {}

  async load(): Promise<TechFlowCursor | null> {
    try {
      const input = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      return TechFlowCursorSchema.parse(input);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(cursor: TechFlowCursor): Promise<void> {
    const checked = TechFlowCursorSchema.parse(cursor);
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(checked)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}

const TechFlowCursorSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    lastSeenId: z.string().regex(/^\d+$/).nullable(),
    hashesById: z.record(z.string().regex(/^\d+$/), HashSchema),
    revisionsById: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative()),
    etag: z.string().nullable(),
    lastModified: z.string().nullable(),
    savedAt: z
      .string()
      .datetime({ offset: true })
      .transform((value) => timestamp(value)),
  })
  .strict();

function sha256(input: string): Hash {
  return HashSchema.parse(`sha256:${createHash("sha256").update(input).digest("hex")}`);
}

function decodeFlightPayloads(html: string): string {
  const payloads: string[] = [];
  const pattern = /<script[^>]*>\s*self\.__next_f\.push\((\[1,[\s\S]*?\])\)\s*<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    const expression = match[1];
    if (expression === undefined) continue;
    try {
      const parsed = JSON.parse(expression) as unknown;
      if (Array.isArray(parsed) && typeof parsed[1] === "string") payloads.push(parsed[1]);
    } catch {
      // A malformed script is ignored here; the final no-items check fails visibly.
    }
  }
  return payloads.join("\n");
}

function balancedJsonObject(input: string, start: number): string | null {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) break;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  return null;
}

export function parseTechFlowListHtml(html: string): RawTechFlowItem[] {
  if (/登录后(?:查看|阅读)|请先登录|login required/i.test(html)) {
    throw new Error("TECHFLOW_LOGIN_WALL");
  }
  const decoded = decodeFlightPayloads(html);
  const starts = [...decoded.matchAll(/\{"id":(?:\d+|"\d+"),"title":/g)];
  const items = new Map<string, RawTechFlowItem>();
  for (const match of starts) {
    if (match.index === undefined) continue;
    const candidate = balancedJsonObject(decoded, match.index);
    if (candidate === null) continue;
    try {
      const item = RawTechFlowItemSchema.parse(JSON.parse(candidate));
      items.set(String(item.id), item);
    } catch {
      // Other public-page objects are ignored; a fully invalid list fails below.
    }
  }
  if (items.size === 0) throw new Error("TECHFLOW_SCHEMA_DRIFT_OR_EMPTY_LIST");
  return [...items.values()].sort((left, right) => {
    const time = Date.parse(right.created_at) - Date.parse(left.created_at);
    return time === 0 ? Number(right.id) - Number(left.id) : time;
  });
}

export function parseTechFlowDetailHtml(html: string, detailUrl: string): RawTechFlowItem {
  const id = new URL(detailUrl).pathname.match(/\/newsletter\/(\d+)$/)?.[1];
  if (id === undefined) throw new Error("TECHFLOW_DETAIL_URL_INVALID");
  const item = parseTechFlowListHtml(html).find((candidate) => String(candidate.id) === id);
  if (item === undefined) throw new Error("TECHFLOW_DETAIL_ITEM_MISSING");
  return item;
}

type Rule = { type: V3MacroEventType; pattern: RegExp };

const TYPE_RULES: readonly Rule[] = [
  {
    type: "MONETARY_MACRO",
    pattern: /央行|美联储|联储|利率|加息|降息|量化宽松|\bQE\b|通胀|非农|就业|GDP|经济衰退/i,
  },
  {
    type: "TRADE_SANCTIONS",
    pattern: /关税|贸易战|贸易谈判|制裁|出口管制|禁运|反制|进口限制/i,
  },
  {
    type: "GEOPOLITICS",
    pattern: /战争|军事|导弹|空袭|入侵|停火|政变|政府危机|边境冲突|地缘/i,
  },
  {
    type: "FINANCIAL_STABILITY",
    pattern: /银行倒闭|银行挤兑|流动性危机|信用危机|债务违约|系统性风险|交易暂停|清算机构/i,
  },
  {
    type: "ENERGY_SUPPLY",
    pattern: /原油|石油|天然气|能源供应|OPEC|供应链中断|重大灾害/i,
  },
  {
    type: "CRYPTO_POLICY",
    pattern: /加密监管|稳定币|MiCA|SEC|CFTC|FinCEN|禁令|牌照|法案|ETF/i,
  },
];

const RISK_OFF = /加征|暂停|制裁|冲突|攻击|危机|违约|倒闭|暴跌|下调|收紧|禁令|战争|恶化|风险|中断/i;
const RISK_ON = /降息|宽松|达成协议|取消关税|停火|批准|利好|复苏|增长超预期/i;
const HIGH_SEVERITY = /紧急|全面|系统性|战争|倒闭|违约|攻击|加征\s*\d+%|暂停谈判|重大/i;
const SYSTEMIC_SEVERITY = /全球金融危机|系统性崩溃|全面战争|银行体系|主权违约/i;
const SCHEDULED = /将于|计划|会议|公布|发布|截止|定于|议程|预定/i;

const ENTITY_RULES: ReadonlyArray<{ label: string; pattern: RegExp; country?: string }> = [
  { label: "美国", pattern: /美国|美联储|白宫|特朗普|FinCEN|SEC|CFTC/i, country: "US" },
  { label: "加拿大", pattern: /加拿大|卡尼/i, country: "CA" },
  { label: "欧盟", pattern: /欧盟|欧洲央行|MiCA/i, country: "EU" },
  { label: "英国", pattern: /英国|英格兰银行/i, country: "GB" },
  { label: "中国", pattern: /中国|中国人民银行/i, country: "CN" },
  { label: "日本", pattern: /日本|日本央行/i, country: "JP" },
  { label: "韩国", pattern: /韩国|韩国央行/i, country: "KR" },
  { label: "俄罗斯", pattern: /俄罗斯|克里姆林宫/i, country: "RU" },
  { label: "乌克兰", pattern: /乌克兰|基辅/i, country: "UA" },
  { label: "以色列", pattern: /以色列/i, country: "IL" },
  { label: "伊朗", pattern: /伊朗|德黑兰/i, country: "IR" },
  { label: "OPEC", pattern: /OPEC/i },
];

function attribution(item: RawTechFlowItem): string | null {
  const direct = item.source?.trim();
  if (direct !== undefined && direct.length > 0) return direct;
  const found = item.abstract.match(/据\s*([^，。]{1,48}?)(?:报道|消息|数据|监测)/)?.[1]?.trim();
  return found === undefined || found.length === 0 ? null : found;
}

export function normalizeTechFlowItem(input: {
  item: RawTechFlowItem;
  receivedAt: Timestamp;
  accessedAt: Timestamp;
  revision: number;
  bodyExcerptCharacters: number;
}): V3NewsItem {
  const { item } = input;
  const sourceItemId = String(item.id);
  const combined = `${item.title}\n${item.abstract}`;
  const matchedType = TYPE_RULES.find(({ pattern }) => pattern.test(combined));
  const eventType = matchedType?.type ?? (combined.trim().length > 0 ? "OTHER" : "UNKNOWN");
  const direction = RISK_OFF.test(combined)
    ? "RISK_OFF"
    : RISK_ON.test(combined)
      ? "RISK_ON"
      : "UNKNOWN";
  const severity = SYSTEMIC_SEVERITY.test(combined)
    ? "SYSTEMIC"
    : HIGH_SEVERITY.test(combined)
      ? "HIGH"
      : eventType === "OTHER" || eventType === "UNKNOWN"
        ? "UNKNOWN"
        : "MEDIUM";
  const entities = ENTITY_RULES.filter(({ pattern }) => pattern.test(combined)).map(
    ({ label }) => label,
  );
  const countries = ENTITY_RULES.filter(
    (rule): rule is typeof rule & { country: string } =>
      rule.country !== undefined && rule.pattern.test(combined),
  ).map(({ country }) => country);
  const rawTextHash = sha256(
    JSON.stringify({
      title: item.title,
      abstract: item.abstract,
      source: item.source,
      url: item.url,
      updatedAt: item.updated_at,
    }),
  );
  return V3NewsItemSchema.parse({
    observationId: `techflow-${sourceItemId}-r${input.revision}-${rawTextHash.slice(-12)}`,
    sourceId: SOURCE_ID,
    sourceItemId,
    sourceUrl: `${SOURCE_URL}/${sourceItemId}`,
    originalUrl: item.url === null || item.url.trim().length === 0 ? null : item.url,
    headline: item.title,
    bodyExcerpt: item.abstract.slice(0, input.bodyExcerptCharacters),
    sourceAttribution: attribution(item),
    categories: [item.category?.name, ...item.content_categories].filter(
      (value): value is string => value !== undefined && value.length > 0,
    ),
    sourceOccurredAt: timestamp(item.created_at),
    receivedAt: input.receivedAt,
    accessedAt: input.accessedAt,
    updatedAt: item.updated_at === null ? null : timestamp(item.updated_at),
    revision: input.revision,
    rawTextHash,
    eventType,
    entities: [...new Set(entities)],
    countries: [...new Set(countries)],
    direction,
    severity,
    scheduledState: SCHEDULED.test(combined) ? "SCHEDULED" : "UNKNOWN",
    macroRelevant: matchedType !== undefined,
    classificationReason:
      matchedType === undefined
        ? "No deterministic global macro rule matched"
        : `Deterministic ${matchedType.type} rule matched; country is an entity, not a routing key`,
    schemaVersion: "3.0.0",
  });
}

export type TechFlowAdapterOptions = {
  url?: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  freshnessMs: number;
  maxItemsPerPoll: number;
  bodyExcerptCharacters: number;
  cursorStore: TechFlowCursorStore;
  fetch?: typeof fetch;
  now?: () => Date;
  onItems?: (items: readonly V3NewsItem[], health: V3SourceHealth) => void;
};

export type TechFlowPollResult = {
  items: V3NewsItem[];
  health: V3SourceHealth;
  coverageGap: string | null;
  notModified: boolean;
};

export type TechFlowSoakMetrics = {
  capturedAt: Timestamp;
  sourceId: "techflow-public-newsletter";
  attempts: number;
  successes: number;
  successRate: number;
  notModified: number;
  messagesSeen: number;
  currentPageItems: number;
  uniqueItems: number;
  bootstrapItems: number;
  duplicates: number;
  duplicateRate: number;
  gaps: number;
  firstAttemptAt: Timestamp | null;
  lastAttemptAt: Timestamp | null;
  errorsByCode: Record<string, number>;
  liveItemLatencySampleSize: number;
  liveItemSourceToReceiveLatencyMs: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
  };
  dataAgeMs: number | null;
};

function metricQuantile(samples: readonly number[], percentile: number): number | null {
  if (samples.length === 0) return null;
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(percentile * ordered.length) - 1);
  return ordered[index] ?? null;
}

export class TechFlowPublicAdapter {
  readonly #options: TechFlowAdapterOptions;
  #cursor: TechFlowCursor | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #stats = {
    attempts: 0,
    successes: 0,
    notModified: 0,
    messages: 0,
    currentPageItems: 0,
    unique: 0,
    bootstrapItems: 0,
    duplicates: 0,
    gaps: 0,
  };
  readonly #errorsByCode = new Map<string, number>();
  readonly #liveItemLatenciesMs: number[] = [];
  #latencySampleCursor = 0;
  #firstAttemptAt: Timestamp | null = null;
  #lastAttemptAt: Timestamp | null = null;
  #lastEvidenceId: string | null = null;
  #lastHealth: V3SourceHealth;

  constructor(options: TechFlowAdapterOptions) {
    this.#options = options;
    this.#lastHealth = this.#health({
      status: "WARMING_UP",
      lastAttemptAt: null,
      lastSuccessAt: null,
      errorCode: null,
      reason: "No public page has been semantically parsed in this process",
    });
  }

  health(): V3SourceHealth {
    const health = structuredClone(this.#lastHealth);
    const nowMs = (this.#options.now ?? (() => new Date()))().getTime();
    if (health.lastSuccessAt !== null) {
      health.dataAgeMs = Math.max(0, nowMs - Date.parse(health.lastSuccessAt));
      if (health.dataAgeMs > this.#options.freshnessMs) {
        health.status = "STALE";
        health.errorCode = "TECHFLOW_STALE";
        health.reason = `No successful semantic refresh for ${health.dataAgeMs} ms; freshness limit is ${this.#options.freshnessMs} ms`;
      }
    }
    return V3SourceHealthSchema.parse(health);
  }

  metrics(): TechFlowSoakMetrics {
    const capturedAt = timestamp((this.#options.now ?? (() => new Date()))());
    const health = this.health();
    return {
      capturedAt,
      sourceId: SOURCE_ID,
      attempts: this.#stats.attempts,
      successes: this.#stats.successes,
      successRate: this.#stats.attempts === 0 ? 0 : this.#stats.successes / this.#stats.attempts,
      notModified: this.#stats.notModified,
      messagesSeen: this.#stats.messages,
      currentPageItems: this.#stats.currentPageItems,
      uniqueItems: this.#stats.unique,
      bootstrapItems: this.#stats.bootstrapItems,
      duplicates: this.#stats.duplicates,
      duplicateRate: this.#stats.messages === 0 ? 0 : this.#stats.duplicates / this.#stats.messages,
      gaps: this.#stats.gaps,
      firstAttemptAt: this.#firstAttemptAt,
      lastAttemptAt: this.#lastAttemptAt,
      errorsByCode: Object.fromEntries([...this.#errorsByCode.entries()].sort()),
      liveItemLatencySampleSize: this.#liveItemLatenciesMs.length,
      liveItemSourceToReceiveLatencyMs: {
        p50: metricQuantile(this.#liveItemLatenciesMs, 0.5),
        p95: metricQuantile(this.#liveItemLatenciesMs, 0.95),
        p99: metricQuantile(this.#liveItemLatenciesMs, 0.99),
        max: this.#liveItemLatenciesMs.length === 0 ? null : Math.max(...this.#liveItemLatenciesMs),
      },
      dataAgeMs: health.dataAgeMs,
    };
  }

  async pollOnce(): Promise<TechFlowPollResult> {
    if (this.#cursor === null) this.#cursor = await this.#options.cursorStore.load();
    const now = timestamp((this.#options.now ?? (() => new Date()))());
    this.#stats.attempts += 1;
    this.#firstAttemptAt ??= now;
    this.#lastAttemptAt = now;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("TECHFLOW_TIMEOUT"));
      }, this.#options.requestTimeoutMs);
    });
    try {
      const headers = new Headers({
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "VirtualRiskResearch/0.3 (local read-only public-page monitor)",
      });
      if (this.#cursor?.etag !== null && this.#cursor?.etag !== undefined) {
        headers.set("If-None-Match", this.#cursor.etag);
      }
      if (this.#cursor?.lastModified !== null && this.#cursor?.lastModified !== undefined) {
        headers.set("If-Modified-Since", this.#cursor.lastModified);
      }
      const response = await Promise.race([
        (this.#options.fetch ?? fetch)(this.#options.url ?? SOURCE_URL, {
          method: "GET",
          headers,
          redirect: "follow",
          signal: controller.signal,
        }),
        deadline,
      ]);
      if (response.status === 304) {
        this.#stats.successes += 1;
        this.#stats.notModified += 1;
        this.#lastEvidenceId = `techflow-page-304-${Date.parse(now)}`;
        this.#lastHealth = this.#health({
          status: "HEALTHY",
          lastAttemptAt: now,
          lastSuccessAt: now,
          errorCode: null,
          reason: "Public page unchanged; conditional request succeeded",
        });
        return { items: [], health: this.health(), coverageGap: null, notModified: true };
      }
      if (!response.ok) throw new Error(`TECHFLOW_HTTP_${response.status}`);
      const html = await Promise.race([response.text(), deadline]);
      this.#lastEvidenceId = `techflow-page-${Date.parse(now)}-${sha256(html).slice(-12)}`;
      const rawItems = parseTechFlowListHtml(html).slice(0, this.#options.maxItemsPerPoll);
      this.#stats.currentPageItems = rawItems.length;
      this.#stats.messages += rawItems.length;
      const previous = this.#cursor;
      const bootstrap = previous === null;
      const hashesById = { ...(previous?.hashesById ?? {}) };
      const revisionsById = { ...(previous?.revisionsById ?? {}) };
      const emitted: V3NewsItem[] = [];
      for (const item of [...rawItems].reverse()) {
        const preliminary = normalizeTechFlowItem({
          item,
          receivedAt: now,
          accessedAt: now,
          revision: 0,
          bodyExcerptCharacters: this.#options.bodyExcerptCharacters,
        });
        const priorHash = hashesById[preliminary.sourceItemId];
        if (priorHash === preliminary.rawTextHash) {
          this.#stats.duplicates += 1;
          continue;
        }
        const revision =
          priorHash === undefined ? 0 : (revisionsById[preliminary.sourceItemId] ?? 0) + 1;
        const normalized =
          revision === 0
            ? preliminary
            : normalizeTechFlowItem({
                item,
                receivedAt: now,
                accessedAt: now,
                revision,
                bodyExcerptCharacters: this.#options.bodyExcerptCharacters,
              });
        hashesById[normalized.sourceItemId] = normalized.rawTextHash;
        revisionsById[normalized.sourceItemId] = revision;
        emitted.push(normalized);
      }
      const ids = rawItems.map(({ id }) => Number(id)).filter(Number.isFinite);
      const maximumId = ids.length === 0 ? null : String(Math.max(...ids));
      const previousId = previous?.lastSeenId === null ? undefined : previous?.lastSeenId;
      const previousVisible =
        previousId === undefined || rawItems.some(({ id }) => String(id) === previousId);
      const coverageGap =
        previousId !== undefined && maximumId !== null && Number(maximumId) > Number(previousId)
          ? previousVisible
            ? null
            : `CURSOR_NOT_VISIBLE:${previousId}->${maximumId}`
          : null;
      if (coverageGap !== null) this.#stats.gaps += 1;
      this.#stats.unique += emitted.length;
      this.#stats.successes += 1;
      if (bootstrap) this.#stats.bootstrapItems += emitted.length;
      else {
        for (const item of emitted) {
          if (item.sourceOccurredAt === null) continue;
          const latency = Math.max(
            0,
            Date.parse(item.receivedAt) - Date.parse(item.sourceOccurredAt),
          );
          if (this.#liveItemLatenciesMs.length < 4_096) this.#liveItemLatenciesMs.push(latency);
          else {
            this.#liveItemLatenciesMs[this.#latencySampleCursor] = latency;
            this.#latencySampleCursor = (this.#latencySampleCursor + 1) % 4_096;
          }
        }
      }
      this.#cursor = {
        schemaVersion: "1.0.0",
        lastSeenId:
          previousId === undefined || (maximumId !== null && Number(maximumId) > Number(previousId))
            ? maximumId
            : previousId,
        hashesById: Object.fromEntries(Object.entries(hashesById).slice(-200)),
        revisionsById: Object.fromEntries(Object.entries(revisionsById).slice(-200)),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        savedAt: now,
      };
      await this.#options.cursorStore.save(this.#cursor);
      this.#lastHealth = this.#health({
        status: coverageGap === null ? "HEALTHY" : "DEGRADED",
        lastAttemptAt: now,
        lastSuccessAt: now,
        errorCode: coverageGap === null ? null : "COVERAGE_GAP",
        reason:
          coverageGap === null
            ? `Parsed ${rawItems.length} current public newsletter items`
            : `Page parsed but previous cursor is absent: ${coverageGap}`,
      });
      this.#options.onItems?.(emitted, this.#lastHealth);
      return { items: emitted, health: this.health(), coverageGap, notModified: false };
    } catch (error) {
      const reason =
        error instanceof DOMException && error.name === "AbortError"
          ? "TECHFLOW_TIMEOUT"
          : error instanceof Error
            ? error.message
            : "TECHFLOW_UNKNOWN_ERROR";
      this.#lastEvidenceId = `techflow-error-${Date.parse(now)}-${sha256(reason).slice(-12)}`;
      const errorCode = reason.split(":", 1)[0] ?? "TECHFLOW_ERROR";
      this.#errorsByCode.set(errorCode, (this.#errorsByCode.get(errorCode) ?? 0) + 1);
      this.#lastHealth = this.#health({
        status: "ERROR",
        lastAttemptAt: now,
        lastSuccessAt: this.#lastHealth.lastSuccessAt,
        errorCode,
        reason,
      });
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const loop = async () => {
      try {
        await this.pollOnce();
      } catch {
        // Health retains the visible error. The conservative poll loop continues.
      }
      if (this.#running) this.#timer = setTimeout(loop, this.#options.pollIntervalMs);
    };
    void loop();
  }

  stop(): void {
    this.#running = false;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
  }

  #health(input: {
    status: V3SourceHealth["status"];
    lastAttemptAt: Timestamp | null;
    lastSuccessAt: Timestamp | null;
    errorCode: string | null;
    reason: string;
  }): V3SourceHealth {
    const dataAgeMs =
      input.lastSuccessAt === null
        ? null
        : Math.max(
            0,
            (this.#options.now ?? (() => new Date()))().getTime() - Date.parse(input.lastSuccessAt),
          );
    return V3SourceHealthSchema.parse({
      sourceId: SOURCE_ID,
      label: "TechFlow 7×24h",
      category: "NEWS",
      capabilityState: input.lastSuccessAt === null ? "TESTED" : "VERIFIED_CURRENT",
      status: input.status,
      transport: "PUBLIC_WEBPAGE",
      endpoint: this.#options.url ?? SOURCE_URL,
      lastAttemptAt: input.lastAttemptAt,
      lastSuccessAt: input.lastSuccessAt,
      dataAgeMs,
      messagesReceived: this.#stats.messages,
      uniqueItems: this.#stats.unique,
      duplicates: this.#stats.duplicates,
      gaps: this.#stats.gaps,
      reconnects: 0,
      errorCode: input.errorCode,
      reason: input.reason,
      evidenceIds: [
        ...(this.#lastEvidenceId === null ? [] : [this.#lastEvidenceId]),
        "config/source-registry.json",
        "tests/unit/techflow-adapter.test.ts",
      ],
    });
  }
}
