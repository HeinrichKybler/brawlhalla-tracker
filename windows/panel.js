const { ipcRenderer } = require('electron');
const { computeWeaponUsage, WEAPON_MAP } = require('../api');

let ctx = null;

const norm = s => (s || '').toLowerCase().replace(/[\s_]+/g, '');

function bar(name, fraction, sub, current) {
  const pct = Math.max(2, Math.round(fraction * 100));
  return `<div class="row ${current ? 'cur' : ''}">
    <div class="top"><span class="name">${name}</span><span class="wr">${sub || ''}</span></div>
    <div class="bar"><span style="width:${pct}%"></span></div>
  </div>`;
}

function topLegends(ranked, currentLegend) {
  const legs = (ranked.legends || []).slice().sort((a, b) => b.games - a.games);
  const top = legs.slice(0, 5);
  if (currentLegend) {
    const inTop = top.some(l => norm(l.name) === norm(currentLegend));
    if (!inTop) {
      const cur = legs.find(l => norm(l.name) === norm(currentLegend))
        || { name: currentLegend, games: 0, wins: 0, winrate: 0 };
      top[Math.min(top.length, 4)] = cur;
      top.length = Math.min(top.length, 5);
    }
  }
  return top;
}

function currentWeapons(d) {
  if (!d.opponentLegend) return [];
  const all = (d.all.legends || []);
  const meta = all.find(l => l.name && norm(l.name) === norm(d.opponentLegend));
  let id = meta && meta.id;
  if (!id) {
    const r = (d.ranked.legends || []).find(l => l.name && norm(l.name) === norm(d.opponentLegend));
    id = r && r.id;
  }
  if (!id) return [];
  return (d.weaponMap && d.weaponMap[id]) || WEAPON_MAP[id] || [];
}

function render(d) {
  ctx = d;
  document.getElementById('empty').style.display = 'none';
  document.getElementById('content').style.display = 'block';
  document.getElementById('name').textContent = d.opponent;
  document.getElementById('elo').textContent = d.ranked.rating != null ? `${d.ranked.rating} ELO` : '—';
  document.getElementById('tier').textContent = d.ranked.tier || '';
  document.getElementById('peak').textContent = d.ranked.peak_rating != null ? d.ranked.peak_rating : '—';

  const legs = topLegends(d.ranked, d.opponentLegend);
  const maxG = Math.max(1, ...legs.map(l => l.games));
  document.getElementById('legends').innerHTML = legs.map(l =>
    bar(l.name || '?', l.games / maxG, `${Math.round((l.winrate || 0) * 100)}% · ${l.games}g`,
      norm(l.name) === norm(d.opponentLegend))
  ).join('');

  let weapons = computeWeaponUsage(d.all.legends, d.weaponMap);
  const cur = currentWeapons(d);
  if (cur.length) {
    let top = weapons.slice(0, 5);
    const has = top.some(w => cur.includes(w.weapon));
    if (!has) {
      const curW = weapons.find(w => cur.includes(w.weapon)) || { weapon: cur[0], usage: 0 };
      top[Math.min(top.length, 4)] = curW;
      top.length = Math.min(top.length, 5);
    }
    weapons = top;
  } else {
    weapons = weapons.slice(0, 5);
  }
  const maxW = Math.max(1, ...weapons.map(w => w.usage));
  document.getElementById('weapons').innerHTML = weapons.map(w =>
    bar(w.weapon, w.usage / maxW, '', cur.includes(w.weapon))
  ).join('');
}

function saveResult(result) {
  if (!ctx) return;
  ipcRenderer.send('match:result', {
    result,
    my_elo: ctx.myElo,
    opponent_elo: ctx.oppElo,
    season: ctx.season
  });
}

document.getElementById('win').onclick = () => saveResult('win');
document.getElementById('loss').onclick = () => saveResult('loss');

ipcRenderer.on('panel:data', (e, d) => render(d));
