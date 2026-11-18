import { describe, expect, it } from "vitest";
import { CHAINLINK_FEEDS, SEPOLIA_ADDRESSES, AERODROME_SEPOLIA_AVAILABLE } from "../src/feeds";
import { SUPPORTED_SYMBOLS } from "../src/research";

describe("CHAINLINK_FEEDS", () => {
  it("covers all 10 supported symbols with valid addresses", () => {
    for (const symbol of SUPPORTED_SYMBOLS) {
      const feed = CHAINLINK_FEEDS[symbol];
      expect(feed, `${symbol} feed missing`).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect(Object.keys(CHAINLINK_FEEDS)).toHaveLength(10);
  });

  it("Sepolia addresses are valid and Aerodrome is flagged unavailable", () => {
    expect(SEPOLIA_ADDRESSES.faucetUsdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(SEPOLIA_ADDRESSES.permit2).toBe("0x000000000022D473030F116dDEE9F6B43aC78BA3");
    expect(AERODROME_SEPOLIA_AVAILABLE).toBe(false);
  });
});
