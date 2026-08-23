import { z } from "zod";
import { EvidenceLevelSchema } from "./evidence";
import { TimestampSchema } from "./knowledge";

export const CapabilityNameSchema = z.enum([
  "transport",
  "discovery",
  "identity",
  "quote",
  "simulation",
  "calldata",
  "sign",
  "broadcast",
  "reconcile",
  "exit",
  "replay",
]);
export type CapabilityName = z.infer<typeof CapabilityNameSchema>;

export const CapabilityClaimSchema = z
  .object({
    capability: CapabilityNameSchema,
    level: z.enum([
      "UNSUPPORTED",
      "PLANNED",
      "IMPLEMENTED",
      "TESTED",
      "HISTORICAL_RECEIPT",
      "VERIFIED_CURRENT",
    ]),
    access: z.enum(["READ", "PREPARE", "WRITE", "RECOVER"]),
    adapterId: z.string().min(1),
    networks: z.array(z.string().min(1)),
    limitations: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    observedAt: TimestampSchema.optional(),
    expiresAt: TimestampSchema.optional(),
  })
  .strict();
export type CapabilityClaim = z.infer<typeof CapabilityClaimSchema>;

export const CapabilityManifestSchema = z
  .object({
    manifestId: z.string().min(1),
    version: z.string().min(1),
    evidenceLevel: EvidenceLevelSchema,
    generatedAt: TimestampSchema,
    claims: z.array(CapabilityClaimSchema).length(CapabilityNameSchema.options.length),
  })
  .strict()
  .superRefine((manifest, context) => {
    const names = manifest.claims.map((claim) => claim.capability);
    if (new Set(names).size !== CapabilityNameSchema.options.length) {
      context.addIssue({
        code: "custom",
        message: "Capability manifest must contain each capability exactly once",
      });
    }
    for (const capability of ["sign", "broadcast"] satisfies CapabilityName[]) {
      const claim = manifest.claims.find((candidate) => candidate.capability === capability);
      if (claim?.level !== "UNSUPPORTED" || claim.access !== "WRITE") {
        context.addIssue({
          code: "custom",
          path: ["claims", names.indexOf(capability)],
          message: `${capability} must remain UNSUPPORTED with explicit WRITE access classification`,
        });
      }
    }
  });

export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
