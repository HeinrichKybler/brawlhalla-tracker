// Sdílený resolver ikon (rank / legenda / zbraň / hodnost v guildě).
// Requiruje se z každého okna: const A = require('./assets');
// Vrací cesty relativní k HTML ve windows/ (tj. '../assets/...').
//
// Proč index přes fs: názvy souborů nesedí 1:1 na názvy z API/kódu
//   - "Bödvar" -> Bodvar.webp, "Lord Vraxx" -> LordVraxx.webp, "Wu Shang" -> WuShang.webp
//   - "Rocket Lance" (WEAPON_MAP) -> Lance.webp
// Proto normalizujeme (bez diakritiky, bez mezer, lowercase) a mapujeme na reálné soubory.

const fs = require('fs');
const path = require('path');

let LEGEND_NAMES = {};
try { ({ LEGEND_NAMES } = require('../api')); } catch (_) { LEGEND_NAMES = {}; }

const ASSETS_ABS = path.join(__dirname, '..', 'assets'); // absolutní (pro čtení přes fs, jde i v asaru)
const ASSETS_REL = '../assets';                          // relativní k HTML ve windows/ (pro <img src>)

const norm = s => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')      // pryč diakritika (ö -> o)
  .replace(/[^a-z0-9]/g, '');                            // pryč mezery, tečky, apostrofy

function indexDir(sub) {
  const map = {};
  try {
    for (const f of fs.readdirSync(path.join(ASSETS_ABS, sub))) {
      if (f.toLowerCase() === 'desktop.ini') continue;
      const base = f.replace(/\.[^.]+$/, '');
      map[norm(base)] = `${ASSETS_REL}/${sub}/${f}`;
    }
  } catch (_) { /* složka může chybět */ }
  return map;
}

const IDX = {
  legendy: indexDir('legendy'),
  zbrane: indexDir('zbrane'),
  ranky: indexDir('ranky'),
  hodnosti: indexDir('hodnosti')
};

// aliasy pro nesoulad název↔soubor
const WEAPON_ALIAS = { rocketlance: 'lance' };
const ROLE_FILE = { leader: 'vudce', officer: 'dustojnik', member: 'clen', recruit: 'novacek' };

// --- rank ikona z tieru ("Gold 2" -> Gold.webp; prázdné -> unranked.png) ---
function getRankIcon(tier) {
  const first = (tier || '').split(' ')[0];
  const hit = IDX.ranky[norm(first)];
  return hit || IDX.ranky['unranked'] || `${ASSETS_REL}/ranky/unranked.png`;
}

// --- legenda: preferuj ID (přes LEGEND_NAMES) — spolehlivější než legend_name_key z API ---
function legendIcon(name, id) {
  if (id != null && LEGEND_NAMES[id]) {
    const byId = IDX.legendy[norm(LEGEND_NAMES[id])];
    if (byId) return byId;
  }
  return IDX.legendy[norm(name)] || '';
}

// --- zbraň (alias Rocket Lance -> Lance) ---
function weaponIcon(name) {
  const key = norm(name);
  return IDX.zbrane[key] || IDX.zbrane[WEAPON_ALIAS[key]] || '';
}

// --- hodnost v guildě (Leader/Officer/Member/Recruit -> *.png) ---
function roleIcon(role) {
  const file = ROLE_FILE[norm(role)];
  return (file && IDX.hodnosti[file]) || '';
}

// <img> jen když ikona existuje, jinak nic (renderer si dá vlastní fallback)
function imgTag(src, size, cls) {
  if (!src) return '';
  return `<img src="${src}" class="${cls || ''}" style="width:${size}px;height:${size}px;object-fit:contain;flex:0 0 auto" onerror="this.style.display='none'">`;
}

module.exports = { getRankIcon, legendIcon, weaponIcon, roleIcon, imgTag, norm };
