import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { topPrizeFactor, analyze, rank, bestByPrize, METRICS, oddsProblems } from "../score.js";
import { parseTopPrizesPage } from "./lib.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../data/games.json", import.meta.url), "utf8"));
const game = (n) => data.games.find((g) => g.num === n);

test("top prize factor", () => {
  assert.equal(topPrizeFactor(0, 3), 1); // nothing claimed: printed odds stand
  assert.equal(topPrizeFactor(3, 3), 0); // all claimed: no chance
  assert.ok(Math.abs(topPrizeFactor(2, 3) - 2 / 3) < 1e-9);
  assert.ok(topPrizeFactor(20, 21) > 1 / 21 && topPrizeFactor(20, 21) < 1);
});

test("every stored odds table is plausible", () => {
  // A brand-new game may have no table yet (odds: null); the app reads those on demand.
  const withOdds = data.games.filter((g) => g.odds);
  assert.ok(withOdds.length >= data.games.length * 0.8, "most games have odds tables");
  for (const g of withOdds) assert.deepEqual(oddsProblems(g.odds, g), [], `${g.num} ${g.name}`);
});

test("analyze: Millionaire Maker matches hand calculation", () => {
  const g = structuredClone(game(1843));
  g.tops = [{ prize: 1000000, claimed: 10, total: 19 }];
  const a = analyze(g);
  assert.equal(a.topPrize, 1000000);
  assert.equal(a.topLeft, 9);
  assert.ok(Math.abs(1 / a.pTop - 500000) < 1000, `1 in ${1 / a.pTop}`);
  assert.ok(a.returnRate > 0.8 && a.returnRate < 0.87, `return ${a.returnRate}`);
});

test("analyze: two-row game adjusts both listed prizes", () => {
  const a = analyze(game(1737));
  const adjusted = a.tiers.filter((t) => t.top).map((t) => t.prize);
  assert.deepEqual(adjusted, [1000000, 7000000]);
});

test("a game with every top prize claimed drops out of the jackpot ranking", () => {
  const g = structuredClone(game(1843));
  g.tops = [{ prize: 1000000, claimed: 19, total: 19 }];
  assert.equal(rank([analyze(g)], METRICS.jackpot.value).length, 0);
});

test("rankings are sorted and scored against the best", () => {
  const all = data.games.map(analyze).filter(Boolean);
  for (const m of Object.values(METRICS)) {
    const rows = rank(all, m.value);
    assert.equal(rows[0].score, 100);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].v >= rows[i].v);
  }
  assert.ok(bestByPrize(all).every((b) => b.rows.length > 0));
});

test("page parser reads the embedded list and merges duplicate game rows", () => {
  const html = `<caption>Data as of Sunday, November 8, 2026</caption><script>x({ topPrizListArray  : JSON.stringify([` +
    Array.from({ length: 20 }, (_, i) => `{"gameId":"${2000 + i}","gameName":"G${i}","ticketPrice":"$5","topPrize":"$100,000","claimed":"1","total":"3"}`).join(",") +
    `,{"gameId":"1737 ","gameName":"Club**","ticketPrice":"$30","topPrize":"$1,000,000","claimed":"15","total":"22"}` +
    `,{"gameId":"1737","gameName":"Club**","ticketPrice":"$30","topPrize":"$7,000,000","claimed":"3","total":"4"}]) });</script>`;
  const { asOf, games } = parseTopPrizesPage(html);
  assert.equal(asOf, "Sunday, November 8, 2026");
  assert.equal(games.length, 21);
  const club = games.find((g) => g.num === 1737);
  assert.equal(club.name, "Club");
  assert.deepEqual(club.tops.map((t) => t.prize), [7000000, 1000000]);
});
