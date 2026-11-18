import { describe, expect, it } from "vitest";
import { MockSwapExecutor, Treasury } from "../src/treasury";

describe("Treasury", () => {
  it("accumulates sales and sweeps only above the reserve", async () => {
    const t = new Treasury();
    t.recordSale(0.05);
    expect(t.snapshot().usdcBalance).toBe(0.05);
    expect(t.planSweep("AAPLc", 0.5)).toBeNull();

    for (let i = 0; i < 10; i++) t.recordSale(0.05);
    expect(t.snapshot().usdcBalance).toBe(0.55);
    const plan = t.planSweep("AAPLc", 0.5);
    expect(plan).toEqual({ amountUsdc: 0.05, targetSymbol: "AAPLc", status: "planned" });

    const result = await t.executeSweep(plan!, new MockSwapExecutor(280.5));
    expect(result.txHash).toMatch(/^mock-tx-/);
    const snap = t.snapshot();
    expect(snap.usdcBalance).toBe(0.5);
    expect(snap.holdings).toHaveLength(1);
    expect(snap.holdings[0].symbol).toBe("AAPLc");
    expect(snap.holdings[0].amount).toBeGreaterThan(0);
  });

  it("rejects non-positive sales", () => {
    const t = new Treasury();
    expect(() => t.recordSale(0)).toThrow("positive");
  });
});
