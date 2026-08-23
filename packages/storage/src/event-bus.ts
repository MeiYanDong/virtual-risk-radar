import { performance } from "node:perf_hooks";

export type BusEnvelope<TType extends string, TPayload> = {
  type: TType;
  ingestionSequence: number;
  wallTime: string;
  monotonicMilliseconds: number;
  payload: TPayload;
};

type EventMap = Record<string, unknown>;
type Handler<TPayload> = (event: BusEnvelope<string, TPayload>) => void;

export class TypedEventBus<TEvents extends EventMap> {
  readonly #handlers = new Map<keyof TEvents, Set<Handler<unknown>>>();
  #sequence: number;

  constructor(lastPersistedSequence = 0) {
    if (!Number.isInteger(lastPersistedSequence) || lastPersistedSequence < 0) {
      throw new RangeError("Persisted event sequence must be a non-negative integer");
    }
    this.#sequence = lastPersistedSequence;
  }

  publish<TKey extends keyof TEvents & string>(
    type: TKey,
    payload: TEvents[TKey],
  ): BusEnvelope<TKey, TEvents[TKey]> {
    this.#sequence += 1;
    const envelope: BusEnvelope<TKey, TEvents[TKey]> = {
      type,
      ingestionSequence: this.#sequence,
      wallTime: new Date().toISOString(),
      monotonicMilliseconds: performance.now(),
      payload: structuredClone(payload),
    };
    for (const handler of this.#handlers.get(type) ?? []) {
      handler(structuredClone(envelope));
    }
    return structuredClone(envelope);
  }

  subscribe<TKey extends keyof TEvents & string>(
    type: TKey,
    handler: (event: BusEnvelope<TKey, TEvents[TKey]>) => void,
  ): () => void {
    const handlers = this.#handlers.get(type) ?? new Set<Handler<unknown>>();
    const wrapped = handler as Handler<unknown>;
    handlers.add(wrapped);
    this.#handlers.set(type, handlers);
    return () => handlers.delete(wrapped);
  }

  latestSequence(): number {
    return this.#sequence;
  }
}

export function latencyMilliseconds(input: {
  sourceOccurredAt: string;
  receivedAt: string;
  normalizedAt: string;
  decidedAt: string;
}): { sourceToReceive: number; receiveToNormalize: number; normalizeToDecision: number } {
  const source = Date.parse(input.sourceOccurredAt);
  const received = Date.parse(input.receivedAt);
  const normalized = Date.parse(input.normalizedAt);
  const decided = Date.parse(input.decidedAt);
  if ([source, received, normalized, decided].some(Number.isNaN)) {
    throw new TypeError("Latency timestamps must be valid ISO timestamps");
  }
  if (!(source <= received && received <= normalized && normalized <= decided)) {
    throw new RangeError("Latency timestamps must be monotonic");
  }
  return {
    sourceToReceive: received - source,
    receiveToNormalize: normalized - received,
    normalizeToDecision: decided - normalized,
  };
}
