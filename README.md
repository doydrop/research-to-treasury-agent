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

## Status (scaffold, day 1)

What works:

- x402 paywall on `POST /research` (unpaid requests get HTTP 402).
- Research reports for the 10 B20 tickers (`AAPLc NVDAc METAc GOOGLc AMZNc MSFTc MSTRc SNDKc SPCXc TSLAc`).
- Treasury ledger with reserve-aware sweep planning and execution.
- `pnpm test` covers report math, treasury math, and the HTTP surface.

What is still mocked or next:

- Prices come from `MockPriceProvider` (fixed example values). `ChainlinkPriceProvider` (in `src/prices.ts`) reads a Chainlink total-return feed on Base — wire it with `FEED_<SYMBOL>` addresses.
- Sweeps execute through `MockSwapExecutor` (no chain). The on-chain executor (0x / Aerodrome on Base Sepolia) is the next milestone, plus mock B20 tokens on Sepolia (no official B20 testnet deployment is published yet).
- No token launch: the agent itself holds the treasury; no new token is created.

## Competition

Base Stocks Maxxing, 5 Nov – 5 Dec 2026. Submit by **5 Dec 2026 23:59 UTC** (6 Dec 06:59 WIB): public X post with a demo video tagging `@buildonbase`, plus the official form at [base.org/stocksmaxxing](https://www.base.org/stocksmaxxing). Testnet builds are scored equally; a token is optional.

## License

MIT
