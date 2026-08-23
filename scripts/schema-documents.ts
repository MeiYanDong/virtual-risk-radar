import {
  BaseQuoteResearchSnapshotSchema,
  CapabilityManifestSchema,
  ChainProfileSchema,
  ChainExecutabilitySchema,
  ChainQuoteSchema,
  ConditionEvaluationSchema,
  DecisionSnapshotSchema,
  DerivativeObservationSchema,
  EvidenceRefSchema,
  FeatureSnapshotSchema,
  MarketObservationSchema,
  NewsEventClusterSchema,
  NewsObservationSchema,
  QuoteProviderObservationSchema,
  QuoteResearchScenarioSchema,
  V3ConditionSchema,
  V3DashboardStateSchema,
  V3DecisionPanelSchema,
  V3MarketTickSchema,
  V3NewsItemSchema,
  V3SourceHealthSchema,
  WalletProfileSchema,
} from "@virtual/domain";
import {
  ActiveStateMachineSpecSchema,
  ActiveSystemConfigSchema,
  SourceRegistrySchema,
  SystemConfigSchema,
} from "@virtual/config";
import { StateMachineSpecSchema } from "@virtual/decision";
import { ReplayEventSchema } from "@virtual/replay";
import { LedgerEventSchema, V3ShadowJournalRecordSchema } from "@virtual/storage";
import { z, type ZodType } from "zod";

const schemas: Array<[string, ZodType]> = [
  ["capability-manifest", CapabilityManifestSchema],
  ["source-registry", SourceRegistrySchema],
  ["state-machine-spec", ActiveStateMachineSpecSchema],
  ["system-config", ActiveSystemConfigSchema],
  ["v3-condition", V3ConditionSchema],
  ["v3-dashboard-state", V3DashboardStateSchema],
  ["v3-decision-panel", V3DecisionPanelSchema],
  ["v3-market-tick", V3MarketTickSchema],
  ["v3-news-item", V3NewsItemSchema],
  ["v3-source-health", V3SourceHealthSchema],
  ["v3-shadow-journal-record", V3ShadowJournalRecordSchema],
  ["legacy-v0.2-base-quote-research-snapshot", BaseQuoteResearchSnapshotSchema],
  ["legacy-v0.2-chain-profile", ChainProfileSchema],
  ["legacy-v0.2-chain-executability", ChainExecutabilitySchema],
  ["legacy-v0.2-chain-quote", ChainQuoteSchema],
  ["legacy-v0.2-condition-evaluation", ConditionEvaluationSchema],
  ["legacy-v0.2-decision-snapshot", DecisionSnapshotSchema],
  ["legacy-v0.2-derivative-observation", DerivativeObservationSchema],
  ["legacy-v0.2-evidence-ref", EvidenceRefSchema],
  ["legacy-v0.2-feature-snapshot", FeatureSnapshotSchema],
  ["legacy-v0.2-ledger-event", LedgerEventSchema],
  ["legacy-v0.2-market-observation", MarketObservationSchema],
  ["legacy-v0.2-news-event-cluster", NewsEventClusterSchema],
  ["legacy-v0.2-news-observation", NewsObservationSchema],
  ["legacy-v0.2-quote-provider-observation", QuoteProviderObservationSchema],
  ["legacy-v0.2-quote-research-scenario", QuoteResearchScenarioSchema],
  ["legacy-v0.2-replay-event", ReplayEventSchema],
  ["legacy-v0.2-state-machine-spec", StateMachineSpecSchema],
  ["legacy-v0.2-system-config", SystemConfigSchema],
  ["legacy-v0.2-wallet-profile", WalletProfileSchema],
];

export function schemaDocuments(): Map<string, string> {
  return new Map(
    schemas.map(([name, schema]) => {
      const document = z.toJSONSchema(schema, {
        target: "draft-2020-12",
      });
      document.$id = `https://virtual-risk.local/schema/${name}.v1.json`;
      return [`${name}.schema.json`, `${JSON.stringify(document, null, 2)}\n`];
    }),
  );
}
