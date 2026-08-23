import { type Timestamp, TimestampSchema } from "@virtual/domain";
import { z } from "zod";

export const ReplayEventSchema = z
  .object({
    eventId: z.string().min(1),
    sourceOccurredAt: TimestampSchema,
    receivedAt: TimestampSchema,
    ingestionSequence: z.number().int().positive(),
    kind: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

function compareEvents(left: ReplayEvent, right: ReplayEvent): number {
  const timeDifference = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
  if (timeDifference !== 0) return timeDifference;
  const sequenceDifference = left.ingestionSequence - right.ingestionSequence;
  if (sequenceDifference !== 0) return sequenceDifference;
  return left.eventId.localeCompare(right.eventId);
}

export class ReplayClock {
  #now: Timestamp;
  #state: "PAUSED" | "RUNNING" = "PAUSED";
  #speed = 1;

  constructor(startAt: Timestamp) {
    this.#now = TimestampSchema.parse(startAt);
  }

  now(): Timestamp {
    return this.#now;
  }

  state(): "PAUSED" | "RUNNING" {
    return this.#state;
  }

  speed(): number {
    return this.#speed;
  }

  pause(): void {
    this.#state = "PAUSED";
  }

  resume(): void {
    this.#state = "RUNNING";
  }

  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1_000) {
      throw new RangeError("Replay speed must be within (0, 1000]");
    }
    this.#speed = multiplier;
  }

  advanceTo(next: Timestamp): void {
    const parsed = TimestampSchema.parse(next);
    if (Date.parse(parsed) < Date.parse(this.#now)) {
      throw new Error("Replay clock cannot move backwards");
    }
    this.#now = parsed;
  }

  seekTo(next: Timestamp): void {
    this.#now = TimestampSchema.parse(next);
  }

  wallTimeTarget(elapsedMilliseconds: number): Timestamp {
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
      throw new RangeError("Replay elapsed wall time must be non-negative");
    }
    if (this.#state === "PAUSED") return this.#now;
    return TimestampSchema.parse(
      new Date(Date.parse(this.#now) + elapsedMilliseconds * this.#speed).toISOString(),
    );
  }
}

export type ReplayContext = {
  now: Timestamp;
  observedEvents: readonly ReplayEvent[];
};

export type ReplayHandler = (event: ReplayEvent, context: ReplayContext) => void;

export class DeterministicReplay {
  readonly #events: ReplayEvent[];
  readonly #clock: ReplayClock;
  readonly #observed: ReplayEvent[] = [];
  #cursor = 0;

  constructor(events: ReplayEvent[], startAt?: Timestamp) {
    this.#events = events.map((event) => ReplayEventSchema.parse(event)).sort(compareEvents);
    const ids = new Set(this.#events.map((event) => event.eventId));
    if (ids.size !== this.#events.length) throw new Error("Replay event ids must be unique");
    const sequences = new Set(this.#events.map((event) => event.ingestionSequence));
    if (sequences.size !== this.#events.length) {
      throw new Error("Replay ingestion sequences must be unique");
    }
    const first = this.#events.at(0);
    const initial = startAt ?? first?.receivedAt;
    if (initial === undefined) throw new Error("Empty replay requires an explicit start time");
    this.#clock = new ReplayClock(initial);
  }

  runUntil(until: Timestamp, handler: ReplayHandler): void {
    this.#clock.advanceTo(until);
    while (this.#cursor < this.#events.length) {
      const event = this.#events[this.#cursor];
      if (event === undefined || Date.parse(event.receivedAt) > Date.parse(until)) break;

      this.#observed.push(structuredClone(event));
      this.#cursor += 1;
      handler(structuredClone(event), {
        now: event.receivedAt,
        observedEvents: Object.freeze(this.#observed.map((item) => structuredClone(item))),
      });
    }
  }

  runAll(handler: ReplayHandler): void {
    const last = this.#events.at(-1);
    if (last === undefined) return;
    this.runUntil(last.receivedAt, handler);
  }

  pause(): void {
    this.#clock.pause();
  }

  resume(): void {
    this.#clock.resume();
  }

  setSpeed(multiplier: number): void {
    this.#clock.setSpeed(multiplier);
  }

  clockState(): { now: Timestamp; state: "PAUSED" | "RUNNING"; speed: number } {
    return {
      now: this.#clock.now(),
      state: this.#clock.state(),
      speed: this.#clock.speed(),
    };
  }

  seek(to: Timestamp): void {
    const parsed = TimestampSchema.parse(to);
    this.#cursor = this.#events.findIndex(
      (event) => Date.parse(event.receivedAt) > Date.parse(parsed),
    );
    if (this.#cursor === -1) this.#cursor = this.#events.length;
    this.#observed.splice(
      0,
      this.#observed.length,
      ...this.#events.slice(0, this.#cursor).map((event) => structuredClone(event)),
    );
    this.#clock.seekTo(parsed);
  }

  step(handler: ReplayHandler, count = 1): number {
    if (!Number.isInteger(count) || count <= 0) {
      throw new RangeError("Replay step count must be a positive integer");
    }
    let processed = 0;
    while (processed < count) {
      const event = this.#events[this.#cursor];
      if (event === undefined) break;
      this.#clock.advanceTo(event.receivedAt);
      this.#observed.push(structuredClone(event));
      this.#cursor += 1;
      processed += 1;
      handler(structuredClone(event), {
        now: event.receivedAt,
        observedEvents: Object.freeze(this.#observed.map((item) => structuredClone(item))),
      });
    }
    return processed;
  }

  advanceWallTime(elapsedMilliseconds: number, handler: ReplayHandler): number {
    const before = this.#cursor;
    this.runUntil(this.#clock.wallTimeTarget(elapsedMilliseconds), handler);
    return this.#cursor - before;
  }

  observedEvents(): readonly ReplayEvent[] {
    return Object.freeze(this.#observed.map((event) => structuredClone(event)));
  }

  pendingCount(): number {
    return this.#events.length - this.#cursor;
  }
}
