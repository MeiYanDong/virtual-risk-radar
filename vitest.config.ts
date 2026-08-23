import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspacePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@virtual/domain": workspacePath("./packages/domain/src/index.ts"),
      "@virtual/config": workspacePath("./packages/config/src/index.ts"),
      "@virtual/storage": workspacePath("./packages/storage/src/index.ts"),
      "@virtual/news": workspacePath("./packages/news-adapters/src/index.ts"),
      "@virtual/chain": workspacePath("./packages/chain-adapters/src/index.ts"),
      "@virtual/replay": workspacePath("./packages/replay/src/index.ts"),
      "@virtual/features": workspacePath("./packages/feature-engine/src/index.ts"),
      "@virtual/decision": workspacePath("./packages/decision-core/src/index.ts"),
      "@virtual/market": workspacePath("./packages/market-adapters/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["packages/**/*.ts", "apps/server/**/*.ts"],
      exclude: ["**/index.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
