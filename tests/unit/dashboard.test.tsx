// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { parseActiveSystemConfig } from "@virtual/config";
import { timestamp } from "@virtual/domain";
import { normalizeTechFlowItem } from "@virtual/news";
import { afterEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../apps/web/src/App";
import { createWarmupDashboardState } from "../../apps/server/src/v3-state";

const NOW = timestamp("2026-08-23T10:15:18.000Z");
const config = parseActiveSystemConfig(
  JSON.parse(readFileSync(resolve(process.cwd(), "config/default.json"), "utf8")),
);

afterEach(cleanup);

function state() {
  const value = createWarmupDashboardState(config, NOW);
  value.sources.techflow.status = "HEALTHY";
  value.sources.techflow.capabilityState = "VERIFIED_CURRENT";
  value.sources.techflow.lastSuccessAt = NOW;
  value.sources.techflow.dataAgeMs = 120;
  value.sources.binance.status = "HEALTHY";
  value.sources.binance.capabilityState = "VERIFIED_CURRENT";
  value.sources.binance.lastSuccessAt = NOW;
  value.sources.binance.dataAgeMs = 45;
  value.latestMacroEvent = normalizeTechFlowItem({
    item: {
      id: 4001,
      title: "全球贸易谈判暂停，主要经济体加征 50% 关税",
      abstract: "多国宣布同等幅度反制，全球贸易风险升级。",
      source: "金十",
      url: "https://example.com/macro",
      created_at: "2026-08-23T10:14:00.000Z",
      updated_at: "2026-08-23T10:14:00.000Z",
      category: { id: 1, name: "股市观察" },
      content_categories: [],
    },
    receivedAt: timestamp("2026-08-23T10:14:01.000Z"),
    accessedAt: timestamp("2026-08-23T10:14:01.000Z"),
    revision: 0,
    bodyExcerptCharacters: 600,
  });
  value.sell.stage = "NEWS_ARMED";
  value.sell.output = "WATCH";
  value.sell.passed = 1;
  value.sell.nextGap = "跨资产下跌：还缺 3 个新鲜 60 秒窗口";
  const macroCondition = value.sell.conditions[0];
  const btc = value.market[0];
  if (macroCondition === undefined || btc === undefined) {
    throw new Error("Warm-up dashboard must contain S1 and BTC");
  }
  macroCondition.state = "PASS";
  macroCondition.progress = 1;
  macroCondition.current = "TRADE_SANCTIONS / HIGH";
  macroCondition.gap = "0";
  btc.price = "80000" as (typeof value.market)[number]["price"];
  btc.return60s = "-0.001" as (typeof value.market)[number]["return60s"];
  btc.freshness = "FRESH";
  btc.dataAgeMs = 45;
  return value;
}

describe("human-readable decision dashboard", () => {
  it("leads with an action conclusion, keeps eight progress bars, and preserves the DEX boundary", () => {
    render(<Dashboard state={state()} />);

    expect(screen.getByRole("heading", { name: "这一刻，要不要操作？" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "当前结论" })).toHaveTextContent(
      "风险正在升温，继续观察",
    );
    expect(screen.getByRole("region", { name: "减仓判断进度" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "回补判断进度" })).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(8);
    expect(screen.getByText(/页面不会连接钱包或自动交易/)).toBeInTheDocument();
    expect(screen.getByText(/进度表示条件完成度/)).toBeInTheDocument();
    expect(screen.queryByText("固定数量报价研究")).not.toBeInTheDocument();
    expect(screen.queryByText(/CHAIN EXECUTABILITY/)).not.toBeInTheDocument();
  });

  it("renders missing data and condition gaps in plain Chinese without diagnostic fields", () => {
    render(<Dashboard state={state()} />);

    expect(screen.getByRole("progressbar", { name: "跨资产下跌完成度" })).toHaveAttribute(
      "aria-valuetext",
      "等待新鲜数据",
    );
    expect(screen.getAllByText("现在")).not.toHaveLength(0);
    expect(screen.getAllByText("还差")).not.toHaveLength(0);
    expect(screen.getByText("跨资产下跌：还缺 3 个新鲜 60 秒窗口")).toBeInTheDocument();
    expect(screen.queryByText("UNKNOWN / NO FILL")).not.toBeInTheDocument();
    expect(screen.queryByText("阈值")).not.toBeInTheDocument();
    expect(screen.queryByText("证据与判定理由")).not.toBeInTheDocument();
    expect(screen.queryByText("config/source-registry.json")).not.toBeInTheDocument();
  });

  it("translates the global macro classification into reader-facing language", () => {
    render(<Dashboard state={state()} />);
    const macro = screen.getByRole("region", { name: "最新宏观消息" });
    expect(within(macro).getByRole("heading")).toHaveTextContent(
      "全球贸易谈判暂停，主要经济体加征 50% 关税",
    );
    expect(within(macro).getByText("贸易与制裁")).toBeInTheDocument();
    expect(within(macro).getByText("风险偏高")).toBeInTheDocument();
    expect(within(macro).getByText("高影响")).toBeInTheDocument();
    expect(screen.queryByText(/TRADE_SANCTIONS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/加拿大专用/)).not.toBeInTheDocument();
  });

  it("does not expose backend enums or evidence-tape fields on the reader-facing page", () => {
    render(<Dashboard state={state()} />);
    expect(screen.queryByText("EVIDENCE TAPE")).not.toBeInTheDocument();
    expect(screen.queryByText(/CEX_REFERENCE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SHADOW_CANDIDATE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NEWS_ARMED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VERIFIED_CURRENT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PUBLIC_WEBPAGE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/STALE/)).not.toBeInTheDocument();
  });
});
