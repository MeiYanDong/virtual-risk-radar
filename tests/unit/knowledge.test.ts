import {
  assertNever,
  DecimalStringSchema,
  decimal,
  isFreshAt,
  knowledgeError,
  knowledgeSchema,
  known,
  timestamp,
  unknown,
  unsupported,
} from "@virtual/domain";
import { describe, expect, it } from "vitest";

describe("Knowledge", () => {
  const observedAt = timestamp("2026-08-22T08:00:00.000Z");

  it("keeps KNOWN(0) distinct from UNKNOWN", () => {
    const schema = knowledgeSchema(DecimalStringSchema);
    const zero = schema.parse(known(decimal("0"), observedAt, ["e-zero"]));
    const missing = schema.parse(unknown("source unavailable", observedAt));

    expect(zero.state).toBe("KNOWN");
    if (zero.state === "KNOWN") expect(zero.value).toBe("0");
    expect(missing.state).toBe("UNKNOWN");
  });

  it("does not mutate an expired known value into another state", () => {
    const value = known(decimal("1"), observedAt, ["e-1"], timestamp("2026-08-22T08:00:01.000Z"));

    expect(isFreshAt(value, timestamp("2026-08-22T08:00:02.000Z"))).toBe(false);
    expect(value.state).toBe("KNOWN");
    expect(value.value).toBe("1");
  });

  it("requires UTC timestamps rather than silently converting offsets", () => {
    expect(() => timestamp("2026-08-22T16:00:00+08:00")).toThrow();
    expect(timestamp(new Date("2026-08-22T16:00:00+08:00"))).toBe("2026-08-22T08:00:00.000Z");
  });

  it("keeps unsupported and retryable errors explicit", () => {
    const schema = knowledgeSchema(DecimalStringSchema);
    expect(schema.parse(unsupported("provider has no endpoint")).state).toBe("UNSUPPORTED");
    expect(schema.parse(knowledgeError("timeout", observedAt, true))).toMatchObject({
      state: "ERROR",
      retryable: true,
    });
    expect(() => assertNever("unexpected" as never, "test state")).toThrow("Unhandled test state");
  });
});
