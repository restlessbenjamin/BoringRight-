import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { topPrizeFactor, analyze, rank, bestByPrize, METRICS, oddsProblems, addSoldPriors, soldEstimate } from "../score.js";
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

test("age: of two games with the same claims, the older one is further sold and has better top-prize odds", () => {
  const mk = (num, claimed, total) => ({ num, name: "G" + num, price: 5, tops: [{ prize: 100000, claimed, total }] });
  // Launch order 1..20: old games mostly claimed out, new games barely touched.
  const games = Array.from({ length: 20 }, (_, i) => mk(i + 1, i < 10 ? 9 : 1, 10));
  const old = mk(0, 2, 4), young = mk(21, 2, 4);
  addSoldPriors([old, ...games, young]);
  assert.ok(old.soldPrior > 0.8 && young.soldPrior < 0.2, `${old.soldPrior} ${young.soldPrior}`);
  assert.ok(soldEstimate(old) > soldEstimate(young));
  assert.ok(topPrizeFactor(2, 4, soldEstimate(old)) > 1); // half the prizes left in well under half the tickets
  assert.ok(topPrizeFactor(2, 4, soldEstimate(young)) < 1);
});

test("age: a game with many top prizes relies on its own count, and sold share is capped", () => {
  const big = { num: 5, name: "Big", price: 5, tops: [{ prize: 500, claimed: 500, total: 1000 }], soldPrior: 0.9 };
  assert.ok(Math.abs(soldEstimate(big) - 0.5) < 0.01);
  const done = { num: 6, name: "Done", price: 5, tops: [{ prize: 500, claimed: 999, total: 1000 }], soldPrior: 0.99 };
  assert.equal(soldEstimate(done), 0.95);
  assert.equal(topPrizeFactor(3, 3, 0.5), 0);
});

test("age: every real game gets a prior and a sane factor", () => {
  const games = addSoldPriors(structuredClone(data.games));
  for (const g of games) assert.ok(g.soldPrior >= 0 && g.soldPrior <= 1, `${g.num}`);
  for (const a of games.map(analyze).filter(Boolean)) assert.ok(a.topFactor >= 0 && a.topFactor < 4, `${a.game.num} x${a.topFactor}`);
});
