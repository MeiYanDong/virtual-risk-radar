import { createHash } from "node:crypto";
import { HashSchema, TimestampSchema } from "@virtual/domain";
import { z } from "zod";
import { ReplayEventSchema, type ReplayEvent } from "./replay";

export const ReplayManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    replayRunId: z.string().min(1),
    inputHash: HashSchema,
    configHash: HashSchema,
    modelVersion: z.string().min(1),
    adapterVersions: z.record(z.string().min(1), z.string().min(1)),
    eventCount: z.number().int().nonnegative(),
    firstReceivedAt: TimestampSchema.nullable(),
    lastReceivedAt: TimestampSchema.nullable(),
  })
  .strict();
export type ReplayManifest = z.infer<typeof ReplayManifestSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export function createReplayManifest(input: {
  events: ReplayEvent[];
  configHash: string;
  modelVersion: string;
  adapterVersions: Record<string, string>;
}): ReplayManifest {
  const events = input.events
    .map((event) => ReplayEventSchema.parse(event))
    .sort((left, right) => {
      const time = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
      if (time !== 0) return time;
      const sequence = left.ingestionSequence - right.ingestionSequence;
      return sequence === 0 ? left.eventId.localeCompare(right.eventId) : sequence;
    });
  const inputHash = hash(events);
  const runIdentity = {
    inputHash,
    configHash: HashSchema.parse(input.configHash),
    modelVersion: input.modelVersion,
    adapterVersions: input.adapterVersions,
  };
  return ReplayManifestSchema.parse({
    schemaVersion: "1.0.0",
    replayRunId: `replay-${hash(runIdentity).slice(7, 31)}`,
    ...runIdentity,
    eventCount: events.length,
    firstReceivedAt: events.at(0)?.receivedAt ?? null,
    lastReceivedAt: events.at(-1)?.receivedAt ?? null,
  });
}

export function replayManifestReport(manifest: ReplayManifest): string {
  return [
    `# Replay ${manifest.replayRunId}`,
    "",
    `- Model: ${manifest.modelVersion}`,
    `- Input hash: ${manifest.inputHash}`,
    `- Config hash: ${manifest.configHash}`,
    `- Events: ${manifest.eventCount}`,
    `- Window: ${manifest.firstReceivedAt ?? "EMPTY"} to ${manifest.lastReceivedAt ?? "EMPTY"}`,
    `- Adapter versions: ${Object.entries(manifest.adapterVersions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, version]) => `${name}=${version}`)
      .join(", ")}`,
  ].join("\n");
}
