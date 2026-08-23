import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { known, NewsObservationSchema, timestamp, type NewsObservation } from "@virtual/domain";

const OUTPUT_DIRECTORY = resolve("tests/fixtures/2026-08-22");
const ACCESSED_AT = timestamp("2026-08-22T08:59:06.000Z");
const TRADE_CLAIM = "canada-us-trade-talks-paused-50pct-reciprocal-tariffs";

type Input = Omit<
  NewsObservation,
  "rawTextHash" | "sourceOccurredAt" | "claimFingerprint" | "schemaVersion" | "accessedAt"
> & {
  sourceOccurredAt: string;
  claimFingerprint: string;
};

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

const inputs: Input[] = [
  {
    observationId: "news-ap-canada-tariffs-20260822",
    sourceId: "ap-news",
    sourceItemId: "857ef76b20a766e370d70176135b678e",
    sourceUrl: "https://apnews.com/article/857ef76b20a766e370d70176135b678e",
    sourceTier: "T1",
    headline: "US imposes 50% tariffs on Canadian products, and Canada says it will retaliate",
    language: "en",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T03:40:55.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T03:43:45.000Z"),
    claimFingerprint: TRADE_CLAIM,
    credibilityState: "CORROBORATED",
    entities: ["Canada", "United States", "Mark Carney", "tariffs"],
  },
  {
    observationId: "news-jin10-canada-tariffs-20260822",
    sourceId: "jin10",
    sourceItemId: "20260822114345108800",
    sourceUrl: "https://flash.jin10.com/detail/20260822114345108800",
    sourceTier: "T1",
    headline: "加拿大总理卡尼称美加贸易谈判暂停并将对等反制",
    language: "zh-CN",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T03:43:45.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T03:43:45.000Z"),
    claimFingerprint: TRADE_CLAIM,
    credibilityState: "CORROBORATED",
    entities: ["加拿大", "美国", "Mark Carney", "关税"],
  },
  {
    observationId: "news-carney-x-canada-tariffs-20260822",
    sourceId: "mark-carney-x",
    sourceItemId: "2091008744427598021",
    sourceUrl: "https://x.com/MarkJCarney/status/2091008744427598021",
    sourceTier: "T0",
    headline: "Canada will match the tariffs dollar for dollar to protect workers and businesses",
    language: "en",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T03:45:08.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T03:45:08.000Z"),
    claimFingerprint: TRADE_CLAIM,
    credibilityState: "VERIFIED",
    entities: ["Canada", "United States", "Mark Carney", "tariffs"],
  },
  {
    observationId: "news-watcher-guru-canada-tariffs-20260822",
    sourceId: "watcher-guru-x",
    sourceItemId: "2091012631746224276",
    sourceUrl: "https://x.com/WatcherGuru/status/2091012631746224276",
    sourceTier: "T3",
    headline: "Canada pauses US trade talks and announces reciprocal tariffs",
    language: "en",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T04:00:35.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T04:00:35.000Z"),
    claimFingerprint: TRADE_CLAIM,
    credibilityState: "CORROBORATED",
    entities: ["Canada", "United States", "tariffs"],
  },
  {
    observationId: "news-techflow-canada-tariffs-20260822",
    sourceId: "techflow",
    sourceItemId: "133044",
    sourceUrl: "https://www.techflowpost.com/newsletter/133044",
    sourceTier: "T2",
    headline: "TechFlow 转述金十的加拿大关税快讯",
    language: "zh-CN",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T04:02:19.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T04:02:19.000Z"),
    claimFingerprint: TRADE_CLAIM,
    credibilityState: "CORROBORATED",
    entities: ["加拿大", "美国", "金十", "关税"],
  },
  {
    observationId: "news-axios-canada-tariffs-20260822",
    sourceId: "axios",
    sourceItemId: "us-canada-tariffs-trade-trump-carney",
    sourceUrl: "https://www.axios.com/2026/08/22/us-canada-tariffs-trade-trump-carney",
    sourceTier: "T1",
    headline: "U.S.-Canada trade talks collapse, 50% tariffs go into effect",
    language: "en",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T04:50:24.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T04:50:24.000Z"),
    claimFingerprint: TRADE_CLAIM,
    credibilityState: "CORROBORATED",
    entities: ["Canada", "United States", "Donald Trump", "Mark Carney", "tariffs"],
  },
  {
    observationId: "news-unusual-whales-canada-tariffs-20260822",
    sourceId: "unusual-whales-x",
    sourceItemId: "2091028641279054053",
    sourceUrl: "https://x.com/unusual_whales/status/2091028641279054053",
    sourceTier: "T3",
    headline: "Second social amplification of the Canada tariff conflict",
    language: "en",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T05:04:12.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T05:04:12.000Z"),
    claimFingerprint: TRADE_CLAIM,
    credibilityState: "CORROBORATED",
    entities: ["Canada", "United States", "tariffs"],
  },
  {
    observationId: "news-jin10-iran-military-20260822",
    sourceId: "jin10",
    sourceItemId: "20260822131227792800",
    sourceUrl: "https://flash.jin10.com/detail/20260822131227792800",
    sourceTier: "T1",
    headline: "金十伊朗军事言论快讯",
    language: "zh-CN",
    revision: 0,
    ingestionMethod: "HISTORICAL_FIXTURE",
    sourceOccurredAt: "2026-08-22T05:12:27.000Z",
    sourceOccurredAtPrecision: "SECOND",
    receivedAt: timestamp("2026-08-22T05:12:27.000Z"),
    claimFingerprint: "iran-military-geopolitical-risk-statement",
    credibilityState: "UNVERIFIED",
    entities: ["伊朗", "军事", "地缘政治"],
  },
];

