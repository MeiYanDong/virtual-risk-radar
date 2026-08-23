import { execFileSync } from "node:child_process";

const allowedProductionLicenses = new Set([
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
]);

const output = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  encoding: "utf8",
});
const report = JSON.parse(output) as Record<string, unknown>;
const rejected = Object.keys(report).filter((license) => !allowedProductionLicenses.has(license));
if (rejected.length > 0) {
  throw new Error(`Unreviewed production licenses: ${rejected.join(", ")}`);
}
console.log(`LICENSE_GATE_OK productionLicenses=${Object.keys(report).sort().join(",")}`);
