import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BaseQuoteResearchService, ReadOnlyJsonRpcTransport } from "@virtual/chain";
import { parseSystemConfig } from "@virtual/config";
import { QuoteResearchJournal } from "@virtual/storage";
import { z } from "zod";
import { RecordingBaseQuoteResearchReader } from "../apps/server/src/base-quote-reader";

// Historical v0.2 research utility. It is deliberately disconnected from the v0.3 runtime.

const positiveInteger = (name: string, fallback: number): number => {
  const raw = process.env[name];
  return raw === undefined ? fallback : z.coerce.number().int().positive().parse(raw);
};

const durationSeconds = positiveInteger("QUOTE_SOAK_DURATION_SECONDS", 3_600);
const intervalSeconds = positiveInteger("QUOTE_SOAK_INTERVAL_SECONDS", 10);
const startedAt = new Date();
const runId = `base-quote-soak-${startedAt.toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDirectory = resolve(
  process.env["QUOTE_SOAK_OUTPUT_DIRECTORY"] ?? join("data", "quote-research", "soak", runId),
);
const journalPath = join(outputDirectory, "quotes.jsonl");
const reportPath = join(outputDirectory, "report.json");
const config = parseSystemConfig(
  JSON.parse(
    await readFile(new URL("../config/legacy-v0.2.json", import.meta.url), "utf8"),
  ) as unknown,
);
const quoteResearch = config.quoteResearch;
const rpcEndpoint = process.env["BASE_RPC_URL"] ?? quoteResearch.rpcEndpoint;
const sanitizedRpcEndpoint = (() => {
  const url = new URL(rpcEndpoint);
  return `${url.protocol}//${url.host}${url.pathname}`;
})();
const service = new BaseQuoteResearchService({
  settings: {
    fixedSellAmountsVirtual: [...quoteResearch.fixedSellAmountsVirtual],
    settlementAssetAddress: quoteResearch.settlementAssetAddress,
    researchSlippageBps: quoteResearch.researchSlippageBps,
    maximumCrossSourceDeviationBps: quoteResearch.maximumCrossSourceDeviationBps,
    quoteExpirySeconds: quoteResearch.quoteExpirySeconds,
    maximumBlockLag: quoteResearch.maximumBlockLag,
    aggregatorProviderId: quoteResearch.aggregatorProviderId,
    canonicalPoolProviderId: quoteResearch.canonicalPoolProviderId,
    canonicalPoolAddress: quoteResearch.canonicalPoolAddress,
    canonicalPoolFee: quoteResearch.canonicalPoolFee,
    canonicalPoolFactoryAddress: quoteResearch.canonicalPoolFactoryAddress,
    canonicalQuoterAddress: quoteResearch.canonicalQuoterAddress,
  },
  transport: new ReadOnlyJsonRpcTransport({
    adapterId: "base-quote-soak-read-only-v1",
    endpoint: rpcEndpoint,
  }),
});
const journal = await QuoteResearchJournal.open(journalPath);
const recorder = new RecordingBaseQuoteResearchReader({
  reader: service,
  journal,
  minimumRefreshMs: 0,
});
const targetDurationMs = durationSeconds * 1_000;
const intervalMs = intervalSeconds * 1_000;
let sampleNumber = 0;

while (Date.now() - startedAt.getTime() < targetDurationMs) {
  sampleNumber += 1;
  try {
    await recorder.snapshot();
  } catch (error) {
    console.error(
      JSON.stringify({
        runId,
        sampleNumber,
        state: "ERROR",
        reason: error instanceof Error ? error.message : "Unknown quote error",
      }),
    );
  }
  const remainingMs = targetDurationMs - (Date.now() - startedAt.getTime());
  if (remainingMs > 0) {
    await new Promise<void>((resolveWait) =>
      setTimeout(resolveWait, Math.min(intervalMs, remainingMs)),
    );
  }
}

const completedAt = new Date();
const actualDurationMs = completedAt.getTime() - startedAt.getTime();
const stats = recorder.stats();
const attemptCoveragePct = stats.attempts === 0 ? 0 : (stats.successes / stats.attempts) * 100;
const scenarioCrossCheckCoveragePct =
  stats.scenariosObserved === 0 ? 0 : (stats.crossChecksPassed / stats.scenariosObserved) * 100;
const report = {
  runId,
  state: stats.successes > 0 ? "COMPLETED_WITH_EVIDENCE" : "FAILED_NO_QUOTE_EVIDENCE",
  purpose: "RESEARCH_ONLY",
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  targetDurationSeconds: durationSeconds,
  actualDurationSeconds: actualDurationMs / 1_000,
  intervalSeconds,
  minimumSixtyMinutesSatisfied: actualDurationMs >= 3_600_000,
  rpcEndpoint: sanitizedRpcEndpoint,
  fixedAmountsVirtual: quoteResearch.fixedSellAmountsVirtual,
  walletState: "NOT_REQUIRED_FIXED_TEST_AMOUNTS",
  quoteLimitsState: config.quoteLimits.state,
  economicEvidence: config.economicEvidence,
  attemptCoveragePct,
  scenarioCrossCheckCoveragePct,
  stats,
  journalPath,
  limitations: [
    "This report measures quote availability and latency, not trading profitability.",
    "A PASS quote snapshot is not calldata, simulation, signature, broadcast, or fill.",
    "The 60-minute gate is satisfied only when minimumSixtyMinutesSatisfied is true.",
  ],
};
await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
if (stats.successes === 0) process.exitCode = 1;
