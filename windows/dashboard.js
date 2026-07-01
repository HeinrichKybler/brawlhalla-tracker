const { ipcRenderer } = require('electron');
const A = require('./assets');
const ipc = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

const DAY = 86400000;
const fmt = n => Number(n || 0).toLocaleString('cs-CZ');

// přibližné tier prahy (pro členy guildy, kde API dává jen ELO)
function ratingToTierName(r) {
  if (r == null) return '';
  if (r >= 2000) return 'Diamond';
  if (r >= 1680) return 'Platinum';
  if (r >= 1390) return 'Gold';
  if (r >= 1076) return 'Silver';
  if (r >= 766) return 'Bronze';
  return 'Tin';
}
const ROLE_ORDER = { Leader: 0, Officer: 1, Member: 2, Recruit: 3 };
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

let matches = [], me = null, currentRange = 'all';

function streaks(ms) {
  let win = 0, w = 0;
  for (const m of ms) { if (m.result === 'win') { w++; win = Math.max(win, w); } else if (m.result === 'loss') w = 0; }
  return { win };
}
function wr(list) {
  const played = list.filter(m => m.result === 'win' || m.result === 'loss');
  if (!played.length) return null;
  return Math.round(played.filter(m => m.result === 'win').length / played.length * 100);
}
function tierColor(t) {
  t = (t || '').toLowerCase();
  if (t.includes('diamond')) return '#b9f2ff';
  if (t.includes('platinum')) return '#3ddbd9';
  if (t.includes('gold')) return '#f0b429';
  if (t.includes('silver')) return '#c0c5ce';
  if (t.includes('bronze')) return '#cd7f32';
  if (t.includes('tin')) return '#9aa0a6';
  return 'var(--muted)';
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '–';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}
const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

function currentSeason() {
  if (me && me.season) return me.season;
  const ss = matches.map(m => m.season || 0);
  return ss.length ? Math.max(...ss) : 1;
}

function filtered() {
  const now = Date.now();
  if (currentRange === 'week') return matches.filter(m => m.timestamp >= now - 7 * DAY);
  if (currentRange === 'month') return matches.filter(m => m.timestamp >= now - 30 * DAY);
  if (currentRange === 'season') { const s = currentSeason(); return matches.filter(m => (m.season || 0) === s); }
  return matches;
}

function drawChart(list) {
  const c = document.getElementById('chart'), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const pts = list.filter(m => m.my_elo != null);
  if (!pts.length) { ctx.fillStyle = '#64748b'; ctx.font = '12px Segoe UI'; ctx.fillText('Zatím žádná data.', 8, 20); return; }
  const ys = pts.map(m => m.my_elo), min = Math.min(...ys), max = Math.max(...ys), range = (max - min) || 1;
  const n = pts.length, gap = n > 80 ? 1 : 2;
  const bw = Math.max(1, (c.width - (n - 1) * gap) / n);
  pts.forEach((m, i) => {
    const h = 6 + (m.my_elo - min) / range * (c.height - 10);
    ctx.fillStyle = i === n - 1 ? '#a855f7' : '#7c3aed';
    ctx.fillRect(i * (bw + gap), c.height - h, bw, h);
  });
}

function renderStatus(ok) {
  document.getElementById('status-dot').className = 'sdot' + (ok ? ' ok' : '');
  set('status-text', ok ? 'API aktivní' : 'API neaktivní (mock)');
}

function renderProfile() {
  const av = document.getElementById('pf-avatar');
  if (!me) {
    av.innerHTML = `<img src="${A.getRankIcon('')}">`;
    set('pf-name', 'Nastav jméno'); set('pf-sub', 'v Nastavení'); set('pf-elo', '—'); set('pf-tier', ''); set('pf-peak', '—');
    return;
  }
  av.innerHTML = `<img src="${A.getRankIcon(me.tier)}">`;
  set('pf-name', me.name || '—');
  set('pf-sub', `Sezóna ${me.season}${me.region ? ' · ' + me.region : ''}`);
  set('pf-elo', me.rating != null ? me.rating : '—');
  set('pf-tier', me.tier || '');
  set('pf-peak', me.peak_rating != null ? me.peak_rating : '—');
}

