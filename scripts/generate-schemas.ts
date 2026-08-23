import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { schemaDocuments } from "./schema-documents";

const outputDirectory = resolve("docs/specs/generated");
await mkdir(outputDirectory, { recursive: true });

for (const [filename, content] of schemaDocuments()) {
  await writeFile(resolve(outputDirectory, filename), content, "utf8");
}

console.log(`SCHEMA_GENERATED count=${schemaDocuments().size}`);
