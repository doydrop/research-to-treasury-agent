import type { Address, Hex } from "viem";
import type { SwapExecutor, SwapResult } from "./treasury.js";
import { SEPOLIA_ADDRESSES } from "./feeds.js";

const QUOTE_URL = "https://trade-api.gateway.uniswap.org/v1/quote";
const SWAP_URL = "https://trade-api.gateway.uniswap.org/v1/swap";
const CHAIN_ID = 84532; // Base Sepolia

export interface UniswapQuote {
  amountOut: bigint;
  swapTransaction?: { to: Address; data: Hex; value: string };
  raw: unknown;
}

export interface UniswapExecutorOptions {
  apiKey: string;
  /** USDC token address (Sepolia faucet USDC by default). */
  usdc: Address;
  /** Deployed mock B20 addresses per symbol, from deployments/base-sepolia.json. */
  tokens: Record<string, Address>;
  /** Decimals per token (mock B20s use 18). */
  tokenDecimals?: Record<string, number>;
  /** Wallet account address that receives the output and pays gas. */
  swapper: Address;
  /** Minimal public client surface, injected for tests. Defaults to a viem client on Sepolia. */
  publicClient?: {
    readContract(args: { address: Address; abi: unknown; functionName: string; args: unknown[] }): Promise<unknown>;
  };
  /** Minimal wallet surface, injected for tests. Defaults to a viem wallet client. */
  walletClient?: {
    sendTransaction(args: { to: Address; data: Hex; value: bigint }): Promise<Hex>;
    waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: string }>;
  };
  fetchFn?: typeof fetch;
}

const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const USDC_DECIMALS = 6;

/**
 * Executes USDC -> mock B20 sweeps on Base Sepolia through the Uniswap Trading API.
 *
 * Flow: POST /v1/quote (AMM protocols only — V2/V3/V4 — so tiny sweeps never
 * need UniswapX order signing) -> approve Permit2 for the exact USDC amount
 * if allowance is short -> send swapTransaction via the wallet.
 * The API key (UNISWAP_API_KEY) and the agent wallet (TEST_PRIVATE_KEY) come
 * from env; without them quote() throws a clear error and swap() is unavailable.
 * No real funds move in tests: fetch and wallet are injectable.
 */
export class UniswapApiExecutor implements SwapExecutor {
  private tokens: Record<string, Address>;
  private tokenDecimals: Record<string, number>;

  constructor(private opts: UniswapExecutorOptions) {
    this.tokens = opts.tokens;
    this.tokenDecimals = opts.tokenDecimals ?? {};
    if (!opts.apiKey) throw new Error("UNISWAP_API_KEY is required for the Uniswap executor");
  }

  async quote(args: { to: string; amountUsdc: number }): Promise<UniswapQuote> {
    const tokenOut = this.tokens[args.to];
    if (!tokenOut) {
      throw new Error(
        `Mock B20 not deployed for ${args.to} — run scripts/deploy-mock-b20.ts first`,
      );
    }
    const amountBaseUnits = BigInt(Math.round(args.amountUsdc * 10 ** USDC_DECIMALS)).toString();
    const res = await (this.opts.fetchFn ?? fetch)(QUOTE_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.opts.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        tokenIn: this.opts.usdc,
        tokenOut,
        tokenInChainId: CHAIN_ID,
        tokenOutChainId: CHAIN_ID,
        amount: amountBaseUnits,
        type: "EXACT_INPUT",
        swapper: this.opts.swapper,
        slippageTolerance: 0.5,
        protocols: ["V2", "V3", "V4"],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Uniswap quote failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      quote?: { output?: { amount?: string }; amountOut?: string };
      swapTransaction?: { to: Address; data: Hex; value: string };
    };
    const amountOutRaw = data.quote?.output?.amount ?? data.quote?.amountOut;
    if (!amountOutRaw) throw new Error("Uniswap quote response has no output amount");
    return {
      amountOut: BigInt(amountOutRaw),
      swapTransaction: data.swapTransaction,
      raw: data,
    };
  }

  async swap(args: { from: "USDC"; to: string; amountUsdc: number }): Promise<SwapResult> {
    if (!this.opts.walletClient || !this.opts.publicClient) {
      throw new Error("Wallet client is not configured — set TEST_PRIVATE_KEY to execute swaps");
    }
    const q = await this.quote(args);
    const amountBaseUnits = BigInt(Math.round(args.amountUsdc * 10 ** USDC_DECIMALS));

    // Permit2 must be allowed to pull the USDC. Approve exactly the swap amount.
    const allowance = (await this.opts.publicClient.readContract({
      address: this.opts.usdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.opts.swapper, SEPOLIA_ADDRESSES.permit2],
    })) as bigint;
    if (allowance < amountBaseUnits) {
      const approveHash = await this.opts.walletClient.sendTransaction({
        to: this.opts.usdc,
        data: encodeApprove(SEPOLIA_ADDRESSES.permit2, amountBaseUnits),
        value: 0n,
      });
      await this.opts.walletClient.waitForTransactionReceipt({ hash: approveHash });
    }

    let tx = q.swapTransaction;
    if (!tx) {
      // No transaction in the quote: ask /v1/swap for one from the same quote.
      const res = await (this.opts.fetchFn ?? fetch)(SWAP_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.opts.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ quote: q.raw }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Uniswap swap failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { swapTransaction?: UniswapQuote["swapTransaction"] };
      tx = data.swapTransaction;
      if (!tx) throw new Error("Uniswap /swap response has no swapTransaction");
    }

    const hash = await this.opts.walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value ?? "0"),
    });
    const receipt = await this.opts.walletClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Swap transaction reverted: ${hash}`);
    const decimals = this.tokenDecimals[args.to] ?? 18;
    return { received: Number(q.amountOut) / 10 ** decimals, txHash: hash };
  }
}

/** Minimal ERC20 approve calldata: approve(spender, amount). */
export function encodeApprove(spender: Address, amount: bigint): Hex {
  const selector = "0x095ea7b3";
  const spenderWord = spender.slice(2).padStart(64, "0");
  const amountWord = amount.toString(16).padStart(64, "0");
  return `${selector}${spenderWord}${amountWord}` as Hex;
}
