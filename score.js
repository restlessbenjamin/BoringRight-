// Scoring model shared by the app (browser) and the tests (Node).
//
// What is known: printed odds for every prize tier, and how many top prizes
// have been claimed out of the total. What is not published: how many tickets
// are still unsold. So the current top-prize odds are an estimate:
//
//   current odds = printed odds x (share of top prizes left) / (share of tickets left)
//
// The share of tickets sold is estimated from two things:
//   1. the game's own claims, claimed / total. With only 3 or 4 top prizes this
//      says very little, since they can all turn up early or all late.
//   2. how old the game is (game.launch, its start date; a game without one
//      is placed by its number, since numbers are issued in launch order).
//      Games that went on sale around the same time have, pooled together, a
//      far steadier claimed share than any one of them.
// The two are blended: a game with few top prizes leans on its age group, a
// game with hundreds leans on its own count.

const PRIOR_WEIGHT = 4; // the age group counts as much as 4 top prizes of evidence
const MAX_SOLD = 0.95;  // never assume a game still on sale is fully sold

const bestRow = (game) => [...(game.tops || [])].sort((a, b) => b.total - a.total)[0];

/**
 * Sets game.soldPrior on every game: the claimed share of top prizes among
 * games launched around the same time (nearest in start-date order), not
 * counting the game itself. Call once on the full active list.
 */
export function addSoldPriors(games, { band = 6, rowCap = 10 } = {}) {
  const rows = games.map((game) => ({ game, t: bestRow(game) })).filter((r) => r.t?.total > 0).sort((a, b) => a.game.num - b.game.num);
  // Order by start date. A game with no date borrows the date of the nearest-numbered game that has one.
  const dated = rows.filter((r) => r.game.launch);
  for (const r of rows) {
    const src = r.game.launch ? r : dated.reduce((best, d) => (!best || Math.abs(d.game.num - r.game.num) < Math.abs(best.game.num - r.game.num) ? d : best), null);
    r.when = src ? Date.parse(src.game.launch) : 0;
  }
  rows.sort((a, b) => a.when - b.when || a.game.num - b.game.num);
  rows.forEach((r, i) => {
    let k = 0, n = 0;
    rows.forEach((o, j) => {
      if (i === j) return;
      // Weight by closeness in launch order; cap each game so one with a huge prize count cannot swamp the rest.
      const w = Math.exp(-0.5 * ((i - j) / band) ** 2) * Math.min(o.t.total, rowCap);
      k += w * (o.t.claimed / o.t.total);
      n += w;
    });
    r.game.soldPrior = n > 0 ? k / n : null;
  });
  return games;
}

/** Estimated share of the print run already sold. */
export function soldEstimate(game) {
  const t = bestRow(game);
  if (!t || !t.total) return game.soldPrior ?? 0;
  if (game.soldPrior == null) return t.claimed / (t.total + 1); // no age information
  return Math.min(MAX_SOLD, (t.claimed + PRIOR_WEIGHT * game.soldPrior) / (t.total + PRIOR_WEIGHT));
}

/**
 * Multiplier applied to the printed top-prize probability: share of prizes
 * left over share of tickets left. 0 when every top prize is claimed. Above 1
 * means prizes have been claimed more slowly than tickets have sold.
 */
export function topPrizeFactor(claimed, total, sold = claimed / (total + 1)) {
  if (!total || total <= 0) return 1;
  if (claimed >= total) return 0;
  return (total - claimed) / total / (1 - Math.min(sold, MAX_SOLD));
}

/** Per-game numbers. Returns null when the game has no odds table. */
export function analyze(game) {
  const o = game.odds;
  if (!o || !o.tiers?.length || !game.price) return null;
  const tiers = o.tiers.map((t) => ({ ...t, p: 1 / t.odds, factor: 1 }));
  const cash = tiers.filter((t) => !t.ticket);
  const tops = [...(game.tops || [])].sort((a, b) => (b.prize || 0) - (a.prize || 0));
  const sold = soldEstimate(game);
  const useAge = game.soldPrior != null;
  tops.forEach((top, i) => {
    let tier = cash.find((t) => t.prize === top.prize && !t.top);
    if (!tier && i === 0) tier = cash[cash.length - 1]; // listed top prize differs from the table's
    if (tier) {
      tier.top = top;
      tier.factor = useAge ? topPrizeFactor(top.claimed, top.total, sold) : topPrizeFactor(top.claimed, top.total);
    }
  });
  for (const t of tiers) t.pNow = t.p * t.factor;
  const best = cash[cash.length - 1];
  const atLeast = (x, hi = Infinity) => cash.filter((t) => t.prize >= x && t.prize < hi).reduce((s, t) => s + t.pNow, 0);
  const ev = tiers.reduce((s, t) => s + t.prize * t.pNow, 0);
  return {
    game,
    price: game.price,
    tiers,
    topPrize: best.prize,
    topLabel: best.label || null,
    topLeft: best.top ? best.top.total - best.top.claimed : null,
    topTotal: best.top ? best.top.total : null,
    pTop: best.pNow,
    pTopPrinted: best.p,
    pAny: o.overall ? 1 / o.overall : tiers.reduce((s, t) => s + t.p, 0),
    overall: o.overall,
    returnRate: ev / game.price,
    sold,
    agePrior: game.soldPrior ?? null,
    topFactor: best.factor,
    atLeast,
  };
}

export const GRAND_PRIZE_MIN = 100000;

export const METRICS = {
  // Grand prizes only: a $100 top prize is not what anyone means by "jackpot".
  jackpot: { label: "Grand prize", value: (a) => (a.topPrize >= GRAND_PRIZE_MIN ? a.pTop / a.price : 0) },
  big: { label: "$1M+", value: (a) => a.atLeast(1000000) / a.price },
  mid: { label: "$500–$50K", value: (a) => a.atLeast(500, 100000) / a.price },
  any: { label: "Any win", value: (a) => a.pAny / a.price },
  ret: { label: "Return", value: (a) => a.returnRate },
};

/** Rank analysed games by a per-dollar metric; score is 0-100 relative to the best in the set. */
export function rank(analyses, valueFn) {
  const rows = analyses.map((a) => ({ a, v: valueFn(a) })).filter((r) => r.v > 0).sort((x, y) => y.v - x.v);
  const max = rows[0]?.v || 1;
  return rows.map((r) => ({ ...r, score: Math.round((r.v / max) * 100) }));
}

export const PRIZE_LEVELS = [100, 500, 1000, 5000, 10000, 100000, 1000000];

/** For each prize level, the games most likely per dollar to pay at least that much. */
export function bestByPrize(analyses, levels = PRIZE_LEVELS) {
  return levels
    .map((level) => ({ level, rows: rank(analyses, (a) => a.atLeast(level) / a.price) }))
    .filter((x) => x.rows.length);
}

/** Same checks the data pipeline uses, for odds tables read on the phone. */
export function oddsProblems(odds, game) {
  const p = [];
  const cash = odds.tiers.filter((t) => !t.ticket);
  if (!odds.overall) p.push("no overall odds");
  if (cash.length < 2) p.push("too few prize tiers");
  for (let i = 1; i < cash.length; i++)
    if (cash[i].prize <= cash[i - 1].prize) { p.push("prizes not increasing"); break; }
  if (odds.overall && odds.tiers.every((t) => t.odds > 0)) {
    const ratio = odds.tiers.reduce((s, t) => s + 1 / t.odds, 0) * odds.overall;
    if (ratio < 0.9 || ratio > 1.06) p.push("tier odds do not add up to the overall odds");
  }
  return p;
}
