import { useEffect, useState } from "react";
import type {
  AssetMarketState,
  DashboardCondition,
  DashboardDecision,
  DashboardState,
  SourceHealth,
} from "./types";
import "./styles.css";
import NewsAuditPage from "./NewsAuditPage";

const virtualPrice = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 5,
});
const marketPrice = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAge(milliseconds: number | null): string {
  if (milliseconds === null) return "等待数据";
  if (milliseconds < 1_000) return "刚刚更新";
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} 秒前`;
  return `${Math.round(milliseconds / 60_000)} 分钟前`;
}

function formatTime(value: string | null): string {
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

function formatPrice(asset: AssetMarketState): string {
  if (asset.price === null) return "—";
  return (asset.asset === "VIRTUAL" ? virtualPrice : marketPrice).format(Number(asset.price));
}

function formatReturn(value: string | null): string {
  if (value === null) return "1 分钟走势待确认";
  const percent = Number(value) * 100;
  return `近 1 分钟 ${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function friendlyText(value: string): string {
  return value
    .replaceAll("订单流 STALE，不能补 0", "订单流数据已过期，等待新数据")
    .replaceAll("TRADE_SANCTIONS", "贸易与制裁")
    .replaceAll("MONETARY_MACRO", "货币与宏观")
    .replaceAll("GEOPOLITICS", "地缘政治")
    .replaceAll("FINANCIAL_STABILITY", "金融稳定")
    .replaceAll("ENERGY_SUPPLY", "能源供给")
    .replaceAll("CRYPTO_POLICY", "加密政策")
    .replaceAll("RISK_OFF", "风险偏高")
    .replaceAll("RISK_ON", "风险缓和")
    .replaceAll("SYSTEMIC", "系统性影响")
    .replaceAll("HIGH", "高影响")
    .replaceAll("MEDIUM", "中等影响")
    .replaceAll("LOW", "低影响")
    .replaceAll("STALE", "数据过期")
    .replaceAll("UNKNOWN", "待确认")
    .replaceAll("buy/sell", "买盘/卖盘比")
    .replaceAll("buy", "买盘")
    .replaceAll("sell", "卖盘");
}

function sourceState(source: SourceHealth): { label: string; tone: string } {
  if (source.status === "HEALTHY") return { label: "正常", tone: "good" };
  if (source.status === "WARMING_UP") return { label: "连接中", tone: "watch" };
  if (source.status === "DEGRADED") return { label: "不稳定", tone: "watch" };
  if (source.status === "STALE") return { label: "数据延迟", tone: "bad" };
  return { label: "暂不可用", tone: "bad" };
}

function SourceStatus({ source, label }: { source: SourceHealth; label: string }) {
  const status = sourceState(source);
  return (
    <div className={`source-status source-status--${status.tone}`}>
      <i aria-hidden="true" />
      <span>{label}</span>
      <strong>{status.label}</strong>
      <small>{formatAge(source.dataAgeMs)}</small>
    </div>
  );
}

const macroTypes: Record<string, string> = {
  MONETARY_MACRO: "货币与宏观",
  TRADE_SANCTIONS: "贸易与制裁",
  GEOPOLITICS: "地缘政治",
  FINANCIAL_STABILITY: "金融稳定",
  ENERGY_SUPPLY: "能源供给",
  CRYPTO_POLICY: "加密政策",
  OTHER: "其他事件",
  UNKNOWN: "类型待确认",
};
const macroDirections: Record<string, string> = {
  RISK_OFF: "风险偏高",
  RISK_ON: "风险缓和",
  NEUTRAL: "影响中性",
  UNKNOWN: "方向待确认",
};
const macroSeverity: Record<string, string> = {
  LOW: "低影响",
  MEDIUM: "中等影响",
  HIGH: "高影响",
  SYSTEMIC: "系统性影响",
  UNKNOWN: "影响待确认",
};

function MacroContext({ event }: { event: DashboardState["latestMacroEvent"] }) {
  if (event === null) {
    return (
      <section className="macro-card macro-card--quiet" aria-label="最新宏观消息">
        <div className="section-label">最新宏观消息</div>
        <h2>暂未发现新的高风险事件</h2>
        <p>TechFlow 正在持续监测全球宏观、政策、贸易与地缘风险。</p>
        <a className="macro-card__audit-link" href="/news">
          查看全部新闻判断 →
        </a>
      </section>
    );
  }
  return (
    <section className="macro-card" aria-label="最新宏观消息">
      <div className="section-label">需要留意的消息</div>
      <h2>{event.headline}</h2>
      <div className="macro-card__meta">
        <span>{macroTypes[event.eventType] ?? "类型待确认"}</span>
        <span>{macroDirections[event.direction] ?? "方向待确认"}</span>
        <span>{macroSeverity[event.severity] ?? "影响待确认"}</span>
        <time>{formatTime(event.receivedAt)}</time>
      </div>
      <a className="macro-card__audit-link" href="/news">
        查看全部新闻判断 →
      </a>
    </section>
  );
}

function MarketOverview({ market }: { market: AssetMarketState[] }) {
  const virtual = market.find((asset) => asset.asset === "VIRTUAL");
  const context = market.filter((asset) => asset.asset !== "VIRTUAL");
  return (
    <section className="market-overview" aria-label="实时参考价格">
      <div className="virtual-price">
        <div className="section-label">VIRTUAL 实时参考价</div>
        <div className="virtual-price__value">
          <strong>{virtual === undefined ? "—" : formatPrice(virtual)}</strong>
          <span>USDT</span>
        </div>
        <p className={virtual !== undefined && Number(virtual.return60s) < 0 ? "is-down" : "is-up"}>
          {virtual === undefined ? "等待行情" : formatReturn(virtual.return60s)}
        </p>
      </div>
      <div className="market-context">
        <div className="market-context__head">
          <span>大盘背景</span>
          <small>Binance 参考价格</small>
        </div>
        <div className="market-context__assets">
          {context.map((asset) => (
            <article key={asset.asset}>
              <div>
                <strong>{asset.asset}</strong>
                {asset.freshness !== "FRESH" ? <i>数据延迟</i> : null}
              </div>
              <p>{formatPrice(asset)}</p>
              <small className={Number(asset.return60s) < 0 ? "is-down" : "is-up"}>
                {formatReturn(asset.return60s)}
              </small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function conditionState(condition: DashboardCondition): { label: string; tone: string } {
  if (condition.state === "PASS") return { label: "已满足", tone: "pass" };
  if (condition.state === "FAIL") return { label: "未满足", tone: "fail" };
  if (condition.state === "STALE") return { label: "数据过期", tone: "unknown" };
  return { label: "等待数据", tone: "unknown" };
}

function ConditionRow({ condition, index }: { condition: DashboardCondition; index: number }) {
  const status = conditionState(condition);
  const progress = condition.progress === null ? 0 : Math.max(0, Math.min(1, condition.progress));
  const progressPercent = Math.round(progress * 100);
  return (
    <article className={`condition condition--${status.tone}`}>
      <header>
        <span className="condition__number">{index + 1}</span>
        <h3>{condition.label}</h3>
        <strong>{status.label}</strong>
      </header>
      <div className="condition__progress-copy">
        <span>{condition.progress === null ? "进度待确认" : `条件完成 ${progressPercent}%`}</span>
        <em>{status.label}</em>
      </div>
      <div
        className="condition__track"
        role="progressbar"
        aria-label={`${condition.label}完成度`}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(condition.progress === null
          ? { "aria-valuetext": "等待新鲜数据" }
          : { "aria-valuenow": progressPercent })}
      >
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="condition__explanation">
        <p>
          <span>现在</span>
          {friendlyText(condition.current)}
        </p>
        <p className={condition.state === "PASS" ? "is-complete" : ""}>
          <span>{condition.state === "PASS" ? "结果" : "还差"}</span>
          {condition.state === "PASS" ? "这一项已经达到要求" : friendlyText(condition.gap)}
        </p>
      </div>
    </article>
  );
}

type DecisionCopy = {
  title: string;
  verdict: string;
  detail: string;
  tone: "safe" | "watch" | "ready" | "unknown";
};

function decisionCopy(decision: DashboardDecision): DecisionCopy {
  if (decision.model === "SELL") {
    if (decision.stage === "SELL_READY") {
      return {
        title: "减仓判断",
        verdict: "减仓条件已经全部满足",
        detail: "风险信号已经形成共振。请先在 DEX 钱包确认实际成交价格，再决定是否减仓。",
        tone: "ready",
      };
    }
    if (decision.stage === "NEWS_ARMED") {
      return {
        title: "减仓判断",
        verdict: "新闻风险已出现，等待市场确认",
        detail: "消息本身还不足以触发减仓，继续看大盘、VIRTUAL 相对强弱和主动卖压。",
        tone: "watch",
      };
    }
    if (decision.stage === "MARKET_ARMED") {
      return {
        title: "减仓判断",
        verdict: "市场压力已出现，等待新闻确认",
        detail: "价格侧已经异常，但尚未发现相互印证的宏观风险事件。",
        tone: "watch",
      };
    }
    if (decision.stage === "DATA_UNAVAILABLE" || decision.stage === "UNKNOWN") {
      return {
        title: "减仓判断",
        verdict: "数据不足，暂时不要操作",
        detail: "至少一项关键数据不够新鲜，系统不会给出减仓判断。",
        tone: "unknown",
      };
    }
    return {
      title: "减仓判断",
      verdict: "暂不需要减仓",
      detail: "四项风险条件尚未同时出现，保持观察即可。",
      tone: "safe",
    };
  }
  if (decision.stage === "REBUY_READY") {
    return {
      title: "回补判断",
      verdict: "回补条件已经全部满足",
      detail: "恐慌消化与价格恢复均得到确认。请先确认此前确实减仓，再决定是否买回。",
      tone: "ready",
    };
  }
  if (decision.stage === "DATA_UNAVAILABLE" || decision.stage === "UNKNOWN") {
    return {
      title: "回补判断",
      verdict: "数据不足，暂时不要回补",
      detail: "恢复信号还无法完整判断，等待数据恢复。",
      tone: "unknown",
    };
  }
  if (decision.stage === "REBUY_WAIT") {
    return {
      title: "回补判断",
      verdict: "恐慌仍在消化，暂不回补",
      detail: "部分恢复条件已经出现，但还没有形成完整确认。",
      tone: "watch",
    };
  }
  return {
    title: "回补判断",
    verdict: "暂不回补",
    detail: "目前没有完整的恢复信号；只有实际减仓后，回补判断才有意义。",
    tone: "safe",
  };
}

function DecisionPanel({ decision }: { decision: DashboardDecision }) {
  const copy = decisionCopy(decision);
  return (
    <section className={`decision decision--${copy.tone}`} aria-label={`${copy.title}进度`}>
      <header className="decision__head">
        <div>
          <span>{copy.title}</span>
          <h2>{copy.verdict}</h2>
          <p>{copy.detail}</p>
        </div>
        <output aria-label={`已满足 ${decision.passed} 项，共 ${decision.required} 项`}>
          <strong>{decision.passed}</strong>
          <span>/ {decision.required} 项</span>
        </output>
      </header>
      <div className="decision__segments" aria-hidden="true">
        {decision.conditions.map((condition) => (
          <i className={condition.state === "PASS" ? "is-on" : ""} key={condition.id} />
        ))}
      </div>
      <aside className="decision__next">
        <span>最关键还差</span>
        <p>{friendlyText(decision.nextGap)}</p>
      </aside>
      <div className="condition-list">
        {decision.conditions.map((condition, index) => (
          <ConditionRow condition={condition} index={index} key={condition.id} />
        ))}
      </div>
      <footer>
        {decision.model === "SELL"
          ? "只有四项条件同时满足，才会提示减仓。"
          : "只有四项恢复条件满足，且此前确实减仓，才会提示回补。"}
      </footer>
    </section>
  );
}

function primaryVerdict(state: DashboardState): { title: string; detail: string; tone: string } {
  const sourcesHealthy = Object.values(state.sources).every(({ status }) => status === "HEALTHY");
  if (!sourcesHealthy) {
    return {
      title: "先不操作，等待数据恢复",
      detail: "新闻或行情数据不完整，当前判断不可靠。",
      tone: "unknown",
    };
  }
  if (state.sell.stage === "SELL_READY") {
    return {
      title: "减仓条件已齐，进入人工确认",
      detail: "先打开 DEX 钱包检查实际成交价格，再由你决定是否卖出。",
      tone: "ready",
    };
  }
  if (state.rebuy.stage === "REBUY_READY") {
    return {
      title: "回补条件已齐，进入人工确认",
      detail: "先确认你此前确实减仓，再检查 DEX 实际成交价格。",
      tone: "ready",
    };
  }
  if (["NEWS_ARMED", "MARKET_ARMED"].includes(state.sell.stage)) {
    return {
      title: "风险正在升温，继续观察",
      detail: "已有部分信号，但尚未达到操作条件。",
      tone: "watch",
    };
  }
  return {
    title: "继续观察，暂时不操作",
    detail: "当前没有足够的减仓或回补信号。",
    tone: "safe",
  };
}

export function Dashboard({ state }: { state: DashboardState }) {
  const verdict = primaryVerdict(state);
  return (
    <main className="dashboard">
      <header className="masthead">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">
            V
          </div>
          <div>
            <span className="brand__eyebrow">VIRTUAL 风险雷达</span>
            <h1>这一刻，要不要操作？</h1>
          </div>
        </div>
        <section className="source-statuses" aria-label="数据连接状态">
          <SourceStatus source={state.sources.techflow} label="新闻" />
          <SourceStatus source={state.sources.binance} label="行情" />
        </section>
      </header>

      <section className={`verdict verdict--${verdict.tone}`} aria-label="当前结论">
        <div>
          <span className="section-label">当前结论</span>
          <h2>{verdict.title}</h2>
          <p>{verdict.detail}</p>
        </div>
        <div className="verdict__counts">
          <div>
            <span>减仓条件</span>
            <strong>{state.sell.passed}/4</strong>
          </div>
          <div>
            <span>回补条件</span>
            <strong>{state.rebuy.passed}/4</strong>
          </div>
        </div>
      </section>

      <aside className="safety-note" role="note">
        <strong>只读提醒</strong>
        <span>页面不会连接钱包或自动交易；实际买卖前，请在 DEX 钱包确认即时成交价格。</span>
        <time>更新于 {formatTime(state.asOf)}</time>
      </aside>

      <MarketOverview market={state.market} />
      <MacroContext event={state.latestMacroEvent} />

      <div className="decision-grid">
        <DecisionPanel decision={state.sell} />
        <DecisionPanel decision={state.rebuy} />
      </div>

      <footer className="page-foot">
        <span>进度表示条件完成度，不代表涨跌概率或盈利概率。</span>
        <span>数据来源：TechFlow 新闻与 Binance 参考行情</span>
      </footer>
    </main>
  );
}

function DashboardApplication() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller = new AbortController();
      try {
        const response = await fetch("/api/state", { signal: controller.signal });
        if (!response.ok) throw new Error(`状态接口返回 ${response.status}`);
        const value = (await response.json()) as DashboardState;
        if (active) {
          setState(value);
          setError(null);
        }
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (active) setError(reason instanceof Error ? reason.message : "暂时无法取得状态");
      } finally {
        if (active) timer = window.setTimeout(refresh, 1_000);
      }
    };
    void refresh();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (state === null && error !== null) {
    return (
      <main className="boot boot--error">
        <span>数据连接中断</span>
        <h1>暂时无法判断，请先不要操作</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (state === null) {
    return (
      <main className="boot">
        <span>正在连接数据</span>
        <h1>正在等待新闻与行情</h1>
      </main>
    );
  }
  return <Dashboard state={state} />;
}

export default function App() {
  return window.location.pathname === "/news" ? <NewsAuditPage /> : <DashboardApplication />;
}
