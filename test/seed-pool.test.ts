import { describe, expect, it } from "vitest";
import { isqrt, sqrtPriceX96ForPrice } from "../scripts/seed-pool";

describe("seed-pool math", () => {
  it("isqrt is exact on squares and floors otherwise", () => {
    expect(isqrt(16n)).toBe(4n);
    expect(isqrt(15n)).toBe(3n);
    expect(isqrt(10n ** 36n)).toBe(10n ** 18n);
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
  });

  it("sqrtPriceX96 round-trips to the seed price", () => {
    for (const price of [280.5, 195.25, 440.0, 100]) {
      const sqrt = sqrtPriceX96ForPrice(price);
      const ratio = (Number(sqrt) / 2 ** 96) ** 2; // token1/token0 raw
      const recovered = 1e18 / (ratio * 1e6);
      expect(recovered).toBeCloseTo(price, 2);
    }
  });
});
