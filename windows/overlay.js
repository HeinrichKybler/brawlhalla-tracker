const { ipcRenderer } = require('electron');
const { computeWeaponUsage, WEAPON_MAP } = require('../api');

const norm = s => (s || '').toLowerCase().replace(/[\s_]+/g, '');

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

function legendId(side, name) {
  const a = (side.all && side.all.legends || []).find(l => l.name && norm(l.name) === norm(name));
  if (a) return a.id;
  const r = (side.ranked.legends || []).find(l => l.name && norm(l.name) === norm(name));
  return r && r.id;
}

function legendChips(side, currentLegend, weaponMap) {
  const legs = topLegends(side.ranked, currentLegend);
  const maxG = Math.max(1, ...legs.map(l => l.games));
  return legs.map(l => {
    const isCur = currentLegend && norm(l.name) === norm(currentLegend);
    const pct = Math.max(2, Math.round(l.games / maxG * 100));
    return `<div class="chip ${isCur ? 'cur' : ''}">
      <div class="cn">${l.name || '?'}${isCur ? ' <span class="star">★</span>' : ''}</div>
      <div class="cbar"><span style="width:${pct}%"></span></div>
      <div class="cwr">${Math.round((l.winrate || 0) * 100)}%</div>
    </div>`;
  }).join('');
}

function weaponChips(side, currentLegend, weaponMap) {
  let weapons = computeWeaponUsage(side.all && side.all.legends, weaponMap);
  let cur = [];
  if (currentLegend) {
    const id = legendId(side, currentLegend);
    cur = (id && ((weaponMap && weaponMap[id]) || WEAPON_MAP[id])) || [];
  }
  weapons = weapons.slice(0, 5);
  const maxW = Math.max(1, ...weapons.map(w => w.usage));
  return weapons.map(w => {
    const isCur = cur.includes(w.weapon);
    const pct = Math.max(2, Math.round(w.usage / maxW * 100));
    return `<div class="chip ${isCur ? 'cur' : ''}">
      <div class="cn">${w.weapon}</div>
      <div class="cbar"><span style="width:${pct}%"></span></div>
    </div>`;
  }).join('');
}

function renderSide(el, side, currentLegend, isMe, weaponMap) {
  if (!side || !side.ranked) {
    el.innerHTML = `<div class="nmrow"><span class="nm">${isMe ? 'Nastav své jméno' : '—'}</span></div>`;
    return;
  }
  const r = side.ranked;
  el.innerHTML = `
    <div class="nmrow">
      <span class="nm ${isMe ? 'me' : ''}">${side.name || '—'}${isMe ? '<span class="tag">ty</span>' : ''}</span>
      <span class="er"><span class="elo">${r.rating != null ? r.rating : '—'}</span>
        <span class="badge">${r.tier || '—'}</span></span>
    </div>
    <div class="peak">Peak ${r.peak_rating != null ? r.peak_rating : '—'}</div>
    <div class="lab">top legendy</div>
    <div class="chips">${legendChips(side, currentLegend, weaponMap)}</div>
    <div class="lab">top zbraně</div>
    <div class="chips weapons">${weaponChips(side, currentLegend, weaponMap)}</div>`;
}

function render(d) {
  document.getElementById('map').textContent = d.mapName || '';
  renderSide(document.getElementById('colMe'), d.me, null, true, d.weaponMap);
  renderSide(document.getElementById('colOpp'),
    { name: d.opponent, ranked: d.ranked, all: d.all }, d.opponentLegend, false, d.weaponMap);
}

ipcRenderer.on('panel:data', (e, d) => render(d));
