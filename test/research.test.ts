import { describe, expect, it } from "vitest";
import { MockPriceProvider } from "../src/prices";
import { generateReport, isSupportedSymbol } from "../src/research";

describe("generateReport", () => {
  const provider = new MockPriceProvider();

  it("returns a report with provider numbers only", async () => {
    const report = await generateReport("AAPLc", provider);
    expect(report.symbol).toBe("AAPLc");
    expect(report.priceUsd).toBe(280.5);
    expect(report.previousCloseUsd).toBe(275);
    expect(report.changePct).toBe(2);
    expect(report.headline).toContain("AAPLc");
  });

  it("rejects unsupported symbols", async () => {
    await expect(generateReport("DOGE", provider)).rejects.toThrow("Unsupported symbol");
    expect(isSupportedSymbol("NVDAc")).toBe(true);
    expect(isSupportedSymbol("BTC")).toBe(false);
  });
});