function renderSidebar() {
  const now = Date.now(), today = startOfDay(now);
  const session = matches.filter(m => m.timestamp >= today);
  const elos = matches.filter(m => m.my_elo != null);
  const sElos = session.filter(m => m.my_elo != null);
  let sessionElo = 0;
  if (sElos.length) {
    const prev = elos.filter(m => m.timestamp < today);
    const base = prev.length ? prev[prev.length - 1].my_elo : sElos[0].my_elo;
    sessionElo = sElos[sElos.length - 1].my_elo - base;
  }
  const se = document.getElementById('s-elo');
  se.textContent = (sessionElo >= 0 ? '+' : '') + sessionElo;
  se.className = 'v ' + (sessionElo >= 0 ? 'pos' : 'neg');
  set('s-wr', wr(session) != null ? wr(session) + '%' : '—');
  set('s-streak', streaks(matches).win);
  set('s-today', session.length);

  set('t-wr', wr(matches) != null ? wr(matches) + '%' : '—');
  const opp = matches.filter(m => m.opponent_elo != null).map(m => m.opponent_elo);
  set('t-avgopp', opp.length ? Math.round(opp.reduce((a, b) => a + b, 0) / opp.length) : '—');
  const days = new Set(matches.map(m => startOfDay(m.timestamp)));
  set('t-perday', days.size ? (matches.length / days.size).toFixed(1) : '0');
}

function metric(label, val, sub, acc) {
  return `<div class="card metric"><div class="label">${label}</div>
    <div class="val" style="${acc ? 'color:var(--accent2)' : ''}">${val}</div>
    <div class="sub">${sub || ''}</div></div>`;
}

function renderMain() {
  drawChart(filtered());

  const now = Date.now();
  const week = matches.filter(m => m.timestamp >= now - 7 * DAY);
  const span = matches.length ? Math.max(1, now - matches[0].timestamp) : DAY;
  const avgMonth = (matches.length / (span / (30 * DAY))).toFixed(1);
  document.getElementById('metrics').innerHTML = [
    metric('Odehráno celkem', matches.length, 'zápasů', true),
    metric('Winrate (týden)', wr(week) != null ? wr(week) + '%' : '—', `${week.length} zápasů`),
    metric('Prům. her/měsíc', avgMonth, 'odhad')
  ].join('');

  const legs = (me && me.legends || []).slice().sort((a, b) => b.games - a.games).slice(0, 6);
  const maxG = Math.max(1, ...legs.map(l => l.games));
  document.getElementById('legends-grid').innerHTML = legs.length ? legs.map(l => {
    const pct = Math.round(l.games / maxG * 100);
    return `<div class="card leg">
      <div class="top"><span class="nm">${l.name || '?'}</span><span class="wr">${Math.round((l.winrate || 0) * 100)}%</span></div>
      <div class="bar"><span style="width:${Math.max(2, pct)}%"></span></div>
      <div class="sub">${pct}% · ${l.games}g</div></div>`;
  }).join('') : '<div class="sub" style="color:var(--muted)">Žádná data (nastav jméno).</div>';

  const peaks = {};
  for (const m of matches) if (m.my_elo != null) { const s = m.season || 0; peaks[s] = Math.max(peaks[s] || 0, m.my_elo); }
  const cur = currentSeason();
  const keys = Object.keys(peaks).sort((a, b) => a - b);
  document.getElementById('seasons-grid').innerHTML = keys.length ? keys.map(s =>
    `<div class="card sea ${+s === cur ? 'cur' : ''}"><div class="s">Sezóna ${s}</div>
      <div class="e">${peaks[s]}</div><div class="t">—</div></div>`
  ).join('') : '<div class="sub" style="color:var(--muted)">Žádná data.</div>';
}

async function load() {
  matches = await ipc('db:matches').catch(() => []) || [];
  me = await ipc('me:stats').catch(() => null);
  const ok = await ipc('api:status').catch(() => false);
  renderStatus(ok);
  renderProfile();
  renderSidebar();
  renderMain();
}

// ================= NAVIGACE (historie jako v prohlížeči) =================
let navStack = [{ type: 'dashboard', tab: 'dashboard' }];
let navIndex = 0;

function sameState(a, b) {
  return !!a && !!b && a.type === b.type && a.tab === b.tab && a.name === b.name && a.id === b.id;
}
function navGo(state) {
  if (sameState(navStack[navIndex], state)) { applyState(state); return; } // nezakládej duplicitu
  navStack = navStack.slice(0, navIndex + 1); // uřízni „vpřed" větev
  navStack.push(state);
  navIndex = navStack.length - 1;
  applyState(state);
}
function navBack() { if (navIndex > 0) { navIndex--; applyState(navStack[navIndex]); } }
function navForward() { if (navIndex < navStack.length - 1) { navIndex++; applyState(navStack[navIndex]); } }
function applyState(s) {
  if (s.type === 'profile') showProfile(s.name);
  else if (s.type === 'clan') showClan(s.id, s.name);
  else showDashboardTab(s.tab || 'dashboard');
  updateNavButtons();
}
function updateNavButtons() {
  document.querySelectorAll('.navback').forEach(b => b.disabled = navIndex <= 0);
  document.querySelectorAll('.navfwd').forEach(b => b.disabled = navIndex >= navStack.length - 1);
}

