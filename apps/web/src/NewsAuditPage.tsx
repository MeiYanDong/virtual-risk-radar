import { useCallback, useEffect, useMemo, useState } from "react";
import type { V3NewsAuditCheck } from "@virtual/domain";
import type {
  NewsAuditDetailResponse,
  NewsAuditListItem,
  NewsAuditOutcome,
  NewsAuditResponse,
} from "./types";
import "./news-audit.css";

const outcomeCopy: Record<
  NewsAuditOutcome,
  { label: string; short: string; description: string; tone: string }
> = {
  ENTERED_RISK_OBSERVATION: {
    label: "进入风险观察",
    short: "进入观察",
    description: "新闻条件成立，仍需等待市场共同确认",
    tone: "alert",
  },
  NOT_TRIGGERED: {
    label: "未进入风险观察",
    short: "未进入",
    description: "程序已判断不满足新闻启动条件",
    tone: "quiet",
  },
  REVIEW_REQUIRED: {
    label: "需要人工复核",
    short: "需复核",
    description: "现有规则无法可靠完成判断",
    tone: "review",
  },
};

const checkStateCopy: Record<
  V3NewsAuditCheck["state"],
  { label: string; icon: string; tone: string }
> = {
  PASS: { label: "满足", icon: "✓", tone: "pass" },
  FAIL: { label: "不满足", icon: "×", tone: "fail" },
  REVIEW_REQUIRED: { label: "需复核", icon: "?", tone: "review" },
  NOT_APPLICABLE: { label: "无需判断", icon: "·", tone: "muted" },
};

type OutcomeFilter = "ALL" | NewsAuditOutcome;

