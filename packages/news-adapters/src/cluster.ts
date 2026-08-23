import { createHash } from "node:crypto";
import {
  NewsEventClusterSchema,
  unknown,
  type NewsEventCluster,
  type NewsEventType,
  type NewsObservation,
  type Timestamp,
} from "@virtual/domain";

export type NewsClusteringPolicy = {
  relaySourceIds: ReadonlySet<string>;
  eventTypeByFingerprint: Readonly<Record<string, NewsEventType>>;
  severityByFingerprint: Readonly<Record<string, NewsEventCluster["marketSeverity"]>>;
};

const DEFAULT_POLICY: NewsClusteringPolicy = {
  relaySourceIds: new Set(),
  eventTypeByFingerprint: {},
  severityByFingerprint: {},
};

function clusterId(fingerprint: string): string {
  const digest = createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
  return `news-cluster-${digest}`;
}

function latestObservationRevisions(observations: NewsObservation[]): NewsObservation[] {
  const latest = new Map<string, NewsObservation>();
  for (const observation of observations) {
    const existing = latest.get(observation.observationId);
    if (existing === undefined || observation.revision > existing.revision) {
      latest.set(observation.observationId, observation);
    }
  }
  return [...latest.values()];
}

function factConfidence(
  observations: NewsObservation[],
  independentSourceIds: Set<string>,
): NewsEventCluster["factConfidence"] {
  const officialVerified = observations.some(
    (observation) => observation.sourceTier === "T0" && observation.credibilityState === "VERIFIED",
  );
  if (officialVerified) return "VERIFIED";
  const hasDispute = observations.some(({ credibilityState }) => credibilityState === "DISPUTED");
  if (hasDispute) return "DISPUTED";
  if (independentSourceIds.size >= 2) return "CORROBORATED";
  if (observations.some(({ credibilityState }) => credibilityState === "UNVERIFIED")) {
    return "UNVERIFIED";
  }
  return "UNKNOWN";
}

function attentionState(uniqueSourceCount: number): NewsEventCluster["attentionState"] {
  if (uniqueSourceCount >= 6) return "SATURATED";
  if (uniqueSourceCount >= 3) return "TRENDING";
  if (uniqueSourceCount >= 2) return "WATCH";
  return "QUIET";
}

function receivedTimeBounds(observations: NewsObservation[]): {
  first: Timestamp;
  last: Timestamp;
} {
  const ordered = [...observations].sort(
    (left, right) => Date.parse(left.receivedAt) - Date.parse(right.receivedAt),
  );
  const first = ordered.at(0);
  const last = ordered.at(-1);
  if (first === undefined || last === undefined) throw new Error("A cluster cannot be empty");
  return { first: first.receivedAt, last: last.receivedAt };
}

export function clusterNewsObservations(
  input: NewsObservation[],
  policy: NewsClusteringPolicy = DEFAULT_POLICY,
): NewsEventCluster[] {
  const grouped = new Map<string, NewsObservation[]>();
  for (const observation of latestObservationRevisions(input)) {
    if (observation.claimFingerprint.state !== "KNOWN") continue;
    const group = grouped.get(observation.claimFingerprint.value) ?? [];
    group.push(observation);
    grouped.set(observation.claimFingerprint.value, group);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fingerprint, observations]) => {
      const ordered = [...observations].sort((left, right) => {
        const byTime = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
        return byTime === 0 ? left.observationId.localeCompare(right.observationId) : byTime;
      });
      const uniqueSources = new Set(ordered.map(({ sourceId }) => sourceId));
      const independentSourceIds = new Set(
        ordered
          .filter(({ sourceTier }) => ["T0", "T1", "T2"].includes(sourceTier))
          .filter(({ sourceId }) => !policy.relaySourceIds.has(sourceId))
          .map(({ sourceId }) => sourceId),
      );
      const official = ordered.find(
        ({ sourceTier, credibilityState }) =>
          sourceTier === "T0" && credibilityState === "VERIFIED",
      );
      const { first, last } = receivedTimeBounds(ordered);
      return NewsEventClusterSchema.parse({
        clusterId: clusterId(fingerprint),
        revision:
          Math.max(...ordered.map(({ revision }) => revision)) + Math.max(0, ordered.length - 1),
        claimFingerprint: fingerprint,
        eventType: policy.eventTypeByFingerprint[fingerprint] ?? "UNKNOWN",
        factConfidence: factConfidence(ordered, independentSourceIds),
        marketSeverity: policy.severityByFingerprint[fingerprint] ?? "UNKNOWN",
        attentionState: attentionState(uniqueSources.size),
        firstReceivedAt: first,
        lastUpdatedAt: last,
        officialConfirmationAt:
          official === undefined
            ? unknown("No verified T0 observation", last)
            : {
                state: "KNOWN",
                value: official.receivedAt,
                observedAt: official.receivedAt,
                evidenceIds: [official.observationId],
              },
        sourceIds: [...uniqueSources].sort(),
        independentSourceCount: independentSourceIds.size,
        amplificationCount: ordered.length - independentSourceIds.size,
        observationIds: ordered.map(({ observationId }) => observationId),
        evidenceIds: ordered.map(({ observationId }) => observationId),
      });
    });
}

export function newsArmState(
  cluster: NewsEventCluster,
  now: Timestamp,
  freshnessMinutes = 120,
): "NEWS_ARMED" | "NO_NEWS" {
  const ageMs = Date.parse(now) - Date.parse(cluster.firstReceivedAt);
  const factPass = ["VERIFIED", "CORROBORATED"].includes(cluster.factConfidence);
  const severityPass = ["HIGH", "SYSTEMIC"].includes(cluster.marketSeverity);
  return factPass && severityPass && ageMs >= 0 && ageMs <= freshnessMinutes * 60_000
    ? "NEWS_ARMED"
    : "NO_NEWS";
}
