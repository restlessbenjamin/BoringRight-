// Pure parsing helpers shared by the updater and its tests.

const money = (s) => {
  const m = String(s).replace(/[, ]/g, "").match(/^\$?(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
};

/** Pull the embedded game list and the "Data as of" caption out of the Top Prizes Claimed page. */
export function parseTopPrizesPage(html) {
  const m = html.match(/topPrizListArray\s*:\s*JSON\.stringify\((\[[\s\S]*?\])\)/);
  if (!m) throw new Error("Top prizes list not found in page");
  const rows = JSON.parse(m[1]);
  const asOf = (html.match(/Data as of\s+([^<]+)</i) || [])[1]?.trim() || null;
  const byNum = new Map();
  for (const r of rows) {
    const num = parseInt(String(r.gameId).trim(), 10);
    if (!Number.isFinite(num)) continue;
    const name = String(r.gameName).replace(/\*+/g, "").trim();
    const price = money(r.ticketPrice);
    const top = {
      prize: money(r.topPrize),
      label: String(r.topPrize).trim(),
      claimed: parseInt(r.claimed, 10) || 0,
      total: parseInt(r.total, 10) || 0,
    };
    if (!byNum.has(num)) byNum.set(num, { num, name, price, tops: [] });
    byNum.get(num).tops.push(top);
  }
  const games = [...byNum.values()].sort((a, b) => a.num - b.num);
  for (const g of games) g.tops.sort((a, b) => (b.prize || 0) - (a.prize || 0));
  if (games.length < 20) throw new Error(`Only ${games.length} games parsed`);
  return { asOf, games };
}

/** Reasons a prize/odds table should not be trusted. Empty array = looks right. */
export function oddsProblems(odds, game) {
  const p = [];
  const cash = odds.tiers.filter((t) => !t.ticket);
  if (!odds.overall) p.push("no overall odds");
  if (cash.length < 2) p.push("too few prize tiers");
  for (let i = 1; i < cash.length; i++)
    if (cash[i].prize <= cash[i - 1].prize) { p.push("prizes not increasing"); break; }
  const top = game.tops[0]?.prize;
  if (top && cash.length && cash[cash.length - 1].prize !== top) p.push("top prize mismatch");
  if (odds.overall) {
    const sum = odds.tiers.reduce((s, t) => s + 1 / t.odds, 0);
    const ratio = sum * odds.overall;
    if (ratio < 0.9 || ratio > 1.06) p.push(`tier odds don't add up to overall (${ratio.toFixed(2)})`);
  }
  return p;
}
