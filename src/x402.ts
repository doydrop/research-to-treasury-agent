import type { NextFunction, Request, Response } from "express";
import { paymentMiddleware } from "x402-express";

/** The pay-to address type, taken from the middleware itself (avoids a viem type import). */
export type PayToAddress = Parameters<typeof paymentMiddleware>[0];

/**
 * x402 paywall for POST /research on Base Sepolia (testnet).
 * Unpaid requests get HTTP 402 with payment requirements; the facilitator
 * default (x402.org) is used for testnet. Paid requests carry an
 * X-PAYMENT header that the middleware verifies before passing through.
 */
export function buildPaywall(payTo: PayToAddress, priceUsd: string) {
  return paymentMiddleware(payTo, {
    "POST /research": {
      price: `$${priceUsd}`,
      network: "base-sepolia",
      config: { description: "Stock research report (one symbol)" },
    },
  });
}

export type Paywall = ReturnType<typeof buildPaywall>;
export type { NextFunction, Request, Response };
