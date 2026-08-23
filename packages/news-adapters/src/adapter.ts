import { NewsObservationSchema, type NewsObservation, type Timestamp } from "@virtual/domain";

export type NewsAdapterCapability = {
  sourceId: string;
  tier: NewsObservation["sourceTier"];
  liveCapability: "PLANNED" | "UNSUPPORTED" | "TESTED" | "VERIFIED_CURRENT";
  failureSemantics: string;
};

export interface NewsSourceAdapter {
  capability(): NewsAdapterCapability;
  readReceivedThrough(receivedThrough: Timestamp): Promise<NewsObservation[]>;
}

/** Fixture-only adapter. Its capability intentionally does not imply live collection. */
export class FixtureNewsSourceAdapter implements NewsSourceAdapter {
  readonly #observations: NewsObservation[];
  readonly #capability: NewsAdapterCapability;

  constructor(capability: NewsAdapterCapability, observations: unknown[]) {
    if (capability.liveCapability !== "PLANNED" && capability.liveCapability !== "UNSUPPORTED") {
      throw new Error("A fixture adapter cannot advertise a tested live capability");
    }
    this.#capability = structuredClone(capability);
    this.#observations = observations.map((observation) =>
      NewsObservationSchema.parse(observation),
    );
  }

  capability(): NewsAdapterCapability {
    return structuredClone(this.#capability);
  }

  async readReceivedThrough(receivedThrough: Timestamp): Promise<NewsObservation[]> {
    const through = Date.parse(receivedThrough);
    return this.#observations
      .filter((observation) => Date.parse(observation.receivedAt) <= through)
      .sort((left, right) => {
        const byTime = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
        return byTime === 0 ? left.observationId.localeCompare(right.observationId) : byTime;
      })
      .map((observation) => structuredClone(observation));
  }
}
