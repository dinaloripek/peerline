// The Peerline model: a token launch radar over one sealed DefiLlama snapshot.
//
// The board ranks every protocol in the snapshot that records no token and is not a wrapped,
// staked or bridged product of one that trades: the snapshot's whole watchlist (the floor) and
// every other protocol that passes the same cleanliness rules at any size (the radar's reach).
// A protocol that already has a token is never ranked; the top ones are shown apart, as the
// calibration set the model is priced from.
//
// Implied value is priced from the snapshot's own figures, never from a list of names:
//
//   peers      = the live-token protocols in the same category, each one's market cap / TVL,
//                kept when the ratio sits in [0.02, 5] and the protocol holds at least $5M TVL
//   multiple   = the median peer ratio of the protocol's category (at least 3 peers), else of
//                its family (curators and allocators price with Yield, CDPs with Lending,
//                staking pools with Liquid Staking), else the global median of every peer
//   growth     = 1 + clamp(change_7d, -40, 60) / 100 x 0.6     (no reported change: 1)
//   maturity   = 0.75 + 0.5 x min(age_days, 1460) / 1460       (age unknown: 0.9)
//   implied    = round(tvl_usd x multiple x growth x maturity), at least $1
//
// The same function scores every row; the dashboard prints the peer table it used, so a reader
// can recompute any row from the snapshot alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, printed on the dashboard so the pricing can be checked. */
export const MODEL = {
  version: 'peerline-1',
  peer_ratio_min: 0.02,
  peer_ratio_max: 5,
  peer_min_tvl_usd: 5_000_000,
  peer_min_count: 3,
  growth_floor_pct: -40,
  growth_cap_pct: 60,
  growth_weight: 0.6,
  maturity_floor: 0.75,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_maturity: 0.9,
} as const;

/** Category families: a category with too few live peers prices with its family's peers. */
export const FAMILY: Record<string, string> = {
  'Risk Curators': 'Yield',
  'Onchain Capital Allocator': 'Yield',
  'Yield Aggregator': 'Yield',
  'CDP': 'Lending',
  'Staking Pool': 'Liquid Staking',
};

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from the listing day to the snapshot day, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_LEAD = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * The watchlist's own cleanliness rules, applied at any size: a protocol is a launch candidate
 * when it records no token and is not a wrapped, staked or bridged product of a token that
 * already trades, not a versioned pool of another protocol, and not an exchange's own product.
 */
export function isClean(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_LEAD.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** One category's peer set: how many live protocols priced it, and their median cap/TVL. */
export interface PeerStat {
  peers: number;
  median: number;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Every category's peer stat, and the global one, from the snapshot's live-token protocols. */
export function peerStats(snapshot: Snapshot): { byCategory: Map<string, PeerStat>; global: PeerStat } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (p.tvl_usd < MODEL.peer_min_tvl_usd) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < MODEL.peer_ratio_min || ratio > MODEL.peer_ratio_max) continue;
    const cat = p.category ?? '(uncategorised)';
    const list = ratios.get(cat) ?? [];
    list.push(ratio);
    ratios.set(cat, list);
    all.push(ratio);
  }
  const byCategory = new Map<string, PeerStat>();
  for (const [cat, list] of ratios) {
    list.sort((a, b) => a - b);
    byCategory.set(cat, { peers: list.length, median: median(list) });
  }
  all.sort((a, b) => a - b);
  return { byCategory, global: { peers: all.length, median: median(all) } };
}

/** Where a multiple came from: the category's own peers, its family's, or the whole market's. */
export type MultipleSource = 'category' | 'family' | 'global';

export interface Multiple {
  value: number;
  source: MultipleSource;
  peers: number;
  priced_as: string;
}

/** The multiple one protocol prices at, by the fallback order the model states. */
export function multipleFor(category: string | null, stats: { byCategory: Map<string, PeerStat>; global: PeerStat }): Multiple {
  const cat = category ?? '(uncategorised)';
  const own = stats.byCategory.get(cat);
  if (own !== undefined && own.peers >= MODEL.peer_min_count) {
    return { value: own.median, source: 'category', peers: own.peers, priced_as: cat };
  }
  const family = category !== null ? FAMILY[category] : undefined;
  if (family !== undefined) {
    const fam = stats.byCategory.get(family);
    if (fam !== undefined && fam.peers >= MODEL.peer_min_count) {
      return { value: fam.median, source: 'family', peers: fam.peers, priced_as: family };
    }
  }
  return { value: stats.global.median, source: 'global', peers: stats.global.peers, priced_as: 'all categories' };
}

