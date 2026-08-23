import Decimal from "decimal.js";
import { z } from "zod";

const CANONICAL_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

export const DecimalStringSchema = z
  .string()
  .refine((value) => CANONICAL_DECIMAL.test(value) && value !== "-0", {
    message: "Expected a canonical base-10 decimal string",
  })
  .brand<"DecimalString">();

export type DecimalString = z.infer<typeof DecimalStringSchema>;

function canonicalize(value: Decimal.Value): string {
  const rendered = new Decimal(value).toFixed();
  if (new Decimal(rendered).isZero()) {
    return "0";
  }
  return rendered;
}

export function decimal(value: Decimal.Value): DecimalString {
  return DecimalStringSchema.parse(canonicalize(value));
}

export function add(left: DecimalString, right: DecimalString): DecimalString {
  return decimal(new Decimal(left).plus(right));
}

export function subtract(left: DecimalString, right: DecimalString): DecimalString {
  return decimal(new Decimal(left).minus(right));
}

export function multiply(left: DecimalString, right: DecimalString): DecimalString {
  return decimal(new Decimal(left).times(right));
}

export function divide(left: DecimalString, right: DecimalString): DecimalString {
  if (new Decimal(right).isZero()) {
    throw new RangeError("Cannot divide by zero");
  }
  return decimal(new Decimal(left).dividedBy(right));
}

export function absolute(value: DecimalString): DecimalString {
  return decimal(new Decimal(value).abs());
}

export function compare(left: DecimalString, right: DecimalString): -1 | 0 | 1 {
  const compared = new Decimal(left).comparedTo(right);
  if (compared < 0) return -1;
  if (compared > 0) return 1;
  return 0;
}

export function isPositive(value: DecimalString): boolean {
  return new Decimal(value).isPositive() && !new Decimal(value).isZero();
}

export function decimalRatioAsNumber(numerator: DecimalString, denominator: DecimalString): number {
  if (new Decimal(denominator).isZero()) {
    throw new RangeError("Cannot divide by zero");
  }
  return new Decimal(numerator).dividedBy(denominator).toNumber();
}
