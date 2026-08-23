import { z } from "zod";
import { TimestampSchema } from "./knowledge";

export const HashSchema = z
  .string()
  .regex(/^(?:sha256|keccak256):[0-9a-f]{64}$/)
  .brand<"Hash">();
export type Hash = z.infer<typeof HashSchema>;

export const EvidenceLevelSchema = z.enum([
  "PLANNED",
  "REPOSITORY_RECORD",
  "TESTED",
  "HISTORICAL_REFERENCE",
  "HISTORICAL_RECEIPT",
  "VERIFIED_CURRENT",
  "UNKNOWN",
]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

export const EvidenceRefSchema = z
  .object({
    evidenceId: z.string().min(1),
    kind: z.enum([
      "SOURCE",
      "CHAIN_STATE",
      "QUOTE",
      "SIMULATION",
      "TRANSPORT",
      "RECEIPT",
      "EVENT",
      "BALANCE",
      "POSITION",
      "VALUATION",
      "OPERATOR",
      "CONFIG",
    ]),
    sourceId: z.string().min(1),
    observedAt: TimestampSchema,
    blockOrSequence: z.string().min(1).optional(),
    freshness: z.enum(["FRESH", "STALE", "NOT_APPLICABLE"]),
    payloadHash: HashSchema,
    redactedRef: z.string().min(1).optional(),
  })
  .strict();

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
