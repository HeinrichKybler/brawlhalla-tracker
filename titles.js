const db = require('./db');

const WIKI = 'https://brawlhalla.fandom.com/wiki/Titles';
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

async function fetchTitles() {
  const r = await fetch(WIKI, { headers: { 'User-Agent': 'brawlhalla-tracker' } });
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  const html = await r.text();
  const set = new Set();
  // first column of each table row tends to hold the title name
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = cellRe.exec(html))) {
    const txt = m[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
    if (/^[A-Za-z][A-Za-z .'\-!]{1,29}$/.test(txt)) set.add(txt);
  }
  return [...set];
}

async function getTitleSet() {
  const age = db.titlesAge();
  if (!age || Date.now() - age > NINETY_DAYS) {
    try { await forceUpdate(); } catch (_) { /* keep stale cache */ }
  }
  return new Set(db.getTitles());
}

async function forceUpdate() {
  const titles = await fetchTitles();
  if (titles.length) db.setTitles(titles);
  return titles.length;
}

module.exports = { getTitleSet, forceUpdate };
