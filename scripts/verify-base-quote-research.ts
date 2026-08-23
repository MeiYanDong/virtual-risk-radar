import { readFile } from "node:fs/promises";
import { BaseQuoteResearchService, ReadOnlyJsonRpcTransport } from "@virtual/chain";
import { parseSystemConfig } from "@virtual/config";

const config = parseSystemConfig(
  JSON.parse(
    await readFile(new URL("../config/legacy-v0.2.json", import.meta.url), "utf8"),
  ) as unknown,
);
const endpoint = process.env["BASE_RPC_URL"] ?? "https://mainnet.base.org";
const service = new BaseQuoteResearchService({
  settings: config.quoteResearch,
  transport: new ReadOnlyJsonRpcTransport({
    adapterId: "base-public-read-only-v1",
    endpoint,
  }),
});
const snapshot = await service.snapshot();
console.log(JSON.stringify(snapshot, null, 2));
if (snapshot.quoteState !== "PASS") process.exitCode = 1;