/** The three factors and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  mult: Multiple,
): { implied: number; growthFactor: number; maturityFactor: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const raw = p.change_7d ?? 0;
  const growthPct = Math.min(MODEL.growth_cap_pct, Math.max(MODEL.growth_floor_pct, raw));
  const growthFactor = 1 + (growthPct / 100) * MODEL.growth_weight;
  const maturityFactor = age === null
    ? MODEL.unknown_age_maturity
    : MODEL.maturity_floor + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * mult.value * growthFactor * maturityFactor));
  return { implied, growthFactor, maturityFactor, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: 'watchlist' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: MultipleSource;
    priced_as: string;
    peers: number;
    growth_factor: number;
    maturity_factor: number;
  };
  farm_steps: string[];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Gas for one simple transaction on a chain, in dollars, as a planning estimate. */
const GAS_USD: Record<string, number> = {
  Ethereum: 9, Solana: 0.02, Base: 0.08, Arbitrum: 0.12, Optimism: 0.1, Polygon: 0.02,
  BSC: 0.06, Avalanche: 0.25, Linea: 0.15, Scroll: 0.2, Mantle: 0.05, Gnosis: 0.01,
  'zkSync Era': 0.1, Starknet: 0.15, Sui: 0.01, Aptos: 0.01, Tron: 0.3, TON: 0.02,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

type Playbook = (p: SnapshotProtocol, capital: number, chain: string, gas: number) => { core: string; weekly: string };

const PLAYBOOKS: Record<string, Playbook> = {
  curator: (p, capital, chain, gas) => ({
    core: `Deposit ${money(capital)} of USDC into a ${p.name} vault on ${chain} and keep the vault shares in the wallet; the curator routes the funds across lending markets, and the shares are the position a points program can see.`,
    weekly: `Move about $25 between two ${p.name} vaults, or top the position up by $10, so the wallet shows recurring deposits rather than one parked sum.`,
  }),
  dexs: (p, capital, chain, gas) => ({
    core: `Swap ${money(capital)} of USDC for the chain's main asset on ${p.name}, then provide the pair as liquidity in its main pool on ${chain} and keep the LP position open.`,
    weekly: `Make two swaps of about $25 each on ${p.name}, on different days, so the wallet builds a trading history and not a single visit.`,
  }),
  lending: (p, capital, chain, gas) => ({
    core: `Supply ${money(capital)} of USDC to ${p.name} on ${chain}, then borrow about 30% of it against the position and supply the borrowed funds back once, the loop borrowers are counted by.`,
    weekly: `Repay a small part of the borrow and draw it again, or add $10 of supply, keeping the health factor comfortably above the app's warning line.`,
  }),
  cdp: (p, capital, chain, gas) => ({
    core: `Deposit ${money(capital)} of the chain's main asset as collateral in ${p.name} on ${chain} and mint about 40% of its value in the protocol's stablecoin, keeping the collateral ratio well above liquidation.`,
    weekly: `Adjust the position once: repay a little minted debt or add $10 of collateral, so the vault shows an active manager and not an abandoned one.`,
  }),
  derivatives: (p, capital, chain, gas) => ({
    core: `Deposit ${money(capital)} of USDC as margin on ${p.name} and open one small long and one small short on its main market, hedged against each other, so volume accrues without a directional bet.`,
    weekly: `Close and reopen one leg of about $25 notional, keeping total open interest small and the margin ratio above half.`,
  }),
  rwa: (p, capital, chain, gas) => ({
    core: `Mint ${money(capital)} of ${p.name}'s yield asset on ${chain} through its own app, completing the onboarding the app asks for first, and hold the asset in the wallet.`,
    weekly: `Mint or redeem a further $10 so the wallet shows a second interaction, and read the protocol's own rewards page for a holder program.`,
  }),
  yield: (p, capital, chain, gas) => ({
    core: `Deposit ${money(capital)} of USDC into ${p.name}'s main strategy on ${chain} and keep the strategy shares; yield strategies count depositors and the length of the deposit.`,
    weekly: `Harvest or compound the yield once, or add $10, so the position shows management and not a forgotten deposit.`,
  }),
  prediction: (p, capital, chain, gas) => ({
    core: `Fund ${money(capital)} on ${p.name} and place positions on at least three open markets, sized about $10 each, favouring markets that settle within the month.`,
    weekly: `Place one new position of about $10 on a fresh market and settle or roll any position that has ended.`,
  }),
  staking: (p, capital, chain, gas) => ({
    core: `Stake ${money(capital)} of the chain's staking asset through ${p.name} and keep the receipt token in the wallet; staking programs count the staked balance and its age.`,
    weekly: `Stake a further $10, or claim and restake the rewards, so the staked balance keeps moving up.`,
  }),
  chain: (p, capital, chain, gas) => ({
    core: `Bridge ${money(capital)} to ${p.name}'s chain and hold it there as the chain's gas asset and a stablecoin, then make one transaction in a native app so the wallet is an active chain user.`,
    weekly: `Make two small transactions a week in the chain's own apps, keeping a balance on the chain the whole time.`,
  }),
  generic: (p, capital, chain, gas) => ({
    core: `Deposit ${money(capital)} of USDC into ${p.name} on ${chain} through its own app and keep the position open; a deposit that stays is what most points programs count first.`,
    weekly: `Add $10 to the position or make one more in-app action, so the wallet shows a returning user and not a single visit.`,
  }),
};

function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator') || c.includes('aggregator')) return PLAYBOOKS.curator!;
  if (c.includes('dex')) return PLAYBOOKS.dexs!;
  if (c.includes('cdp')) return PLAYBOOKS.cdp!;
  if (c.includes('lend')) return PLAYBOOKS.lending!;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option')) return PLAYBOOKS.derivatives!;
  if (c.includes('rwa')) return PLAYBOOKS.rwa!;
  if (c.includes('prediction')) return PLAYBOOKS.prediction!;
  if (c.includes('staking') || c.includes('staking pool')) return PLAYBOOKS.staking!;
  if (c === 'chain') return PLAYBOOKS.chain!;
  if (c.includes('yield') || c.includes('basis')) return PLAYBOOKS.yield!;
  return PLAYBOOKS.generic!;
}

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, main chain, TVL, age), never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p);
  const { core, weekly } = book(p, capital, chain, gas);
  return [
    {
      text: `Use a fresh wallet for ${p.name} that holds only the funds you plan to farm, keep its seed phrase offline, and fund it on ${chain}.`,
      cost: `about ${money(gas)} of gas for the funding transaction`,
      time: '5 minutes',
    },
    {
      text: core,
      cost: `${money(capital)} of capital and about ${money(gas * 2)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: `about ${money(gas)} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days and check ${p.name}'s own points or rewards page once a week, screenshotting the balance so the farm is documented.`,
      cost: `the ${money(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Claim only from a link on ${p.name}'s own page or its verified announcement, never from a message that asks you to pay to claim, and log every transaction hash before you unwind.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const stats = peerStats(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isPreToken(p) && (watch.has(p.slug) || isClean(p)));
  const scored = chosen.map((p) => {
    const mult = multipleFor(p.category, stats);
    const { implied, growthFactor, maturityFactor, age } = impliedValue(p, snapshot.as_of, mult);
    return { p, mult, implied, growthFactor, maturityFactor, age };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    tier: watch.has(s.p.slug) ? ('watchlist' as const) : ('early' as const),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.mult.value),
      multiple_source: s.mult.source,
      priced_as: s.mult.priced_as,
      peers: s.mult.peers,
      growth_factor: round4(s.growthFactor),
      maturity_factor: round4(s.maturityFactor),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A live-token protocol shown as calibration: the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** How many live-token protocols the dashboard shows as the calibration set. */
export const LIVE_ROWS = 24;

/** The live-token protocols, by market cap, for the dashboard's calibration strip. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The dashboard's view of one board row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  tier: 'watchlist' | 'early';
  implied_value_usd: number;
  multiple: number;
  multiple_source: MultipleSource;
  priced_as: string;
  peers: number;
  growth_factor: number;
  maturity_factor: number;
  farm_steps: string[];
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  global_peers: number;
  peer_table: { category: string; peers: number; median: number }[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  scanned_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Everything the dashboard needs: the board, the calibration set, and the peer table used. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const stats = peerStats(snapshot);
  const peerTable = [...stats.byCategory.entries()]
    .map(([category, s]) => ({ category, peers: s.peers, median: round4(s.median) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    global_multiple: round4(stats.global.median),
    global_peers: stats.global.peers,
    peer_table: peerTable,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.tier === 'early').length,
    live_size: live.length,
    scanned_size: snapshot.protocols.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      tier: r.tier,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      multiple_source: r.model.multiple_source,
      priced_as: r.model.priced_as,
      peers: r.model.peers,
      growth_factor: r.model.growth_factor,
      maturity_factor: r.model.maturity_factor,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const ordered = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.implied_value_usd > ordered[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && ordered[0]!.implied_value_usd === ordered[ordered.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
