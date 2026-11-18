# Research-to-Treasury Agent

AI research agent for the **Base Stocks Maxxing** competition (track: **Agentic Stock Finance**). It sells stock research reports paid in USDC via **x402** and sweeps profits into **tokenized stocks** (Coinbase B20 tokens) on Base.

- `POST /research` — paywalled by x402 ($0.05 USDC on Base Sepolia). Body: `{ "symbol": "AAPLc" }`. Returns a report with the live price, previous close, and day change.
- `GET /treasury` — the treasury ledger: USDC balance, sales count, holdings.
- `GET /health` — liveness check.

Every paid sale above the sweep reserve is swept into the treasury token (default `AAPLc`).

## Quickstart

```bash
cp .env.example .env   # set PAY_TO_ADDRESS to your Base wallet
pnpm install
pnpm dev               # or: pnpm build && pnpm start
```

Testnet first: `NETWORK=base-sepolia`. No real money moves on testnet; the
paywall uses the x402 testnet facilitator.

## Status (day 2)

What works:

- x402 paywall on `POST /research` (unpaid requests get HTTP 402).
- Research reports for the 10 B20 tickers (`AAPLc NVDAc METAc GOOGLc AMZNc MSFTc MSTRc SNDKc SPCXc TSLAc`).
- Treasury ledger with reserve-aware sweep planning and execution.
- `pnpm test` covers report math, treasury math, the HTTP surface, the
  Uniswap quote/approve/swap flow (mocked), the Chainlink feed map, and the
  MockB20 compilation.

Sweeps, two modes (`SWAP_EXECUTOR`):

- `mock` (default): swaps at the quote price, no chain involved.
- `uniswap`: real swaps on Base Sepolia through the Uniswap Trading API
  (AMM protocols V2/V3/V4 only, so tiny sweeps never need UniswapX signing).
  Needs `UNISWAP_API_KEY` + `TEST_PRIVATE_KEY` + deployed mock B20 tokens
  (see below). The executor approves Permit2 for exactly the swap amount.

Prices, two modes (`PRICE_SOURCE`):

- `mock` (default): fixed example values.
- `chainlink`: live Chainlink total-return feeds on Base mainnet
  (all 10 addresses verified from the official Base docs, in `src/feeds.ts`).

## Mock B20 tokens on Base Sepolia

The real B20 tokens are not deployed on Sepolia, so the demo uses its own
mock ERC20s (`contracts/MockB20.sol`, 18 decimals, permissionless mint —
testnet only, no backing, no real stock).

```bash
pnpm tsx scripts/deploy-mock-b20.ts --dry-run   # compile only, no wallet needed
pnpm tsx scripts/deploy-mock-b20.ts AAPLc NVDAc  # deploy (needs TEST_PRIVATE_KEY + faucet ETH)
```

Deployed addresses land in `deployments/base-sepolia.json`, which the Uniswap
executor reads. Faucet USDC on Sepolia is
`0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle faucet, 6 decimals);
get test USDC + Sepolia ETH from the faucets before deploying or swapping.

Verified on-chain (Base Sepolia, 18 Nov 2026): Universal Router
`0x8b844f885672f333bc0042cb669255f93a4c1e6b`, Permit2
`0x000000000022D473030F116dDEE9F6B43aC78BA3`, faucet USDC above, WETH
`0x4200000000000000000000000000000000000006`. **Aerodrome has no Base
Sepolia deployment** (mainnet only) — it is not used.

What is still mocked or next:

- No Uniswap pool exists yet for USDC/mock-B20 on Sepolia: after deploying
  the mocks, someone must seed a V3 pool (or the quote API finds no route).
- The demo video + submission (X post + form) are still to do.

## Competition

Base Stocks Maxxing, 5 Nov – 5 Dec 2026. Submit by **5 Dec 2026 23:59 UTC** (6 Dec 06:59 WIB): public X post with a demo video tagging `@buildonbase`, plus the official form at [base.org/stocksmaxxing](https://www.base.org/stocksmaxxing). Testnet builds are scored equally; a token is optional.

## License

MIT
