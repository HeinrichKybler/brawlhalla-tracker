const path = require('path');
const electron = require('electron');
const { DatabaseSync } = require('node:sqlite');

let db;
function getDb() {
  if (!db) {
    const app = electron.app;
    const dir = app ? app.getPath('userData') : __dirname;
    db = new DatabaseSync(path.join(dir, 'tracker.db'));
    db.exec('PRAGMA journal_mode = WAL;');
  }
  return db;
}

function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try { fn(d); d.exec('COMMIT'); }
  catch (e) { d.exec('ROLLBACK'); throw e; }
}

function init() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER,
      result TEXT,
      my_elo INTEGER,
      opponent_elo INTEGER,
      season INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS legends_cache (
      legend_id INTEGER PRIMARY KEY,
      name TEXT,
      weapon_one TEXT,
      weapon_two TEXT,
      updated INTEGER
    );
    CREATE TABLE IF NOT EXISTS titles_cache (
      title TEXT PRIMARY KEY,
      updated INTEGER
    );
  `);
}

function saveMatch({ timestamp, result, my_elo, opponent_elo, season }) {
  getDb().prepare(
    `INSERT INTO matches (timestamp, result, my_elo, opponent_elo, season) VALUES (?,?,?,?,?)`
  ).run(timestamp, result, my_elo, opponent_elo, season);
}

function getMatches(filter) {
  let sql = `SELECT * FROM matches`;
  const args = [];
  if (filter && filter.since) { sql += ` WHERE timestamp >= ?`; args.push(filter.since); }
  sql += ` ORDER BY timestamp ASC`;
  return getDb().prepare(sql).all(...args);
}

function getSetting(key) {
  const r = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return r ? r.value : null;
}
function setSetting(key, value) {
  getDb().prepare(
    `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function getTitles() {
  return getDb().prepare(`SELECT title FROM titles_cache`).all().map(r => r.title);
}
function setTitles(titles) {
  const now = Date.now();
  tx(d => {
    d.prepare(`DELETE FROM titles_cache`).run();
    const ins = d.prepare(
      `INSERT INTO titles_cache (title, updated) VALUES (?,?) ON CONFLICT(title) DO UPDATE SET updated = excluded.updated`
    );
    for (const t of titles) ins.run(t, now);
  });
}
function titlesAge() {
  const r = getDb().prepare(`SELECT MAX(updated) AS u FROM titles_cache`).get();
  return r ? r.u : null;
}

function setLegends(legends) {
  const now = Date.now();
  tx(d => {
    const ins = d.prepare(
      `INSERT INTO legends_cache (legend_id, name, weapon_one, weapon_two, updated)
       VALUES (?,?,?,?,?)
       ON CONFLICT(legend_id) DO UPDATE SET
         name = excluded.name, weapon_one = excluded.weapon_one,
         weapon_two = excluded.weapon_two, updated = excluded.updated`
    );
    for (const l of legends) ins.run(l.legend_id, l.name, l.weapon_one, l.weapon_two, now);
  });
}
function getLegends() {
  return getDb().prepare(`SELECT legend_id, name, weapon_one, weapon_two FROM legends_cache`).all();
}

module.exports = {
  init, saveMatch, getMatches, getSetting, setSetting,
  getTitles, setTitles, titlesAge, setLegends, getLegends
};
