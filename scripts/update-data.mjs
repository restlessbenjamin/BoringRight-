// Weekly data refresh (no dependencies; Node 20+).
// 1. Pulls the Top Prizes Claimed list from galottery.com.
// 2. Joins it with the stored prize/odds tables in data/odds.json.
// 3. For any game without a stored odds table, saves its odds image to
//    data/odds-img/<game>.jpg so the app can read it (the phone can't fetch
//    galottery.com directly).
// Writes data/games.json, which is the only file the app loads.
import fs from "node:fs/promises";
import { parseTopPrizesPage } from "./lib.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const PAGE = "https://www.galottery.com/en-us/games/scratchers/scratchers-top-prizes-claimed.html";
const oddsUrl = (n) => `https://www.galottery.com/content/dam/portal/images/scratchers-games/${n}/odds.jpg`;
const root = new URL("../data/", import.meta.url);

async function get(url) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((s) => setTimeout(s, 2000 * 2 ** i));
    }
  }
}

const { asOf, games } = parseTopPrizesPage(await (await get(PAGE)).text());
const odds = JSON.parse(await fs.readFile(new URL("odds.json", root), "utf8"));
await fs.mkdir(new URL("odds-img/", root), { recursive: true });

const missing = [];
for (const g of games) {
  if (odds[g.num]?.tiers?.length) continue;
  const file = new URL(`odds-img/${g.num}.jpg`, root);
  const have = await fs.stat(file).then(() => true, () => false);
  if (!have) {
    const r = await get(oddsUrl(g.num));
    if (r && (r.headers.get("content-type") || "").startsWith("image")) {
      await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
    } else {
      missing.push(`${g.num} ${g.name} (no odds image published)`);
      continue;
    }
  }
  missing.push(`${g.num} ${g.name} (image saved, table not yet read)`);
}

const out = {
  asOf,
  fetchedAt: new Date().toISOString(),
  games: games.map((g) => {
    const o = odds[g.num];
    return {
      ...g,
      odds: o?.tiers?.length ? { overall: o.overall, tiers: o.tiers } : null,
      oddsImg: !o?.tiers?.length,
    };
  }),
};
await fs.writeFile(new URL("games.json", root), JSON.stringify(out) + "\n");
console.log(`${games.length} games, data as of ${asOf}`);
if (missing.length) console.log(`Games without a stored odds table:\n  ${missing.join("\n  ")}`);
