const db = require('./db');

const BASE = 'https://api.brawlhalla.com/v1';

// legend_id -> [weapon_one, weapon_two]. Static fallback; legends_cache (z
// /static/legends) přepisuje přes mapu předanou do computeWeaponUsage.
const WEAPON_MAP = {
  3: ['Hammer', 'Sword'], 4: ['Blasters', 'Hammer'], 5: ['Spear', 'Rocket Lance'],
  6: ['Blasters', 'Rocket Lance'], 7: ['Hammer', 'Spear'], 8: ['Spear', 'Katars'],
  9: ['Sword', 'Spear'], 10: ['Sword', 'Rocket Lance'], 11: ['Hammer', 'Rocket Lance'],
  12: ['Sword', 'Blasters'], 13: ['Spear', 'Blasters'], 14: ['Hammer', 'Katars'],
  15: ['Katars', 'Blasters'], 16: ['Axe', 'Hammer'], 17: ['Axe', 'Spear'],
  18: ['Sword', 'Katars'], 19: ['Axe', 'Blasters'], 20: ['Bow', 'Katars'],
  21: ['Bow', 'Axe'], 22: ['Sword', 'Bow'], 23: ['Rocket Lance', 'Spear'],
  24: ['Bow', 'Blasters'], 25: ['Axe', 'Sword'], 26: ['Gauntlets', 'Hammer'],
  27: ['Spear', 'Gauntlets'], 28: ['Sword', 'Gauntlets'], 29: ['Katars', 'Axe'],
  30: ['Blasters', 'Gauntlets'], 31: ['Spear', 'Scythe'], 32: ['Scythe', 'Blasters'],
  33: ['Scythe', 'Gauntlets'], 34: ['Hammer', 'Bow'], 35: ['Scythe', 'Rocket Lance'],
  36: ['Cannon', 'Gauntlets'], 37: ['Sword', 'Greatsword'], 38: ['Greatsword', 'Katars'],
  39: ['Greatsword', 'Hammer'], 40: ['Blasters', 'Orb'], 41: ['Bow', 'Scythe'],
  43: ['Gauntlets', 'Bow'], 44: ['Cannon', 'Axe'], 45: ['Orb', 'Katars'],
  46: ['Greatsword', 'Spear'], 47: ['Cannon', 'Spear'], 48: ['Bow', 'Gauntlets'],
  49: ['Orb', 'Rocket Lance'], 50: ['Greatsword', 'Blasters'], 52: ['Katars', 'Gauntlets'],
  53: ['Sword', 'Cannon'], 56: ['Orb', 'Hammer'], 57: ['Greatsword', 'Bow'],
  58: ['Axe', 'Gauntlets'], 59: ['Cannon', 'Katars'], 60: ['Sword', 'Orb'],
  61: ['Spear', 'Bow']
};

const LEGEND_NAMES = {
  3: 'Bödvar', 4: 'Cassidy', 5: 'Orion', 6: 'Lord Vraxx', 7: 'Gnash', 8: 'Queen Nai',
  9: 'Hattori', 10: 'Sir Roland', 11: 'Scarlet', 12: 'Thatch', 13: 'Ada', 14: 'Sentinel',
  15: 'Lucien', 16: 'Teros', 17: 'Brynn', 18: 'Asuri', 19: 'Barraza', 20: 'Ember',
  21: 'Azoth', 22: 'Koji', 23: 'Ulgrim', 24: 'Diana', 25: 'Jhala', 26: 'Kor',
  27: 'Wu Shang', 28: 'Val', 29: 'Ragnir', 30: 'Cross', 31: 'Mirage', 32: 'Nix',
  33: 'Mordex', 34: 'Yumiko', 35: 'Artemis', 36: 'Onyx', 37: 'Jaeyun', 38: 'Mako',
  39: 'Magyar', 40: 'Reno', 41: 'Munin'
};
const legName = id => LEGEND_NAMES[id] || `Legend ${id}`;