function showDashboardTab(tab) {
  document.querySelector('.body').classList.remove('full');
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
}
function showSpecial(viewId) {
  document.querySelector('.body').classList.add('full');
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === viewId));
}

// nav tabs → nová položka v historii
document.querySelectorAll('.tab').forEach(t => t.onclick = () => navGo({ type: 'dashboard', tab: t.dataset.tab }));
// tlačítka zpět/vpřed v hlavičkách
document.querySelectorAll('.navback').forEach(b => b.onclick = navBack);
document.querySelectorAll('.navfwd').forEach(b => b.onclick = navForward);
// boční tlačítka myši (zpět=3 / vpřed=4) + Alt+šipky
window.addEventListener('mouseup', e => {
  if (e.button === 3) { e.preventDefault(); navBack(); }
  else if (e.button === 4) { e.preventDefault(); navForward(); }
});
window.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navBack(); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navForward(); }
});
updateNavButtons();

// ===================== VYHLEDÁVÁNÍ =====================
const searchInput = document.getElementById('searchInput');
const dropdown = document.getElementById('searchDropdown');
let searchTimer = null, sugItems = [], selIdx = -1;

function hideDropdown() { dropdown.hidden = true; dropdown.innerHTML = ''; sugItems = []; selIdx = -1; }

function renderDropdown(history, players) {
  const items = [];
  const seen = new Set();
  for (const p of players || []) {
    if (!p.name || seen.has('p:' + p.name.toLowerCase())) continue;
    seen.add('p:' + p.name.toLowerCase());
    items.push({ kind: 'player', q: p.name });
  }
  for (const h of history || []) {
    const key = h.type + ':' + (h.query || '').toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    items.push({ kind: 'history', q: h.query, type: h.type });
  }
  sugItems = items; selIdx = -1;
  if (!items.length) { dropdown.innerHTML = '<div class="sd-empty">Nic nenalezeno – Enter vyhledá zadané jméno.</div>'; dropdown.hidden = false; return; }
  dropdown.innerHTML = items.map((it, i) => {
    const icon = it.kind === 'player' ? '👤' : '🕐';
    const ty = it.kind === 'player' ? 'hráč' : (it.type === 'clan' ? 'guilda · historie' : 'historie');
    return `<div class="sd-item" data-i="${i}"><span class="ic">${icon}</span><span class="q">${escapeHtml(it.q)}</span><span class="ty">${ty}</span></div>`;
  }).join('');
  dropdown.querySelectorAll('.sd-item').forEach(el => {
    el.onclick = () => chooseSuggestion(+el.dataset.i);
    el.onmouseenter = () => { selIdx = +el.dataset.i; highlight(); };
  });
  dropdown.hidden = false;
}
function highlight() {
  dropdown.querySelectorAll('.sd-item').forEach((el, i) => el.classList.toggle('sel', i === selIdx));
}
function chooseSuggestion(i) {
  const it = sugItems[i]; if (!it) return;
  navGo({ type: 'profile', name: it.q }); // guildu nelze hledat podle jména (API nemá clan-search)
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) { hideDropdown(); return; }
  searchTimer = setTimeout(async () => {
    const res = await ipc('search:suggest', q).catch(() => ({ history: [], players: [] }));
    if (searchInput.value.trim().length >= 2) renderDropdown(res.history, res.players);
  }, 400);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (sugItems.length) { selIdx = (selIdx + 1) % sugItems.length; highlight(); } }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (sugItems.length) { selIdx = (selIdx - 1 + sugItems.length) % sugItems.length; highlight(); } }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (selIdx >= 0 && sugItems[selIdx]) chooseSuggestion(selIdx);
    else if (searchInput.value.trim().length >= 2) navGo({ type: 'profile', name: searchInput.value.trim() });
  } else if (e.key === 'Escape') { hideDropdown(); searchInput.blur(); }
});
document.addEventListener('click', e => { if (!e.target.closest('#searchWrap')) hideDropdown(); });
document.addEventListener('keydown', e => {
  if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); searchInput.focus(); searchInput.select(); }
});
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ===================== PROFIL HRÁČE =====================
let profileData = null;

