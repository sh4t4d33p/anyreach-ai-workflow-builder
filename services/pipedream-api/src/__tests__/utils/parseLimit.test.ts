import { describe, it, expect } from "vitest";
import { parseLimit } from "../../utils/parseLimit.js";

describe("parseLimit", () => {
  const FALLBACK = 25;
  const MAX = 100;

  it("returns fallback when input is undefined", () => {
    expect(parseLimit(undefined, FALLBACK, MAX)).toBe(FALLBACK);
  });

  it("returns fallback when input is an empty string", () => {
    expect(parseLimit("", FALLBACK, MAX)).toBe(FALLBACK);
  });

  it("returns fallback when input is a non-numeric string", () => {
    expect(parseLimit("abc", FALLBACK, MAX)).toBe(FALLBACK);
  });

  it("returns fallback when input is zero", () => {
    expect(parseLimit("0", FALLBACK, MAX)).toBe(FALLBACK);
  });

  it("returns fallback when input is negative", () => {
    expect(parseLimit("-5", FALLBACK, MAX)).toBe(FALLBACK);
  });

  it("returns fallback when input is NaN", () => {
    expect(parseLimit(NaN, FALLBACK, MAX)).toBe(FALLBACK);
  });

  it("returns fallback when input is Infinity", () => {
    expect(parseLimit(Infinity, FALLBACK, MAX)).toBe(FALLBACK);
  });

  it("returns parsed value for a valid numeric string", () => {
    expect(parseLimit("10", FALLBACK, MAX)).toBe(10);
  });

  it("clamps to max when input exceeds max", () => {
    expect(parseLimit("999", FALLBACK, MAX)).toBe(MAX);
  });

  it("returns max when input equals max exactly", () => {
    expect(parseLimit("100", FALLBACK, MAX)).toBe(100);
  });

  it("handles numeric (non-string) input", () => {
    expect(parseLimit(50, FALLBACK, MAX)).toBe(50);
  });

  it("clamps numeric input that exceeds max", () => {
    expect(parseLimit(200, FALLBACK, MAX)).toBe(MAX);
  });

  it("truncates decimal strings via parseInt", () => {
    expect(parseLimit("7.9", FALLBACK, MAX)).toBe(7);
  });
});
