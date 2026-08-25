import type {
  V3AssetMarketState,
  V3Condition,
  V3DashboardState,
  V3DecisionPanel,
  V3SourceHealth,
  V3NewsAuditJudgment,
  V3NewsAuditRecord,
} from "@virtual/domain";

export type DashboardState = V3DashboardState;
export type DashboardCondition = V3Condition;
export type DashboardDecision = V3DecisionPanel;
export type SourceHealth = V3SourceHealth;
export type AssetMarketState = V3AssetMarketState;

export type NewsAuditOutcome = V3NewsAuditJudgment["outcome"];
export type NewsAuditListItem = {
  record: V3NewsAuditRecord;
  revisionCount: number;
};
export type TechFlowAuditMetrics = {
  attempts: number;
  successes: number;
  currentPageItems: number;
  uniqueItems: number;
  duplicates: number;
  gaps: number;
  errorsByCode: Record<string, number>;
  lastAttemptAt: string | null;
  dataAgeMs: number | null;
};
export type NewsAuditResponse = {
  generatedAt: string;
  source: SourceHealth;
  metrics: TechFlowAuditMetrics | null;
  items: NewsAuditListItem[];
  total: number;
  filteredTotal: number;
  counts: Record<NewsAuditOutcome, number>;
  nextCursor: string | null;
  historyBoundary: string;
  contentBoundary: string;
};
export type NewsAuditDetailResponse = {
  sourceItemId: string;
  revisions: V3NewsAuditRecord[];
};