function formatDate(value: string | null): string {
  if (value === null) return "时间待确认";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAge(milliseconds: number | null): string {
  if (milliseconds === null) return "等待首次同步";
  if (milliseconds < 1_000) return "刚刚";
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} 秒前`;
  return `${Math.round(milliseconds / 60_000)} 分钟前`;
}

function sourcePresentation(status: string) {
  if (status === "HEALTHY")
    return { label: "新闻采集正常", detail: "正在持续读取 TechFlow", tone: "good" };
  if (status === "WARMING_UP")
    return { label: "正在建立连接", detail: "等待首次成功读取", tone: "watch" };
  if (status === "DEGRADED")
    return { label: "新闻采集不稳定", detail: "已发现数据缺口，请留意", tone: "watch" };
  if (status === "STALE")
    return { label: "新闻监测延迟", detail: "最近 30 秒没有成功读取", tone: "bad" };
  return { label: "新闻采集暂不可用", detail: "当前无法确认 TechFlow 最新状态", tone: "bad" };
}

function auditErrorCount(data: NewsAuditResponse): number {
  return Object.values(data.metrics?.errorsByCode ?? {}).reduce((total, count) => total + count, 0);
}

function CheckPath({ checks }: { checks: V3NewsAuditCheck[] }) {
  return (
    <ol className="audit-checks" aria-label="这条新闻的四步判断">
      {checks.map((check, index) => {
        const state = checkStateCopy[check.state];
        return (
          <li className={`audit-check audit-check--${state.tone}`} key={check.id}>
            <span className="audit-check__index" aria-hidden="true">
              {state.icon}
            </span>
            <div>
              <span>第 {index + 1} 步</span>
              <strong className="audit-check__label">{check.label}</strong>
              <p>{check.current}</p>
              <small>{check.reason}</small>
            </div>
            <b>{state.label}</b>
          </li>
        );
      })}
    </ol>
  );
}

function RevisionHistory({ sourceItemId }: { sourceItemId: string }) {
  const [data, setData] = useState<NewsAuditDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/news/audit/${sourceItemId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`修订记录返回 ${response.status}`);
        return (await response.json()) as NewsAuditDetailResponse;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "暂时无法读取修订记录");
      });
    return () => controller.abort();
  }, [sourceItemId]);

  if (error !== null) return <p className="audit-inline-error">{error}</p>;
  if (data === null) return <p className="audit-loading">正在读取判断记录…</p>;
  if (data.revisions.length <= 1) return null;
  return (
    <section className="revision-history" aria-label="新闻修订历史">
      <h4>内容修订记录</h4>
      {data.revisions.map((revision) => (
        <div className="revision-history__entry" key={revision.recordId}>
          <span>第 {revision.item.revision + 1} 版</span>
          <time>{formatDate(revision.judgment.judgedAt)}</time>
          <strong>{outcomeCopy[revision.judgment.outcome].label}</strong>
          <p>{revision.judgment.summary}</p>
        </div>
      ))}
    </section>
  );
}

function NewsAuditRow({ entry }: { entry: NewsAuditListItem }) {
  const [expanded, setExpanded] = useState(false);
  const { item, judgment } = entry.record;
  const outcome = outcomeCopy[judgment.outcome];
  return (
    <article className={`audit-row audit-row--${outcome.tone}`}>
      <div className="audit-row__rail" aria-hidden="true" />
      <div className="audit-row__time">
        <time>{formatDate(item.sourceOccurredAt)}</time>
        <span>系统收到 {formatDate(item.receivedAt)}</span>
      </div>
      <div className="audit-row__body">
        <div className="audit-row__status">
          <span>{outcome.label}</span>
          {entry.revisionCount > 1 ? <em>已更新 {entry.revisionCount - 1} 次</em> : null}
        </div>
        <h2>{item.headline}</h2>
        <p className="audit-row__reason">{judgment.summary}</p>
        <div className="audit-row__meta">
          <span>{item.sourceAttribution ?? "来源归因待确认"}</span>
          <span>{outcome.description}</span>
        </div>
        <div className="audit-row__actions">
          <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener">
            去 TechFlow 核对 ↗
          </a>
          {item.originalUrl === null ? null : (
            <a href={item.originalUrl} target="_blank" rel="noreferrer noopener">
              查看原始来源 ↗
            </a>
          )}
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起判断" : "展开判断"}
          </button>
        </div>
        {expanded ? (
          <div className="audit-row__details">
            <CheckPath checks={judgment.checks} />
            <div className="audit-excerpt">
              <span>程序读取到的必要摘要</span>
              <p>{item.bodyExcerpt.length === 0 ? "TechFlow 未提供可用摘要" : item.bodyExcerpt}</p>
              <small>
                {judgment.observationWindowEndsAt === null
                  ? "观察窗口无法确认"
                  : `观察窗口截止 ${formatDate(judgment.observationWindowEndsAt)}`}
                · 判断规则第 1 版 · 新闻记录第 {item.revision + 1} 版
              </small>
            </div>
            {entry.revisionCount > 1 ? <RevisionHistory sourceItemId={item.sourceItemId} /> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function NewsAuditView({
  data,
  loading,
  error,
  outcome,
  query,
  onOutcomeChange,
  onQueryChange,
  onLoadMore,
}: {
  data: NewsAuditResponse | null;
  loading: boolean;
  error: string | null;
  outcome: OutcomeFilter;
  query: string;
  onOutcomeChange: (value: OutcomeFilter) => void;
  onQueryChange: (value: string) => void;
  onLoadMore: () => void;
}) {
  const source =
    data === null ? sourcePresentation("WARMING_UP") : sourcePresentation(data.source.status);
  const filters: Array<{ value: OutcomeFilter; label: string; count: number }> = [
    { value: "ALL", label: "全部", count: data?.total ?? 0 },
    {
      value: "ENTERED_RISK_OBSERVATION",
      label: "进入观察",
      count: data?.counts.ENTERED_RISK_OBSERVATION ?? 0,
    },
    { value: "NOT_TRIGGERED", label: "未进入", count: data?.counts.NOT_TRIGGERED ?? 0 },
    { value: "REVIEW_REQUIRED", label: "需复核", count: data?.counts.REVIEW_REQUIRED ?? 0 },
  ];
  return (
    <main className="news-audit">
      <header className="news-audit__masthead">
        <a className="news-audit__back" href="/">
          ← 返回实时判断
        </a>
        <div className="news-audit__title">
          <span className="news-audit__kicker">TECHFLOW / DECISION LEDGER</span>
          <h1>每一条，都有判断。</h1>
          <p>这里保留程序实际看到的全部独立快讯，包括没有进入风险观察的新闻。</p>
        </div>
        <a
          className="news-audit__official"
          href="https://www.techflowpost.com/newsletter"
          target="_blank"
          rel="noreferrer noopener"
        >
          打开 TechFlow 官网 ↗
        </a>
      </header>

      <section
        className={`audit-heartbeat audit-heartbeat--${source.tone}`}
        aria-label="TechFlow 采集状态"
      >
        <div className="audit-heartbeat__lead">
          <i aria-hidden="true" />
          <div>
            <span>采集心跳</span>
            <h2>{source.label}</h2>
            <p>{source.detail}</p>
          </div>
        </div>
        <dl>
          <div className="audit-heartbeat__metric">
            <dt>最后成功</dt>
            <dd>{data === null ? "等待数据" : formatAge(data.source.dataAgeMs)}</dd>
          </div>
          <div className="audit-heartbeat__metric">
            <dt>官网当前列表</dt>
            <dd>{data?.metrics?.currentPageItems ?? "—"} 条</dd>
          </div>
          <div className="audit-heartbeat__metric">
            <dt>累计读取</dt>
            <dd>{data?.metrics?.attempts ?? 0} 次</dd>
          </div>
          <div className="audit-heartbeat__metric">
            <dt>错误 / 漏页</dt>
            <dd>
              {data === null ? 0 : auditErrorCount(data)} / {data?.metrics?.gaps ?? 0}
            </dd>
          </div>
        </dl>
        <small>最后尝试：{formatDate(data?.source.lastAttemptAt ?? null)}</small>
      </section>

      <section className="audit-controls" aria-label="新闻筛选">
        <fieldset className="audit-tabs" aria-label="按判断结果筛选">
          {filters.map((filter) => (
            <button
              type="button"
              className={outcome === filter.value ? "is-active" : ""}
              aria-pressed={outcome === filter.value}
              onClick={() => onOutcomeChange(filter.value)}
              key={filter.value}
            >
              <span>{filter.label}</span>
              <strong className="audit-tabs__count">{filter.count}</strong>
            </button>
          ))}
        </fieldset>
        <label className="audit-search">
          <span>搜索新闻</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="标题、摘要或来源"
          />
        </label>
      </section>

      <div className="audit-ledger-heading">
        <div className="audit-ledger-heading__summary">
          <span>新闻判断账本</span>
          <strong className="audit-ledger-heading__count">{data?.filteredTotal ?? 0} 条结果</strong>
        </div>
        <p>完整审计历史从本功能启用后开始；程序离线或漏页会明确显示，不会伪装成完整。</p>
      </div>

      {error === null ? null : <div className="audit-page-error">{error}</div>}
      {data === null && loading ? <div className="audit-empty">正在读取新闻判断…</div> : null}
      {data !== null && data.items.length === 0 ? (
        <div className="audit-empty">
          <strong>当前筛选下没有新闻</strong>
          <span>这不代表采集停止，请以上方“采集心跳”为准。</span>
        </div>
      ) : null}
      <section className="audit-ledger" aria-label="全部新闻判断">
        {data?.items.map((entry) => (
          <NewsAuditRow entry={entry} key={entry.record.recordId} />
        ))}
      </section>
      {data?.nextCursor === null || data?.nextCursor === undefined ? null : (
        <button className="audit-load-more" type="button" onClick={onLoadMore} disabled={loading}>
          {loading ? "正在读取…" : "继续查看更早新闻"}
        </button>
      )}
      <footer className="news-audit__foot">
        <span>判断来自确定性规则，不是涨跌概率。</span>
        <span>新闻只能启动观察，真正减仓仍需市场条件共同确认。</span>
      </footer>
    </main>
  );
}

export default function NewsAuditPage() {
  const [data, setData] = useState<NewsAuditResponse | null>(null);
  const [outcome, setOutcome] = useState<OutcomeFilter>("ALL");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const parameters = useMemo(() => {
    const value = new URLSearchParams({ limit: "50" });
    if (outcome !== "ALL") value.set("outcome", outcome);
    if (debouncedQuery.length > 0) value.set("query", debouncedQuery);
    return value;
  }, [outcome, debouncedQuery]);

  const load = useCallback(
    async (append: boolean, cursor?: string | null, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const value = new URLSearchParams(parameters);
        if (append && cursor !== null && cursor !== undefined) {
          value.set("cursor", cursor);
        }
        const response = await fetch(
          `/api/news/audit?${value.toString()}`,
          signal === undefined ? {} : { signal },
        );
        if (!response.ok) throw new Error(`新闻审计接口返回 ${response.status}`);
        const next = (await response.json()) as NewsAuditResponse;
        setData((current) =>
          append && current !== null ? { ...next, items: [...current.items, ...next.items] } : next,
        );
        setError(null);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "暂时无法读取新闻审计记录");
      } finally {
        setLoading(false);
      }
    },
    [parameters],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(false, null, controller.signal);
    const timer = window.setInterval(() => void load(false), 10_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <NewsAuditView
      data={data}
      loading={loading}
      error={error}
      outcome={outcome}
      query={query}
      onOutcomeChange={setOutcome}
      onQueryChange={setQuery}
      onLoadMore={() => void load(true, data?.nextCursor)}
    />
  );
}
