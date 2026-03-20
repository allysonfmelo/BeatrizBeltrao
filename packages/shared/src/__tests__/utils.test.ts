import { describe, it, expect } from "vitest";
import { maskCpf, formatBRL, calculateDeposit } from "../utils/index.js";

// ---------------------------------------------------------------------------
// maskCpf
// ---------------------------------------------------------------------------

describe("maskCpf", () => {
  it("masks a valid CPF provided as digits only", () => {
    expect(maskCpf("12345678900")).toBe("123.***.***-00");
  });

  it("masks a valid CPF provided in formatted form (dots and dashes)", () => {
    expect(maskCpf("123.456.789-00")).toBe("123.***.***-00");
  });

  it("returns the placeholder string for an input with wrong digit count", () => {
    expect(maskCpf("123456")).toBe("***.***.***-**");
  });

  it("returns the placeholder string for an empty string", () => {
    expect(maskCpf("")).toBe("***.***.***-**");
  });
});

// ---------------------------------------------------------------------------
// formatBRL
// ---------------------------------------------------------------------------

describe("formatBRL", () => {
  it("formats an integer value in cents to BRL currency string", () => {
    expect(formatBRL(15000)).toBe("R$\u00a0150,00");
  });

  it("formats zero cents to BRL currency string", () => {
    expect(formatBRL(0)).toBe("R$\u00a00,00");
  });

  it("formats a value smaller than 100 cents (cents only) to BRL currency string", () => {
    expect(formatBRL(99)).toBe("R$\u00a00,99");
  });
});

// ---------------------------------------------------------------------------
// calculateDeposit
// ---------------------------------------------------------------------------

describe("calculateDeposit", () => {
  it("calculates 30% deposit of the total price by default", () => {
    expect(calculateDeposit(25000)).toBe(7500);
  });

  it("calculates deposit with a custom percentage of 50%", () => {
    expect(calculateDeposit(25000, 50)).toBe(12500);
  });

  it("rounds the deposit to the nearest integer when the result is fractional", () => {
    // 10001 * 30 / 100 = 3000.3 → rounds to 3000
    expect(calculateDeposit(10001)).toBe(3000);
    // 10050 * 30 / 100 = 3015 (exact)
    expect(calculateDeposit(10050)).toBe(3015);
    // 10033 * 30 / 100 = 3009.9 → rounds to 3010
    expect(calculateDeposit(10033)).toBe(3010);
  });
});
