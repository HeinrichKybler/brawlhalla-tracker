const { ipcRenderer } = require('electron');

const DAY = 86400000;
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

function streaks(matches) {
  let win = 0, loss = 0, w = 0, l = 0;
  for (const m of matches) {
    if (m.result === 'win') { w++; l = 0; } else if (m.result === 'loss') { l++; w = 0; }
    win = Math.max(win, w); loss = Math.max(loss, l);
  }
  return { win, loss };
}

function wr(list) {
  const played = list.filter(m => m.result === 'win' || m.result === 'loss');
  if (!played.length) return null;
  return Math.round(played.filter(m => m.result === 'win').length / played.length * 100);
}

function card(label, val, cls) {
  return `<div class="card"><div class="label">${label}</div><div class="val ${cls || ''}">${val}</div></div>`;
}

function drawChart(matches) {
  const c = document.getElementById('chart');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const pts = matches.filter(m => m.my_elo != null);
  if (pts.length < 2) {
    ctx.fillStyle = '#8a93a6'; ctx.font = '13px Segoe UI';
    ctx.fillText('Not enough data yet.', 16, 30); return;
  }
  const pad = 30;
  const xs = pts.map(m => m.timestamp);
  const ys = pts.map(m => m.my_elo);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys) - 20, maxY = Math.max(...ys) + 20;
  const px = t => pad + (t - minX) / (maxX - minX || 1) * (c.width - 2 * pad);
  const py = v => c.height - pad - (v - minY) / (maxY - minY || 1) * (c.height - 2 * pad);
  ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((m, i) => { const x = px(m.timestamp), y = py(m.my_elo); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.fillStyle = '#8a93a6'; ctx.font = '11px Segoe UI';
  ctx.fillText(maxY.toFixed(0), 2, py(maxY) + 8);
  ctx.fillText(minY.toFixed(0), 2, py(minY) + 4);
}

function render(matches) {
  drawChart(matches);

  const now = Date.now();
  const today = startOfDay(now);
  const session = matches.filter(m => m.timestamp >= today);
  const week = matches.filter(m => m.timestamp >= now - 7 * DAY);

  const elos = matches.filter(m => m.my_elo != null);
  let sessionElo = 0;
  const sElos = session.filter(m => m.my_elo != null);
  if (sElos.length) {
    const prev = elos.filter(m => m.timestamp < today);
    const base = prev.length ? prev[prev.length - 1].my_elo : sElos[0].my_elo;
    sessionElo = sElos[sElos.length - 1].my_elo - base;
  }

  const st = streaks(matches);
  const oppElos = matches.filter(m => m.opponent_elo != null).map(m => m.opponent_elo);
  const avgOpp = oppElos.length ? Math.round(oppElos.reduce((a, b) => a + b, 0) / oppElos.length) : '—';

  const days = new Set(matches.map(m => startOfDay(m.timestamp)));
  const perDay = days.size ? (matches.length / days.size) : 0;
  const span = matches.length ? Math.max(1, (now - matches[0].timestamp)) : DAY;
  const avgWeek = (matches.length / (span / (7 * DAY))).toFixed(1);
  const avgMonth = (matches.length / (span / (30 * DAY))).toFixed(1);

  const stats = [
    card('Session ELO', (sessionElo >= 0 ? '+' : '') + sessionElo, sessionElo >= 0 ? 'pos' : 'neg'),
    card('Winrate (all)', wr(matches) != null ? wr(matches) + '%' : '—'),
    card('Winrate (week)', wr(week) != null ? wr(week) + '%' : '—'),
    card('Winrate (session)', wr(session) != null ? wr(session) + '%' : '—'),
    card('Win streak', st.win),
    card('Loss streak', st.loss),
    card('Games today', session.length),
    card('Avg games/week', avgWeek),
    card('Avg games/month', avgMonth),
    card('Games/day avg', perDay.toFixed(1)),
    card('Total games', matches.length),
    card('Avg opponent ELO', avgOpp)
  ];
  document.getElementById('stats').innerHTML = stats.join('');

  const peaks = {};
  for (const m of elos) {
    const s = m.season || 0;
    peaks[s] = Math.max(peaks[s] || 0, m.my_elo);
  }
  document.getElementById('seasons').innerHTML = Object.keys(peaks).sort((a, b) => a - b)
    .map(s => `<tr><td>Season ${s}</td><td><b>${peaks[s]}</b></td></tr>`).join('') || '<tr><td>No data</td></tr>';
}

async function load() {
  const matches = await ipcRenderer.invoke('db:matches');
  render(matches || []);
}

document.getElementById('savename').onclick = async () => {
  const name = document.getElementById('myname').value.trim();
  await ipcRenderer.invoke('settings:set', 'my_name', name);
  const msg = document.getElementById('msg');
  if (!name) { msg.textContent = 'name saved'; return; }
  msg.textContent = 'ověřuji…';
  try {
    const p = await ipcRenderer.invoke('player:lookup', name);
    msg.textContent = `✓ ${p.username} · ${p.rating != null ? p.rating + ' ELO' : '—'} · ${p.tier || '—'}`;
  } catch (_) {
    msg.textContent = '✗ API nedostupné';
  }
};
document.getElementById('savehotkey').onclick = async () => {
  const hk = document.getElementById('hotkey').value.trim() || 'J';
  await ipcRenderer.invoke('settings:set', 'hotkey', hk);
  document.getElementById('msg').textContent = 'hotkey saved: ' + hk;
};
document.getElementById('updtitles').onclick = async () => {
  document.getElementById('msg').textContent = 'updating titles…';
  try { await ipcRenderer.invoke('titles:update'); document.getElementById('msg').textContent = 'titles updated'; }
  catch (_) { document.getElementById('msg').textContent = 'titles update failed'; }
};

ipcRenderer.on('refresh', load);

(async () => {
  const n = await ipcRenderer.invoke('settings:get', 'my_name');
  if (n) document.getElementById('myname').value = n;
  const hk = await ipcRenderer.invoke('settings:get', 'hotkey');
  document.getElementById('hotkey').value = hk || 'J';
  load();
})();