async function showProfile(name) {
  hideDropdown();
  searchInput.value = '';
  document.getElementById('prof-name').textContent = 'Načítám…';
  document.getElementById('prof-sub').textContent = '';
  document.getElementById('ptab-info').innerHTML = '';
  document.getElementById('ptab-legends').innerHTML = '';
  document.getElementById('ptab-weapons').innerHTML = '';
  setPTab('info');
  showSpecial('view-profile');
  const prof = await ipc('player:profile', name).catch(() => null);
  if (!prof) { document.getElementById('prof-name').textContent = `„${name}" nenalezen`; return; }
  profileData = prof;
  renderProfileHeader(prof);
  renderProfileInfo(prof);
  renderProfileLegends(prof);
  renderProfileWeapons(prof);
}

function renderProfileHeader(p) {
  document.getElementById('prof-rank').src = A.getRankIcon(p.tier);
  document.getElementById('prof-name').textContent = p.name || '—';
  const title = document.getElementById('prof-title');
  title.hidden = true; // titul zatím z API nemáme
  const sub = document.getElementById('prof-sub');
  const bits = [];
  if (p.region) bits.push(escapeHtml(p.region));
  sub.innerHTML = bits.join(' · ');
  if (p.clan && p.clan.name) {
    const sep = bits.length ? ' · ' : '';
    sub.innerHTML += `${sep}<span class="phead-clan" id="prof-clanlink">🛡 ${escapeHtml(p.clan.name)}</span>`;
    document.getElementById('prof-clanlink').onclick = () => navGo({ type: 'clan', id: p.clan.id, name: p.clan.name });
  }
  set('prof-elo', p.rating != null ? p.rating : '—');
  set('prof-tier', p.tier || '');
  set('prof-peak', p.peak_rating != null ? p.peak_rating : '—');
}

function renderProfileInfo(p) {
  const wins = p.wins || 0, games = p.games || 0, losses = Math.max(0, games - wins);
  const wrp = games ? Math.round(wins / games * 100) : 0;
  const deg = Math.round(wrp / 100 * 360);
  const info = `
    <div class="info2">
      <div class="bigcard"><div class="h">Rank</div>
        <div class="rankrow"><img src="${A.getRankIcon(p.tier)}">
          <div><div class="rt">${p.tier || 'Unranked'}</div>
          <div class="re"><b>${p.rating != null ? p.rating : '—'}</b> ELO · peak ${p.peak_rating != null ? p.peak_rating : '—'}</div></div>
        </div>
      </div>
      <div class="bigcard"><div class="h">Winrate</div>
        <div class="wrrow">
          <div class="wrcircle" style="background:conic-gradient(var(--accent) ${deg}deg, var(--surface2) 0)">
            <div class="inner"><div class="pct">${wrp}%</div><div class="lbl">winrate</div></div>
          </div>
          <div class="wrlegend">
            <div><span class="win">■</span> <span class="k">Výhry:</span> <b>${fmt(wins)}</b></div>
            <div><span class="loss">■</span> <span class="k">Prohry:</span> <b>${fmt(losses)}</b></div>
            <div><span class="k">Celkem:</span> <b>${fmt(games)}</b></div>
          </div>
        </div>
      </div>
    </div>
    <div class="metrics">
      ${metric('Total KOs', fmt(p.totalKos), 'napříč legendami', true)}
      ${metric('Total damage', fmt(p.totalDamage), 'způsobené')}
      ${metric('Nejhranější legenda', p.topLegend ? p.topLegend.name : '—', p.topLegend ? p.topLegend.games + ' her' : '')}
      ${metric('Nejpoužívanější zbraň', p.topWeapon ? p.topWeapon.name : '—', '')}
    </div>`;
  document.getElementById('ptab-info').innerHTML = info;
}

