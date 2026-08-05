# XAU/USD dynamic PAPER sizing policy

- Maximum requested PAPER exposure: 30 EUR.
- Selected exposure depends on cabinet consensus, projected reward/risk, volatility regime and aggregate XAU exposure headroom.
- Elevated volatility reduces size.
- Event lockout reduces size to zero through the existing cabinet veto.
- Aggregate XAU PAPER exposure is capped at 30% of PAPER equity.
- Signals below the 5 EUR operational minimum are rejected rather than rounded up.
- Correlated or repeated signals must consume the same aggregate exposure headroom; they are not free independent bets.
- LIVE trading and real order submission remain disabled.

## Expansion to other markets

The same architecture may be reused in DEMO only after each market has its own evidence adapter, spread/cost model, invalidation logic, specialist decision policy, persistent position ledger and aggregate correlation limits. XAU thresholds must not be copied blindly to crypto, equities or FX.