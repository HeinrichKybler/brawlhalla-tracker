const { ipcRenderer } = require('electron');
const ipc = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

const DAY = 86400000;
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
  if (!me) {
    set('pf-avatar', '–'); document.getElementById('pf-avatar').innerHTML = '–<span class="tierdot" id="pf-tierdot"></span>';
    set('pf-name', 'Nastav jméno'); set('pf-sub', 'v Nastavení'); set('pf-elo', '—'); set('pf-tier', ''); set('pf-peak', '—');
    return;
  }
  const av = document.getElementById('pf-avatar');
  av.innerHTML = `${initials(me.name)}<span class="tierdot"></span>`;
  av.querySelector('.tierdot').style.background = tierColor(me.tier);
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

// nav tabs
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const id = 'view-' + t.dataset.tab;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
});

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
