import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const directory = resolve("tests/fixtures/2026-08-22/raw");
const manifestSchema = z
  .object({
    fixtureId: z.literal("virtual-risk-2026-08-22-v1"),
    evidenceLevel: z.literal("HISTORICAL_RECEIPT"),
    window: z
      .object({ start: z.string(), end: z.string(), timezone: z.literal("UTC") })
      .passthrough(),
    constraints: z
      .object({
        referenceMarketOnly: z.literal(true),
        cexOrderOrBalanceCapability: z.literal("UNSUPPORTED"),
        baseDexQuote: z.literal("UNKNOWN:not_recorded"),
        robinhoodDexQuote: z.literal("UNKNOWN:not_recorded"),
        executionReceipt: z.literal("UNKNOWN:not_recorded"),
      })
      .strict(),
    files: z.record(
      z.string(),
      z
        .object({ checksum: z.string(), bytes: z.number(), records: z.number().nonnegative() })
        .strict(),
    ),
  })
  .passthrough();

const manifest = manifestSchema.parse(
  JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")),
);
for (const [filename, expected] of Object.entries(manifest.files)) {
  const contents = await readFile(resolve(directory, filename));
  const checksum = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
  if (checksum !== expected.checksum || contents.byteLength !== expected.bytes) {
    throw new Error(`Fixture integrity failed for ${filename}`);
  }
  const parsed = JSON.parse(contents.toString("utf8")) as unknown;
  if (expected.records > 1 && (!Array.isArray(parsed) || parsed.length !== expected.records)) {
    throw new Error(`Fixture record count failed for ${filename}`);
  }
}
console.log(`FIXTURE_VERIFIED files=${Object.keys(manifest.files).length}`);
