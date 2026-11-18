import type { PriceProvider, PriceQuote } from "./prices.js";

/** Coinbase B20 tokenized stocks on Base (10 tickers, Aug–Sep 2026). */
export const SUPPORTED_SYMBOLS = [
  "AAPLc",
  "NVDAc",
  "METAc",
  "GOOGLc",
  "AMZNc",
  "MSFTc",
  "MSTRc",
  "SNDKc",
  "SPCXc",
  "TSLAc",
] as const;

export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

export function isSupportedSymbol(symbol: string): symbol is SupportedSymbol {
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(symbol);
}

export interface ResearchReport {
  symbol: SupportedSymbol;
  priceUsd: number;
  previousCloseUsd: number;
  changePct: number;
  generatedAt: string;
  headline: string;
  bullets: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Builds a short research report from a live price quote. No invented data: every number comes from the provider. */
export async function generateReport(
  symbol: string,
  provider: PriceProvider,
): Promise<ResearchReport> {
  if (!isSupportedSymbol(symbol)) {
    throw new Error(
      `Unsupported symbol ${symbol}. Supported: ${SUPPORTED_SYMBOLS.join(", ")}`,
    );
  }
  const quote: PriceQuote = await provider.getPrice(symbol);
  const changePct = round2(((quote.priceUsd - quote.previousCloseUsd) / quote.previousCloseUsd) * 100);
  const direction = changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
  return {
    symbol,
    priceUsd: round2(quote.priceUsd),
    previousCloseUsd: round2(quote.previousCloseUsd),
    changePct,
    generatedAt: quote.updatedAt.toISOString(),
    headline: `${symbol} is ${direction} ${Math.abs(changePct)}% at $${round2(quote.priceUsd)} (prev close $${round2(quote.previousCloseUsd)}).`,
    bullets: [
      `Last price $${round2(quote.priceUsd)} vs previous close $${round2(quote.previousCloseUsd)}.`,
      `Day change ${changePct >= 0 ? "+" : ""}${changePct}%.`,
      `Treasury note: profits from this report are swept into ${symbol} by the treasury module.`,
    ],
  };
}
