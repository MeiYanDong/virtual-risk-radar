import {
  CapabilityManifestSchema,
  timestamp,
  type CapabilityClaim,
  type CapabilityManifest,
} from "@virtual/domain";

const generatedAt = timestamp("2026-08-23T10:15:18.000Z");
const inputs = ["techflow:public-webpage", "binance:spot"];

function claim(
  capability: CapabilityClaim["capability"],
  level: CapabilityClaim["level"],
  access: CapabilityClaim["access"],
  limitations: string[],
  evidenceIds: string[] = ["config/source-registry.json"],
): CapabilityClaim {
  return {
    capability,
    level,
    access,
    adapterId: "v3.two-source.read-only",
    networks: inputs,
    limitations,
    evidenceIds,
    observedAt: generatedAt,
  };
}

export function createReadOnlyCapabilityBaseline(): CapabilityManifest {
  return CapabilityManifestSchema.parse({
    manifestId: "v3-two-source-read-only",
    version: "3.0.0",
    evidenceLevel: "TESTED",
    generatedAt,
    claims: [
      claim(
        "transport",
        "TESTED",
        "READ",
        ["Only TechFlow public HTML and Binance Spot WebSocket transports are implemented"],
        ["tests/unit/techflow-adapter.test.ts", "tests/unit/binance-spot-adapter.test.ts"],
      ),
      claim("discovery", "TESTED", "READ", [
        "Exactly two configured public sources; there is no implicit fallback",
      ]),
      claim("identity", "UNSUPPORTED", "READ", ["Chain and token identity are outside v0.3"]),
      claim("quote", "UNSUPPORTED", "READ", ["DEX quote and RPC are explicitly excluded"]),
      claim("simulation", "UNSUPPORTED", "READ", ["No transaction or DEX simulation"]),
      claim("calldata", "UNSUPPORTED", "PREPARE", ["No transaction preparation"]),
      claim("sign", "UNSUPPORTED", "WRITE", ["No wallet, signer, or signing route"]),
      claim("broadcast", "UNSUPPORTED", "WRITE", ["No RPC or broadcast client"]),
      claim("reconcile", "UNSUPPORTED", "RECOVER", ["No transaction lifecycle exists"]),
      claim("exit", "UNSUPPORTED", "RECOVER", ["Only CEX_REFERENCE decision signals exist"]),
      claim(
        "replay",
        "TESTED",
        "READ",
        ["Historical inputs remain received-time-only and cannot prove DEX execution"],
        ["tests/replay/event-2026-08-22.test.ts", "tests/unit/v3-decision-engine.test.ts"],
      ),
    ],
  });
}
