export interface Holding {
  symbol: string;
  amount: number;
  avgCostUsd: number;
}

export interface SweepPlan {
  amountUsdc: number;
  targetSymbol: string;
  status: "planned";
}

export interface SwapResult {
  received: number;
  txHash: string;
}

export interface SwapExecutor {
  swap(args: { from: "USDC"; to: string; amountUsdc: number }): Promise<SwapResult>;
}

/**
 * In-memory treasury ledger. USDC earned from x402 research sales lands
 * here; sweep() moves everything above the reserve into a tokenized stock.
 */
export class Treasury {
  private usdcBalance = 0;
  private holdings = new Map<string, Holding>();
  private sales = 0;

  recordSale(amountUsdc: number): void {
    if (!(amountUsdc > 0)) throw new Error("Sale amount must be positive");
    this.usdcBalance = round2(this.usdcBalance + amountUsdc);
    this.sales += 1;
  }

  planSweep(targetSymbol: string, reserveUsdc: number): SweepPlan | null {
    const sweepable = round2(this.usdcBalance - reserveUsdc);
    if (sweepable <= 0) return null;
    return { amountUsdc: sweepable, targetSymbol, status: "planned" };
  }

  async executeSweep(plan: SweepPlan, executor: SwapExecutor): Promise<SwapResult> {
    const result = await executor.swap({ from: "USDC", to: plan.targetSymbol, amountUsdc: plan.amountUsdc });
    this.usdcBalance = round2(this.usdcBalance - plan.amountUsdc);
    const prev = this.holdings.get(plan.targetSymbol);
    const price = plan.amountUsdc / result.received;
    const prevAmount = prev?.amount ?? 0;
    const prevCost = prev ? prev.amount * prev.avgCostUsd : 0;
    const totalAmount = prevAmount + result.received;
    this.holdings.set(plan.targetSymbol, {
      symbol: plan.targetSymbol,
      amount: round6(totalAmount),
      avgCostUsd: totalAmount > 0 ? round2((prevCost + plan.amountUsdc) / totalAmount) : round2(price),
    });
    return result;
  }

  snapshot(): { usdcBalance: number; sales: number; holdings: Holding[] } {
    return { usdcBalance: this.usdcBalance, sales: this.sales, holdings: [...this.holdings.values()] };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Token amounts are tiny fractions of a share — 2 decimals would round them to 0.
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Test/demo executor: swaps at the mock price, no chain involved. */
export class MockSwapExecutor implements SwapExecutor {
  private n = 0;

  constructor(private priceUsd: number) {}

  async swap(args: { from: "USDC"; to: string; amountUsdc: number }): Promise<SwapResult> {
    this.n += 1;
    return { received: round6(args.amountUsdc / this.priceUsd), txHash: `mock-tx-${this.n}` };
  }
}
