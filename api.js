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
const normName = s => (s || '').toLowerCase().replace(/[\s_]+/g, '');
function legendIdByName(name) {
  const n = normName(name);
  for (const [id, nm] of Object.entries(LEGEND_NAMES)) if (normName(nm) === n) return +id;
  return undefined;
}

const MOCK_PLAYER = {
  id: 0, username: 'Mock Player',
  rating: 1500, peak_rating: 1600, tier: 'Gold 2', region: 'Europe',
  wins: 240, games: 490,
  clan: { clan_id: 0, clan_name: 'MockGuild' },
  legends: [
    { legend_id: 35, games: 200, wins: 120, rating: 1480, peak_rating: 1550, tier: 'Gold 1', kos: 1820, damagedealt: '905000', time_held_weapon_one: 5000, time_held_weapon_two: 3000 },
    { legend_id: 3,  games: 150, wins: 80,  rating: 1440, peak_rating: 1500, tier: 'Gold 2', kos: 1310, damagedealt: '702000', time_held_weapon_one: 4000, time_held_weapon_two: 4000 },
    { legend_id: 11, games: 80,  wins: 40,  rating: 1200, peak_rating: 1300, tier: 'Silver 3', kos: 640, damagedealt: '318000', time_held_weapon_one: 2000, time_held_weapon_two: 2000 },
    { legend_id: 5,  games: 60,  wins: 25,  rating: 1180, peak_rating: 1260, tier: 'Silver 2', kos: 505, damagedealt: '261000', time_held_weapon_one: 3000, time_held_weapon_two: 1000 }
  ]
};

const MOCK_CLAN = {
  clan_id: 0, clan_name: 'MockGuild',
  members: [
    { brawlhalla_id: 1, name: 'MockLeader',  rank: 'Leader',  rating: 1800 },
    { brawlhalla_id: 2, name: 'MockOfficer', rank: 'Officer', rating: 1600 },
    { brawlhalla_id: 5, name: 'MockOfficer2', rank: 'Officer', rating: 1550 },
    { brawlhalla_id: 3, name: 'MockMember',  rank: 'Member',  rating: 1400 },
    { brawlhalla_id: 6, name: 'MockMember2', rank: 'Member',  rating: 1350 },
    { brawlhalla_id: 4, name: 'MockRecruit', rank: 'Recruit', rating: 1200 }
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
    wins: j.wins || 0,
    games: j.games || 0,
    region: j.region || '',
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
  const legends = (j.legends || []).map(l => ({
    id: l.legend_id,
    name: l.legend_name_key || legName(l.legend_id),
    games: l.games || 0,
    wins: l.wins || 0,
    kos: +l.kos || 0,
    damage: Math.round(parseFloat(l.damagedealt ?? l.damage ?? 0)) || 0,
    t1: l.timeheldweaponone ?? l.time_held_weapon_one ?? 0,
    t2: l.timeheldweapontwo ?? l.time_held_weapon_two ?? 0
  }));
  const clan = j.clan ? { id: j.clan.clan_id, name: j.clan.clan_name } : null;
  return {
    legends, clan,
    totalKos: legends.reduce((a, l) => a + l.kos, 0),
    totalDamage: legends.reduce((a, l) => a + l.damage, 0)
  };
}

async function getPlayerAll(id) {
  if (!hasKey()) return mapAll(MOCK_PLAYER);
  return mapAll(await get(`/player/stats?brawlhalla_id=${id}&mode=all`));
}

async function getClan(clanId) {
  if (!hasKey()) return MOCK_CLAN;
  const j = await get(`/clan?clan_id=${encodeURIComponent(clanId)}`);
  return {
    clan_id: j.clan_id,
    clan_name: j.clan_name,
    members: (j.clan || j.members || []).map(m => ({
      brawlhalla_id: m.brawlhalla_id,
      name: m.name,
      rank: m.rank,
      rating: m.rating != null ? m.rating : null // oficiální /clan ELO neuvádí → null
    }))
  };
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

// jako computeWeaponUsage, ale navíc rozpočítá KO a damage per zbraň (podle time-held frakce)
function computeWeaponStats(legends, map) {
  map = map || {};
  const acc = {}; // weapon -> { usage, kos, damage }
  const add = (w, u, k, d) => {
    if (!acc[w]) acc[w] = { usage: 0, kos: 0, damage: 0 };
    acc[w].usage += u; acc[w].kos += k; acc[w].damage += d;
  };
  for (const l of legends || []) {
    const w = map[l.id] || WEAPON_MAP[l.id];
    if (!w) continue;
    const t1 = l.t1 || 0, t2 = l.t2 || 0, tot = t1 + t2;
    const f1 = tot > 0 ? t1 / tot : 0.5;
    const g = l.games || 0, kos = l.kos || 0, dmg = l.damage || 0;
    add(w[0], g * f1, kos * f1, dmg * f1);
    add(w[1], g * (1 - f1), kos * (1 - f1), dmg * (1 - f1));
  }
  return Object.entries(acc)
    .map(([weapon, v]) => ({ weapon, usage: v.usage, kos: Math.round(v.kos), damage: Math.round(v.damage) }))
    .sort((a, b) => b.usage - a.usage);
}

module.exports = {
  WEAPON_MAP, LEGEND_NAMES, searchPlayer, getPlayerRanked, getPlayerAll, getClan,
  getLegends, computeWeaponUsage, computeWeaponStats, legendIdByName
};
