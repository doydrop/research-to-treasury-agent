import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";

function makeClient(rpcUrl: string) {
  return createPublicClient({ chain: base, transport: http(rpcUrl) });
}

export interface PriceQuote {
  symbol: string;
  priceUsd: number;
  previousCloseUsd: number;
  updatedAt: Date;
}

export interface PriceProvider {
  getPrice(symbol: string): Promise<PriceQuote>;
}

/**
 * Deterministic in-memory prices for tests and local demo runs.
 * Never used as real market data: the values are fixed examples.
 */
const MOCK_PRICES: Record<string, { price: number; prev: number }> = {
  AAPLc: { price: 280.5, prev: 275.0 },
  NVDAc: { price: 195.25, prev: 201.4 },
  TSLAc: { price: 440.0, prev: 425.5 },
  MSFTc: { price: 505.75, prev: 498.0 },
};

export class MockPriceProvider implements PriceProvider {
  async getPrice(symbol: string): Promise<PriceQuote> {
    const entry = MOCK_PRICES[symbol] ?? { price: 100, prev: 100 };
    return {
      symbol,
      priceUsd: entry.price,
      previousCloseUsd: entry.prev,
      updatedAt: new Date("2026-11-18T00:00:00Z"),
    };
  }
}

const AGGREGATOR_V3_ABI = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/**
 * Reads a tokenized-stock price from a Chainlink total-return feed on Base.
 * Feed addresses come from config (FEED_<SYMBOL>), never hardcoded:
 * only the feed contract per symbol is needed, and no official feed address
 * list is bundled here. previousCloseUsd is not available from the feed,
 * so it is reported equal to the price (change 0%) until a history source
 * is wired in.
 */
export class ChainlinkPriceProvider implements PriceProvider {
  // Inferred from the same factory call used in the constructor, so the
  // concrete client type always matches (viem's exported PublicClient alias
  // does not line up with it under this TS version).
  private client: ReturnType<typeof makeClient>;

  constructor(
    rpcUrl: string,
    private feeds: Record<string, Address>,
  ) {
    this.client = makeClient(rpcUrl);
  }

  async getPrice(symbol: string): Promise<PriceQuote> {
    const feed = this.feeds[symbol];
    if (!feed) throw new Error(`No Chainlink feed configured for ${symbol}`);
    const [decimals, round] = await Promise.all([
      this.client.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: "decimals" }),
      this.client.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" }),
    ]);
    const priceUsd = Number(round[1]) / 10 ** decimals;
    return {
      symbol,
      priceUsd,
      previousCloseUsd: priceUsd,
      updatedAt: new Date(Number(round[3]) * 1000),
    };
  }
}
