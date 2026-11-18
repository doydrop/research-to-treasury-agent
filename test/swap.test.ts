import { describe, expect, it, vi } from "vitest";
import { UniswapApiExecutor, DirectSwapExecutor, encodeApprove } from "../src/swap";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const AAPLC = "0x1111111111111111111111111111111111111111" as const;
const SWAPPER = "0x2222222222222222222222222222222222222222" as const;

// Shape of a documented Uniswap Trading API /v1/quote response (CLASSIC AMM route).
function mockQuoteResponse() {
  return {
    quote: { output: { amount: "178000000000000000" } },
    swapTransaction: {
      to: "0x8b844f885672f333bc0042cb669255f93a4c1e6b",
      data: "0xdeadbeef",
      value: "0",
    },
  };
}

describe("UniswapApiExecutor", () => {
  it("parses the quote output amount", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockQuoteResponse()), { status: 200 }),
    );
    const ex = new UniswapApiExecutor({
      apiKey: "test-key",
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      swapper: SWAPPER,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const q = await ex.quote({ to: "AAPLc", amountUsdc: 50 });
    expect(q.amountOut).toBe(178000000000000000n);
    expect(q.swapTransaction?.to).toBe("0x8b844f885672f333bc0042cb669255f93a4c1e6b");
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.tokenInChainId).toBe(84532);
    expect(body.protocols).toEqual(["V2", "V3", "V4"]);
    expect(body.amount).toBe("50000000"); // 50 USDC, 6 decimals
  });

  it("throws a clear error when the token is not deployed", async () => {
    const ex = new UniswapApiExecutor({
      apiKey: "test-key",
      usdc: USDC,
      tokens: {},
      swapper: SWAPPER,
    });
    await expect(ex.quote({ to: "AAPLc", amountUsdc: 1 })).rejects.toThrow("not deployed");
  });

  it("approves Permit2 when allowance is short, then sends the swap tx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockQuoteResponse()), { status: 200 }),
    );
    const sent: { to: string; data: string; value: bigint }[] = [];
    const walletClient = {
      sendTransaction: vi.fn(async (tx: { to: string; data: string; value: bigint }) => {
        sent.push(tx);
        return "0xhash" as const;
      }),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    const publicClient = {
      readContract: vi.fn(async () => 0n), // no allowance
    };
    const ex = new UniswapApiExecutor({
      apiKey: "test-key",
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      swapper: SWAPPER,
      fetchFn: fetchFn as unknown as typeof fetch,
      publicClient: publicClient as never,
      walletClient: walletClient as never,
    });
    const result = await ex.swap({ from: "USDC", to: "AAPLc", amountUsdc: 50 });
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe(USDC); // approve
    expect(sent[0].data.startsWith("0x095ea7b3")).toBe(true);
    expect(sent[1].to).toBe("0x8b844f885672f333bc0042cb669255f93a4c1e6b"); // router
    expect(result.txHash).toBe("0xhash");
    expect(result.received).toBeCloseTo(0.178, 6);
  });

  it("skips the approval when allowance already covers the swap", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockQuoteResponse()), { status: 200 }),
    );
    const walletClient = {
      sendTransaction: vi.fn(async () => "0xhash" as const),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    const publicClient = {
      readContract: vi.fn(async () => 10n ** 12n), // plenty
    };
    const ex = new UniswapApiExecutor({
      apiKey: "test-key",
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      swapper: SWAPPER,
      fetchFn: fetchFn as unknown as typeof fetch,
      publicClient: publicClient as never,
      walletClient: walletClient as never,
    });
    await ex.swap({ from: "USDC", to: "AAPLc", amountUsdc: 50 });
    expect(walletClient.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("encodeApprove builds correct ERC20 approve calldata", () => {
    const data = encodeApprove("0x000000000022D473030F116dDEE9F6B43aC78BA3", 50000000n);
    expect(data.startsWith("0x095ea7b3")).toBe(true);
    expect(data.endsWith("02faf080")).toBe(true); // 50000000 in hex
  });
});

describe("DirectSwapExecutor", () => {
  // QuoterV2 returns (amountOut, sqrtPriceX96After, ticksCrossed, gasEstimate).
  const quoterTuple = [178000000000000000n, 123n, 0, 100000n] as const;

  it("reads the quote amount from QuoterV2", async () => {
    const publicClient = { readContract: vi.fn(async () => quoterTuple) };
    const ex = new DirectSwapExecutor({
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      swapper: SWAPPER,
      publicClient: publicClient as never,
    });
    const q = await ex.quote({ to: "AAPLc", amountUsdc: 50 });
    expect(q.amountOut).toBe(178000000000000000n);
    const call = publicClient.readContract.mock.calls[0][0] as { address: string; functionName: string };
    expect(call.address).toBe("0xC5290058841028F1614F3A6F0F5816cAd0df5E27");
    expect(call.functionName).toBe("quoteExactInputSingle");
  });

  it("approves the router (not Permit2) then sends exactInputSingle", async () => {
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
    const ex = new DirectSwapExecutor({
      usdc: USDC,
      tokens: { AAPLc: AAPLC },
      swapper: SWAPPER,
      publicClient: publicClient as never,
      walletClient: walletClient as never,
    });
    const result = await ex.swap({ from: "USDC", to: "AAPLc", amountUsdc: 50 });
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe(USDC); // approve
    expect(sent[0].data.startsWith("0x095ea7b3")).toBe(true);
    expect(sent[1].to).toBe("0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"); // SwapRouter02
    expect(sent[1].data.startsWith("0x414bf389")).toBe(true); // exactInputSingle selector
    expect(result.txHash).toBe("0xhash");
    expect(result.received).toBeCloseTo(0.178, 6);
  });
});