function renderProfileLegends(p) {
  const legs = (p.legends || []).slice().sort((a, b) => b.games - a.games);
  if (!legs.length) { document.getElementById('ptab-legends').innerHTML = '<div class="placeholder">Žádná data o legendách.</div>'; return; }
  document.getElementById('ptab-legends').innerHTML = '<div class="lgrid2">' + legs.map(l => {
    const tot = (l.t1 || 0) + (l.t2 || 0);
    const f1 = tot > 0 ? l.t1 / tot : 0.5, f2 = 1 - f1;
    const wr = l.games ? Math.round(l.wins / l.games * 100) : 0;
    return `<div class="lcard">
      <div class="lh">${A.imgTag(A.legendIcon(l.name, l.id), 40)}
        <div><div class="ln">${escapeHtml(l.name || '?')}</div><div class="lg">${l.games}g · ${l.wins}w · ${wr}%</div></div></div>
      <div class="lstats"><span>KOs <b>${fmt(l.kos)}</b></span><span>DMG <b>${fmt(l.damage)}</b></span></div>
      ${weaponBar(l.w1, f1)}${weaponBar(l.w2, f2)}
    </div>`;
  }).join('') + '</div>';
}
function weaponBar(weapon, frac) {
  const pc = Math.round(frac * 100);
  return `<div class="wbar">${A.imgTag(A.weaponIcon(weapon), 26)}
    <span class="wnm">${escapeHtml(weapon || '—')}</span>
    <div class="bar"><span style="width:${Math.max(2, pc)}%"></span></div>
    <span class="pc">${pc}%</span></div>`;
}

function renderProfileWeapons(p) {
  const ws = (p.weapons || []).slice();
  if (!ws.length) { document.getElementById('ptab-weapons').innerHTML = '<div class="placeholder">Žádná data o zbraních.</div>'; return; }
  const maxU = Math.max(1, ...ws.map(w => w.usage));
  const totU = ws.reduce((a, w) => a + w.usage, 0) || 1;
  document.getElementById('ptab-weapons').innerHTML = ws.map(w => {
    const share = Math.round(w.usage / totU * 100);
    return `<div class="wrow">${A.imgTag(A.weaponIcon(w.weapon), 32)}
      <span class="wn">${escapeHtml(w.weapon)}</span>
      <div class="wbarwrap"><div class="bar"><span style="width:${Math.max(2, Math.round(w.usage / maxU * 100))}%"></span></div></div>
      <span class="wmeta">${share}% · KO <b>${fmt(w.kos)}</b> · DMG <b>${fmt(w.damage)}</b></span></div>`;
  }).join('');
}

// profil – přepínání záložek
let ptabInited = false;
function setPTab(name) {
  document.querySelectorAll('#view-profile .ptab').forEach(t => t.classList.toggle('active', t.dataset.ptab === name));
  ['info', 'legends', 'weapons'].forEach(n => {
    document.getElementById('ptab-' + n).hidden = (n !== name);
  });
}
document.querySelectorAll('#view-profile .ptab').forEach(t => t.onclick = () => setPTab(t.dataset.ptab));

// ===================== PROFIL GUILDY =====================
async function showClan(id, name) {
  document.getElementById('clan-name').textContent = name || 'Načítám…';
  document.getElementById('clan-sub').textContent = '';
  document.getElementById('ctab-members').innerHTML = '';
  setCTab('members');
  showSpecial('view-clan');
  const clan = await ipc('clan:get', id, name).catch(() => null);
  if (!clan) { document.getElementById('clan-name').textContent = 'Guildu se nepodařilo načíst'; return; }
  renderClan(clan);
}

function renderClan(clan) {
  const members = (clan.members || []).slice().sort((a, b) => {
    const ra = ROLE_ORDER[a.rank] ?? 9, rb = ROLE_ORDER[b.rank] ?? 9;
    if (ra !== rb) return ra - rb;
    return (b.rating || 0) - (a.rating || 0);
  });
  const rated = members.filter(m => m.rating != null);
  const avg = rated.length ? Math.round(rated.reduce((a, m) => a + m.rating, 0) / rated.length) : null;
  const best = rated.slice().sort((a, b) => b.rating - a.rating)[0] || null;

  document.getElementById('clan-name').textContent = clan.clan_name || '—';
  document.getElementById('clan-sub').innerHTML =
    `Členů: <b style="color:var(--text)">${members.length}</b>` +
    (avg != null ? ` &nbsp;·&nbsp; Průměrné ELO: <b style="color:var(--text)">${avg}</b>` : '') +
    (best ? ` &nbsp;·&nbsp; Nejlepší: <b style="color:var(--text)">${escapeHtml(best.name)}</b> (${best.rating})` : '');

  const cmetrics = `<div class="cmetrics">
    ${metric('Celkem členů', members.length, '', true)}
    ${metric('Průměrné ELO', avg != null ? avg : '—', rated.length + ' s ELO')}
    ${metric('Nejlepší ELO', best ? best.rating : '—', best ? best.name : '')}
    ${metric('Nejhranější legenda', '—', 'není v API')}
  </div>`;
  const list = '<div class="mlist">' + members.map(m => {
    const tier = ratingToTierName(m.rating);
    return `<div class="mrow" data-name="${escapeHtml(m.name)}">
      ${A.imgTag(A.roleIcon(m.rank), 24, 'role')}
      <div class="mav">${initials(m.name)}</div>
      <span class="mn">${escapeHtml(m.name)}</span>
      <span class="mrole">${escapeHtml(m.rank || '')}</span>
      <span class="melo">${m.rating != null ? m.rating : '—'}</span>
      <span class="mtier">${tier || ''}</span>
      <span class="marr">›</span>
    </div>`;
  }).join('') + '</div>';
  document.getElementById('ctab-members').innerHTML = cmetrics + list;
  document.querySelectorAll('#ctab-members .mrow').forEach(el => el.onclick = () => navGo({ type: 'profile', name: el.dataset.name }));
}