const MOCK_PLAYER = {
  id: 0, username: 'Mock Player',
  rating: 1500, peak_rating: 1600, tier: 'Gold 2',
  legends: [
    { legend_id: 35, games: 200, wins: 120, rating: 1480, peak_rating: 1550, tier: 'Gold 1', time_held_weapon_one: 5000, time_held_weapon_two: 3000 },
    { legend_id: 11, games: 80, wins: 40, rating: 1200, peak_rating: 1300, tier: 'Silver 3', time_held_weapon_one: 2000, time_held_weapon_two: 2000 }
  ]
};

const hasKey = () => !!process.env.BH_API_KEY;

async function get(pathQ) {
  const sep = pathQ.includes('?') ? '&' : '?';
  const r = await fetch(`${BASE}${pathQ}${sep}api_key=${encodeURIComponent(process.env.BH_API_KEY)}`);
  if (!r.ok) throw new Error(`API ${r.status} ${pathQ}`);
  return r.json();
}

async function searchPlayer(name) {
  if (!hasKey()) return { id: MOCK_PLAYER.id, username: name || MOCK_PLAYER.username };
  const j = await get(`/leaderboard/ranked?game_mode=1v1&region=ALL&search=${encodeURIComponent(name)}`);
  const players = (j.rankings || []).flatMap(r => r.players || (r.id ? [r] : []));
  if (!players.length) return null;
  const target = name.toLowerCase();
  const row = players.find(p => (p.username || p.name || '').toLowerCase() === target) || players[0];
  return { id: row.id || row.brawlhalla_id, username: row.username || row.name };
}

function mapRanked(j) {
  return {
    rating: j.rating,
    peak_rating: j.peak_rating,
    tier: j.tier,
    legends: (j.legends || []).map(l => {
      const games = l.games || 0, wins = l.wins || 0;
      return { id: l.legend_id, name: l.legend_name_key || legName(l.legend_id), games, wins, winrate: games ? wins / games : 0 };
    })
  };
}

async function getPlayerRanked(id) {
  if (!hasKey()) return mapRanked(MOCK_PLAYER);
  return mapRanked(await get(`/player/stats?brawlhalla_id=${id}&mode=ranked_1v1`));
}

function mapAll(j) {
  return {
    legends: (j.legends || []).map(l => ({
      id: l.legend_id,
      name: l.legend_name_key || legName(l.legend_id),
      games: l.games || 0,
      wins: l.wins || 0,
      t1: l.timeheldweaponone ?? l.time_held_weapon_one ?? 0,
      t2: l.timeheldweapontwo ?? l.time_held_weapon_two ?? 0
    }))
  };
}

async function getPlayerAll(id) {
  if (!hasKey()) return mapAll(MOCK_PLAYER);
  return mapAll(await get(`/player/stats?brawlhalla_id=${id}&mode=all`));
}

async function getLegends() {
  const cached = db.getLegends();
  if (cached && cached.length) return cached;
  let list;
  if (!hasKey()) {
    list = Object.keys(WEAPON_MAP).map(id => ({
      legend_id: +id, name: legName(+id), weapon_one: WEAPON_MAP[id][0], weapon_two: WEAPON_MAP[id][1]
    }));
  } else {
    const j = await get(`/static/legends`);
    list = (Array.isArray(j) ? j : []).map(l => ({
      legend_id: l.legend_id, name: l.bio_name || l.legend_name_key,
      weapon_one: l.weapon_one, weapon_two: l.weapon_two
    }));
  }
  if (list.length) db.setLegends(list);
  return list;
}

// legends: [{ id, games, t1, t2 }]; map: { id: [w1, w2] }
function computeWeaponUsage(legends, map) {
  map = map || {};
  const usage = {};
  for (const l of legends || []) {
    const w = map[l.id] || WEAPON_MAP[l.id];
    if (!w) continue;
    const t1 = l.t1 || 0, t2 = l.t2 || 0, tot = t1 + t2;
    const f1 = tot > 0 ? t1 / tot : 0.5;
    const g = l.games || 0;
    usage[w[0]] = (usage[w[0]] || 0) + g * f1;
    usage[w[1]] = (usage[w[1]] || 0) + g * (1 - f1);
  }
  return Object.entries(usage)
    .map(([weapon, u]) => ({ weapon, usage: u }))
    .sort((a, b) => b.usage - a.usage);
}

module.exports = {
  WEAPON_MAP, searchPlayer, getPlayerRanked, getPlayerAll, getLegends, computeWeaponUsage
};