const observations = inputs.map((input) => {
  const occurredAt = timestamp(input.sourceOccurredAt);
  return NewsObservationSchema.parse({
    ...input,
    sourceOccurredAt: known(occurredAt, input.receivedAt, [input.sourceUrl]),
    accessedAt: ACCESSED_AT,
    rawTextHash: hash(input.headline),
    claimFingerprint: known(input.claimFingerprint, input.receivedAt, [input.sourceUrl]),
    schemaVersion: "1.0.0",
  });
});

const manifest = {
  fixtureId: "virtual-risk-news-2026-08-22-v1",
  evidenceLevel: "HISTORICAL_REFERENCE",
  accessedAt: ACCESSED_AT,
  assumptions: {
    AP: "Source time is 03:40:55Z; replay received time is conservatively pinned to 03:43:45Z.",
    otherSources:
      "Received time equals recorded source time because no earlier local receipt exists.",
    rawBodies:
      "Not redistributed; hashes cover the stored short headline only and URLs preserve provenance.",
    factVsCause:
      "The tariff fact is corroborated. Whether it caused the crypto selloff remains NOT_PROVEN.",
  },
  expectedClusters: [
    {
      clusterId: "cluster-canada-us-tariffs-20260822",
      claimFingerprint: TRADE_CLAIM,
      observationIds: observations
        .filter((observation) => observation.claimFingerprint.state === "KNOWN")
        .filter(
          (observation) =>
            observation.claimFingerprint.state === "KNOWN" &&
            observation.claimFingerprint.value === TRADE_CLAIM,
        )
        .map((observation) => observation.observationId),
      duplicateAttentionDoesNotIncreaseFactConfidence: true,
    },
    {
      clusterId: "cluster-iran-military-20260822",
      claimFingerprint: "iran-military-geopolitical-risk-statement",
      observationIds: ["news-jin10-iran-military-20260822"],
      independentFromInitialTariffCluster: true,
    },
  ],
};

async function atomicJson(filename: string, value: unknown) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const target = resolve(OUTPUT_DIRECTORY, filename);
  const temporary = `${target}.partial`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, target);
}

await atomicJson("news-observations.json", observations);
await atomicJson("news-manifest.json", manifest);
console.log(`NEWS_FIXTURE_GENERATED observations=${observations.length} clusters=2`);
