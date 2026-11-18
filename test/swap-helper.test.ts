import { describe, expect, it, vi } from "vitest";
import { HelperSwapExecutor } from "../src/swap";
import { compileSwapHelper } from "../scripts/deploy-swap-helper";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const AAPLC = "0x1111111111111111111111111111111111111111" as const;
const POOL = "0x3333333333333333333333333333333333333333" as const;
const HELPER = "0x4444444444444444444444444444444444444444" as const;
const SWAPPER = "0x2222222222222222222222222222222222222222" as const;

// QuoterV2 returns (amountOut, sqrtPriceX96After, ticksCrossed, gasEstimate).
const quoterTuple = [178000000000000000n, 123n, 0, 100000n] as const;

describe("compileSwapHelper", () => {
  it("compiles and exposes the swap + callback functions", () => {
    const { abi, bytecode } = compileSwapHelper();
    expect(bytecode.length).toBeGreaterThan(100);
    const names = (abi as { name: string }[]).map((e) => e.name);
    expect(names).toContain("swapExactInputSingle");
    expect(names).toContain("uniswapV3SwapCallback");
  });
});

describe("HelperSwapExecutor", () => {
  it("reads the quote amount from QuoterV2", async () => {
    const publicClient = { readContract: vi.fn(async () => quoterTuple) };
    const ex = new HelperSwapExecutor({
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      pools: { AAPLc: POOL },
      helper: HELPER,
      swapper: SWAPPER,
      publicClient: publicClient as never,
    });
    const q = await ex.quote({ to: "AAPLc", amountUsdc: 50 });
    expect(q.amountOut).toBe(178000000000000000n);
  });

  it("throws a clear error when no pool is seeded for the symbol", async () => {
    const publicClient = { readContract: vi.fn(async () => quoterTuple) };
    const ex = new HelperSwapExecutor({
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      pools: {},
      helper: HELPER,
      swapper: SWAPPER,
      publicClient: publicClient as never,
      walletClient: {
        sendTransaction: vi.fn(async () => "0xhash" as const),
        waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
      } as never,
    });
    await expect(ex.swap({ from: "USDC", to: "AAPLc", amountUsdc: 50 })).rejects.toThrow(
      "No seeded pool",
    );
  });

  it("approves the helper (not the router) then calls swapExactInputSingle on it", async () => {
    const publicClient = {
      readContract: vi.fn(async (args: { functionName: string }) =>
        args.functionName === "allowance" ? 0n : quoterTuple,
      ),
    };
    const sent: { to: string; data: string; value: bigint }[] = [];
    const walletClient = {
      sendTransaction: vi.fn(async (tx: { to: string; data: string; value: bigint }) => {
        sent.push(tx);
        return "0xhash" as const;
      }),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    const ex = new HelperSwapExecutor({
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      pools: { AAPLc: POOL },
      helper: HELPER,
      swapper: SWAPPER,
      publicClient: publicClient as never,
      walletClient: walletClient as never,
    });
    const result = await ex.swap({ from: "USDC", to: "AAPLc", amountUsdc: 50 });
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe(USDC); // approve
    expect(sent[0].data.startsWith("0x095ea7b3")).toBe(true);
    expect(sent[0].data.slice(10, 74)).toBe(
      `000000000000000000000000${HELPER.slice(2).toLowerCase()}`,
    ); // spender = helper (first arg word after the selector)
    expect(sent[1].to).toBe(HELPER); // swap goes to the helper, not the router
    expect(result.txHash).toBe("0xhash");
    expect(result.received).toBeCloseTo(0.178, 6);
  });

  it("skips the approval when allowance already covers the swap", async () => {
    const publicClient = {
      readContract: vi.fn(async (args: { functionName: string }) =>
        args.functionName === "allowance" ? 10n ** 12n : quoterTuple,
      ),
    };
    const walletClient = {
      sendTransaction: vi.fn(async () => "0xhash" as const),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    const ex = new HelperSwapExecutor({
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      pools: { AAPLc: POOL },
      helper: HELPER,
      swapper: SWAPPER,
      publicClient: publicClient as never,
      walletClient: walletClient as never,
    });
    await ex.swap({ from: "USDC", to: "AAPLc", amountUsdc: 50 });
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(1);
  });
});
