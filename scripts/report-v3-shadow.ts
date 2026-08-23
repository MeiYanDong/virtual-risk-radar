import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseActiveSystemConfig } from "@virtual/config";
import { timestamp, type Timestamp } from "@virtual/domain";
import { V3ShadowJournal, type V3ShadowJournalRecord } from "@virtual/storage";
import { readFile } from "node:fs/promises";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;
const MAX_CONTIGUOUS_SAMPLE_GAP_MS = 30_000;

function latestRecord(
  records: readonly V3ShadowJournalRecord[],
  kind: V3ShadowJournalRecord["kind"],
): V3ShadowJournalRecord | null {
  return [...records].reverse().find((record) => record.kind === kind) ?? null;
}

function contiguousObservedMs(records: readonly V3ShadowJournalRecord[]): number {
  const samples = records
    .filter(({ kind }) => kind === "SOURCE_SNAPSHOT")
    .map(({ recordedAt }) => Date.parse(recordedAt))
    .sort((left, right) => left - right);
  let observed = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) continue;
    const gap = current - previous;
    if (gap >= 0 && gap <= MAX_CONTIGUOUS_SAMPLE_GAP_MS) observed += gap;
  }
  return observed;
}

export function summarizeV3Shadow(
  records: readonly V3ShadowJournalRecord[],
  generatedAt: Timestamp,
): Record<string, unknown> {
  let latestStartIndex = -1;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]?.kind === "RUNTIME_START") {
      latestStartIndex = index;
      break;
    }
  }
  const activeRecords = latestStartIndex < 0 ? [] : records.slice(latestStartIndex);
  const start = activeRecords[0] ?? null;
  const last = activeRecords.at(-1) ?? null;
  const latestSnapshot = latestRecord(activeRecords, "SOURCE_SNAPSHOT");
  const stopped = last?.kind === "RUNTIME_STOP";
  const recentlyObserved =
    last !== null &&
    Date.parse(generatedAt) - Date.parse(last.recordedAt) <= MAX_CONTIGUOUS_SAMPLE_GAP_MS;
  const sessionActive = start !== null && !stopped && recentlyObserved;
  const sessionEnd = sessionActive ? generatedAt : (last?.recordedAt ?? generatedAt);
  const sessionElapsedMs =
    start === null ? 0 : Math.max(0, Date.parse(sessionEnd) - Date.parse(start.recordedAt));
  const observedMs = contiguousObservedMs(records);
  const latestSoak =
    latestSnapshot?.payload["soak"] !== null && typeof latestSnapshot?.payload["soak"] === "object"
      ? latestSnapshot?.payload["soak"]
      : null;
  const sellSignals = records.filter(({ kind }) => kind === "SHADOW_SELL_CREATED");
  return {
    reportId: "v3-shadow-status",
    schemaVersion: "3.0.0",
    generatedAt,
    outputBasis: "CEX_REFERENCE",
    economicEvidence: "POSITIVE_EV_NOT_PROVEN",
    latestSession: {
      status: start === null ? "NOT_STARTED" : sessionActive ? "IN_PROGRESS" : "STOPPED_OR_STALE",
      startedAt: start?.recordedAt ?? null,
      lastObservedAt: last?.recordedAt ?? null,
      elapsedMs: sessionElapsedMs,
      requiredSoakMs: ONE_HOUR_MS,
      soakProgress: Math.min(1, sessionElapsedMs / ONE_HOUR_MS),
      elapsedRequirementMet: sessionElapsedMs >= ONE_HOUR_MS,
      acceptanceStatus: sessionElapsedMs < ONE_HOUR_MS ? "IN_PROGRESS" : "ELAPSED_REVIEW_REQUIRED",
      latestMetrics: latestSoak,
    },
    shadowValidation: {
      requiredObservedMs: FOURTEEN_DAYS_MS,
      contiguousObservedMs: observedMs,
      progress: Math.min(1, observedMs / FOURTEEN_DAYS_MS),
      elapsedRequirementMet: observedMs >= FOURTEEN_DAYS_MS,
      cexReferenceSellSignals: sellSignals.length,
      riskWindowRequirement: "REVIEW_REQUIRED",
      conclusion:
        observedMs < FOURTEEN_DAYS_MS
          ? "IN_PROGRESS"
          : "ELAPSED_BUT_SUPPORTED_REFUTED_INCONCLUSIVE_REVIEW_REQUIRED",
    },
    integrity: {
      parsedRecords: records.length,
      latestSequence: records.at(-1)?.sequence ?? 0,
      payloadHashesVerified: true,
      maximumAcceptedSampleGapMs: MAX_CONTIGUOUS_SAMPLE_GAP_MS,
    },
    limitations: [
      "Elapsed time never auto-passes source quality or economic evidence",
      "No wallet, RPC, DEX quote, signing, broadcast, or execution receipt is present",
      "Computer sleep, process downtime, or sample gaps above 30 seconds do not count toward observed Shadow time",
    ],
  };
}

export async function writeV3ShadowReport(input: {
  journalPath: string;
  outputPath: string;
  generatedAt?: Timestamp;
}): Promise<Record<string, unknown>> {
  const journal = new V3ShadowJournal(input.journalPath);
  const records = await journal.list();
  const report = summarizeV3Shadow(records, input.generatedAt ?? timestamp(new Date()));
  await mkdir(dirname(input.outputPath), { recursive: true });
  const temporary = `${input.outputPath}.partial`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, input.outputPath);
  return report;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const config = parseActiveSystemConfig(
    JSON.parse(await readFile(resolve("config/default.json"), "utf8")) as unknown,
  );
  const outputPath = resolve(
    process.env["V3_SHADOW_REPORT_PATH"] ?? "output/reports/v3-shadow-status.json",
  );
  const report = await writeV3ShadowReport({
    journalPath: resolve(config.retention.journalPath),
    outputPath,
  });
  const session = report["latestSession"] as { status: string; soakProgress: number };
  const shadow = report["shadowValidation"] as { progress: number };
  console.log(
    `V3_SHADOW_REPORT status=${session.status} soak=${(session.soakProgress * 100).toFixed(2)}% shadow=${(shadow.progress * 100).toFixed(4)}% path=${outputPath}`,
  );
}
