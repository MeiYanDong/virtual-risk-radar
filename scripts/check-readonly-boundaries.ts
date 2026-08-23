import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const selfPath = resolve(import.meta.filename);
const skippedDirectories = new Set([
  ".git",
  ".mypy_cache",
  ".playwright-cli",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "coverage",
  "data",
  "node_modules",
]);
const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

type Finding = {
  file: string;
  rule: string;
};

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    if (skippedDirectories.has(entry)) continue;
    const absolute = resolve(directory, entry);
    const metadata = await stat(absolute);
    if (metadata.isDirectory()) {
      files.push(...(await listFiles(absolute)));
      continue;
    }
    if (sourceExtensions.has(extname(entry))) files.push(absolute);
  }
  return files;
}

function inspectSource(file: string, content: string): Finding[] {
  const projectPath = relative(repositoryRoot, file);
  const findings: Finding[] = [];

  const rules: Array<[string, RegExp]> = [
    ["write RPC method", /\beth_sendRawTransaction\b/],
    ["transaction signing call", /\b(?:signTransaction|signTypedData)\s*\(/],
    ["contract write call", /\bwriteContract\s*\(/],
    ["raw transaction submission", /\bsendRawTransaction\s*\(/],
    [
      "forbidden HTTP action route",
      /\.(?:post|put|patch|delete)\s*\(\s*["']\/(?:sign|broadcast|approve-token|execute-trade)\b/,
    ],
    ["forbidden project dependency", /Virtuals[ _-]Whale[ _-]Radar/i],
  ];

  for (const [rule, pattern] of rules) {
    if (pattern.test(content)) findings.push({ file: projectPath, rule });
  }
  return findings;
}

function inspectSecrets(file: string, content: string): Finding[] {
  const projectPath = relative(repositoryRoot, file);
  const findings: Finding[] = [];
  const secretRules: Array<[string, RegExp]> = [
    ["private key block", /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/],
    ["embedded mnemonic assignment", /\b(?:mnemonic|seed_phrase)\s*[:=]\s*["'][^"']{12,}["']/i],
    [
      "embedded secret assignment",
      /\b(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/i,
    ],
  ];
  for (const [rule, pattern] of secretRules) {
    if (pattern.test(content)) findings.push({ file: projectPath, rule });
  }
  return findings;
}

const files = await listFiles(repositoryRoot);
const findings: Finding[] = [];

for (const file of files) {
  if (file === selfPath) continue;
  const projectPath = relative(repositoryRoot, file);
  const content = await readFile(file, "utf8");
  findings.push(...inspectSecrets(file, content));

  if (
    projectPath.startsWith("apps/") ||
    projectPath.startsWith("packages/") ||
    projectPath === "package.json"
  ) {
    findings.push(...inspectSource(file, content));
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`READ_ONLY_BOUNDARY_VIOLATION ${finding.file} [${finding.rule}]`);
  }
  process.exitCode = 1;
} else {
  console.log(`READ_ONLY_BOUNDARY_OK scanned=${files.length}`);
}
