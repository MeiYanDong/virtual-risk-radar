import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("production deployment assets", () => {
  it("runs the API as an unprivileged, hardened service with one writable data root", async () => {
    const unit = await source("deploy/systemd/virtual-risk-radar.service");

    expect(unit).toContain("User=virtual-risk");
    expect(unit).toContain("WorkingDirectory=/opt/virtual-risk-radar/current");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("CapabilityBoundingSet=\n");
    expect(unit).toContain("ReadWritePaths=/var/lib/virtual-risk-radar");
    expect(unit).not.toContain("ReadWritePaths=/opt/virtual-risk-radar");
  });

  it("exposes the static SPA and loopback API without enabling write methods", async () => {
    const nginx = await source("deploy/nginx/virtual-risk-radar.conf");

    expect(nginx).toContain("root /opt/virtual-risk-radar/current/dist/web;");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:8787;");
    expect(nginx).toContain("limit_except GET");
    expect(nginx).toContain("Content-Security-Policy");
    expect(nginx).not.toMatch(/proxy_pass\s+https?:\/\/(?!127\.0\.0\.1)/);
  });

  it("keeps runtime data and secrets outside the explicit release allowlist", async () => {
    const buildScript = await source("scripts/build-deployment-artifact.sh");

    expect(buildScript).toContain("refusing to build a production artifact from a dirty worktree");
    expect(buildScript).toContain("readonly tracked_paths=(");
    expect(buildScript).not.toMatch(/^\s+data\/?$/m);
    expect(buildScript).not.toMatch(/^\s+secrets\/?$/m);
    expect(buildScript).not.toMatch(/^\s+\.env/m);
  });

  it("disables password and root SSH after the dedicated admin key is installed", async () => {
    const ssh = await source("deploy/ssh/99-virtual-risk-radar.conf");

    expect(ssh).toContain("PasswordAuthentication no");
    expect(ssh).toContain("KbdInteractiveAuthentication no");
    expect(ssh).toContain("PermitRootLogin no");
    expect(ssh).toContain("AllowUsers vrr-admin");
  });
});
