import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { schemaDocuments } from "./schema-documents";

const outputDirectory = resolve("docs/specs/generated");
const stale: string[] = [];
const expectedDocuments = schemaDocuments();

for (const [filename, expected] of expectedDocuments) {
  let actual = "";
  try {
    actual = await readFile(resolve(outputDirectory, filename), "utf8");
  } catch {
    stale.push(`${filename} (missing)`);
    continue;
  }
  if (actual !== expected) stale.push(`${filename} (stale)`);
}

const expectedFiles = new Set(expectedDocuments.keys());
for (const filename of await readdir(outputDirectory)) {
  if (filename.endsWith(".schema.json") && !expectedFiles.has(filename)) {
    stale.push(`${filename} (unexpected legacy name)`);
  }
}

if (stale.length > 0) {
  console.error(`SCHEMA_OUT_OF_DATE ${stale.join(", ")}`);
  console.error("Run: pnpm schema:generate");
  process.exitCode = 1;
} else {
  console.log(`SCHEMA_CURRENT count=${expectedDocuments.size}`);
}
