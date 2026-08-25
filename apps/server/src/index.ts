import { pathToFileURL } from "node:url";
import { buildServer, loadDefaultConfig } from "./app";
import { V3Runtime } from "./v3-runtime";

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const config = await loadDefaultConfig();
  const runtime = new V3Runtime(config);
  await runtime.start();
  const server = await buildServer({ runtime });
  const { PORT: portInput } = process.env;
  const port = Number.parseInt(portInput ?? "8787", 10);
  await server.listen({ host: "127.0.0.1", port });
  console.log(`VIRTUAL v0.3 two-source server listening on http://127.0.0.1:${port}`);

  const shutdown = async () => {
    await runtime.stop();
    await server.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

export { buildServer } from "./app";
export { V3Runtime } from "./v3-runtime";
