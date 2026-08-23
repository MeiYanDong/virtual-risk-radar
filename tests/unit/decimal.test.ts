import {
  absolute,
  add,
  compare,
  DecimalStringSchema,
  decimal,
  decimalRatioAsNumber,
  divide,
  isPositive,
  multiply,
  subtract,
} from "@virtual/domain";
import { describe, expect, it } from "vitest";

describe("DecimalString", () => {
  it("normalizes values without binary floating point arithmetic", () => {
    expect(add(decimal("0.1"), decimal("0.2"))).toBe("0.3");
    expect(subtract(decimal("1"), decimal("0.75"))).toBe("0.25");
    expect(multiply(decimal("1.25"), decimal("8"))).toBe("10");
    expect(divide(decimal("1"), decimal("8"))).toBe("0.125");
  });

  it("rejects non-canonical and non-finite representations", () => {
    for (const value of ["01", "1.0", "-0", "NaN", "Infinity", "1e-8"]) {
      expect(DecimalStringSchema.safeParse(value).success).toBe(false);
    }
  });

  it("compares decimal values exactly", () => {
    expect(compare(decimal("9007199254740993"), decimal("9007199254740992"))).toBe(1);
    expect(compare(decimal("-0.001"), decimal("-0.001"))).toBe(0);
    expect(compare(decimal("-1"), decimal("0"))).toBe(-1);
  });

  it("fails explicitly on division by zero", () => {
    expect(() => divide(decimal("1"), decimal("0"))).toThrow("Cannot divide by zero");
  });

  it("supports non-monetary progress ratios without changing stored decimal values", () => {
    expect(absolute(decimal("-0.25"))).toBe("0.25");
    expect(isPositive(decimal("0.01"))).toBe(true);
    expect(isPositive(decimal("0"))).toBe(false);
    expect(decimalRatioAsNumber(decimal("1"), decimal("4"))).toBe(0.25);
    expect(() => decimalRatioAsNumber(decimal("1"), decimal("0"))).toThrow("Cannot divide by zero");
  });
});
