# peerline

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dinaloripek/peerline/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dinaloripek/peerline/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Peerline is a token launch radar over make.fun's sealed DefiLlama snapshot (758 protocols, fetched 2026-11-14). It ranks **all 198 protocols that record no token and are not a wrapped, staked or bridged product of one that trades** — the whole 40-protocol watchlist plus 158 early finds below its $50M floor — by an implied token value, and gives every row a concrete farm plan.

The pricing is one function of the snapshot's own figures, printed on the dashboard so any row can be recomputed by hand:

```
implied value = TVL × peer multiple × growth × maturity
```

- **Peer multiple** — the median market-cap / TVL of the snapshot's live-token protocols in the same category (104 peers priced, ratios outside 0.02–5 excluded). A category with fewer than 3 live peers prices with its family (curators and allocators with Yield, CDPs with Lending, staking pools with Liquid Staking) or with the global median, ×0.263.
- **Growth** — `1 + clamp(7-day TVL change, −40%, +60%) × 0.6`.
- **Maturity** — `0.75 + 0.5 × min(days running with no token, 1460) / 1460` (0.9 when the listing day is unknown).

No protocol name is priced by hand. The dashboard is a static page with no network: a sortable, filterable board (search, category, chain, watchlist / early-find tier), a detail view per protocol with its full model breakdown and farm plan, the peer table the multiples came from, and the live-token calibration set the model was priced from. Each farm plan is five steps with a dollar cost and a time for each, generated from the protocol's own category, main chain, TVL tier and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

(Inside the competition kit, the snapshot sits at `../input/snapshot.json` relative to the repository.) The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, and two runs write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hhpn9zak&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