function setCTab(name) {
  document.querySelectorAll('#view-clan .ptab').forEach(t => t.classList.toggle('active', t.dataset.ctab === name));
  ['members', 'details', 'legends'].forEach(n => {
    document.getElementById('ctab-' + n).hidden = (n !== name);
  });
}
document.querySelectorAll('#view-clan .ptab').forEach(t => t.onclick = () => setCTab(t.dataset.ctab));

// filtry grafu
document.querySelectorAll('#filters button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#filters button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  currentRange = b.dataset.range;
  drawChart(filtered());
});

// nastavení
document.getElementById('savename').onclick = async () => {
  const name = document.getElementById('myname').value.trim();
  await ipc('settings:set', 'my_name', name);
  const msg = document.getElementById('msg');
  if (!name) { msg.textContent = 'jméno uloženo'; return; }
  msg.textContent = 'ověřuji…';
  try {
    const p = await ipc('player:lookup', name);
    msg.textContent = `✓ ${p.username} · ${p.rating != null ? p.rating + ' ELO' : '—'} · ${p.tier || '—'}`;
    load();
  } catch (_) { msg.textContent = '✗ API nedostupné'; }
};
document.getElementById('savehotkey').onclick = async () => {
  const hk = document.getElementById('hotkey').value.trim() || 'J';
  await ipc('settings:set', 'hotkey', hk);
  document.getElementById('msg').textContent = 'hotkey uložen: ' + hk;
};
document.getElementById('updtitles').onclick = async () => {
  document.getElementById('msg').textContent = 'aktualizuji tituly…';
  try { await ipc('titles:update'); document.getElementById('msg').textContent = 'tituly aktualizovány'; }
  catch (_) { document.getElementById('msg').textContent = 'aktualizace selhala'; }
};
document.getElementById('savestats').onclick = async () => {
  const legends = document.getElementById('m-legends').value.split('\n').map(l => l.trim()).filter(Boolean)
    .map(line => { const [name, games, wins] = line.split(',').map(s => (s || '').trim());
      return { name, games: +games || 0, wins: +wins || 0 }; })
    .filter(l => l.name);
  await ipc('settings:set', 'manual_rating', document.getElementById('m-rating').value.trim());
  await ipc('settings:set', 'manual_peak', document.getElementById('m-peak').value.trim());
  await ipc('settings:set', 'manual_tier', document.getElementById('m-tier').value.trim());
  await ipc('settings:set', 'region', document.getElementById('m-region').value.trim());
  await ipc('settings:set', 'season', document.getElementById('m-season').value.trim());
  await ipc('settings:set', 'manual_legends', JSON.stringify(legends));
  document.getElementById('msg').textContent = 'staty uloženy';
  load();
};

ipcRenderer.on('refresh', load);

(async () => {
  const n = await ipc('settings:get', 'my_name');
  if (n) document.getElementById('myname').value = n;
  const hk = await ipc('settings:get', 'hotkey');
  document.getElementById('hotkey').value = hk || 'J';
  const g = async k => (await ipc('settings:get', k)) || '';
  document.getElementById('m-rating').value = await g('manual_rating');
  document.getElementById('m-peak').value = await g('manual_peak');
  document.getElementById('m-tier').value = await g('manual_tier');
  document.getElementById('m-region').value = await g('region');
  document.getElementById('m-season').value = await g('season');
  const ml = await g('manual_legends');
  if (ml) { try { document.getElementById('m-legends').value = JSON.parse(ml).map(l => `${l.name}, ${l.games}, ${l.wins}`).join('\n'); } catch (_) {} }
  load();
})();
