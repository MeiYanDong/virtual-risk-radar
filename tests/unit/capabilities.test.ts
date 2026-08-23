import { createReadOnlyCapabilityBaseline } from "@virtual/config";
import { CapabilityManifestSchema, CapabilityNameSchema } from "@virtual/domain";
import { describe, expect, it } from "vitest";

describe("read-only capability manifest", () => {
  it("declares every capability independently", () => {
    const manifest = createReadOnlyCapabilityBaseline();
    expect(manifest.claims.map((claim) => claim.capability).sort()).toEqual(
      [...CapabilityNameSchema.options].sort(),
    );
  });

  it("keeps signing and broadcasting explicitly unsupported", () => {
    const manifest = createReadOnlyCapabilityBaseline();
    for (const name of ["sign", "broadcast"] as const) {
      const claim = manifest.claims.find((candidate) => candidate.capability === name);
      expect(claim).toMatchObject({ level: "UNSUPPORTED", access: "WRITE" });
    }
  });

  it("rejects a duplicate capability or enabled signing claim", () => {
    const duplicate = structuredClone(createReadOnlyCapabilityBaseline());
    const replacement = duplicate.claims[1];
    if (replacement === undefined) throw new Error("Missing replacement claim");
    duplicate.claims[0] = structuredClone(replacement);
    expect(CapabilityManifestSchema.safeParse(duplicate).success).toBe(false);

    const writable = structuredClone(createReadOnlyCapabilityBaseline());
    const sign = writable.claims.find((claim) => claim.capability === "sign");
    if (sign === undefined) throw new Error("Missing sign claim");
    sign.level = "IMPLEMENTED";
    expect(CapabilityManifestSchema.safeParse(writable).success).toBe(false);
  });
});
