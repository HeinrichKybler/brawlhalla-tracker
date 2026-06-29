const screenshot = require('screenshot-desktop');
const Jimp = require('jimp');
const { createWorker } = require('tesseract.js');
const titles = require('./titles');

const LEFT = { x: 380, y: 130, w: 400, h: 200 };
const RIGHT = { x: 1180, y: 130, w: 400, h: 200 };

let worker;
async function getWorker() {
  if (!worker) worker = await createWorker('eng');
  return worker;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function grabFull() {
  const buf = await screenshot({ format: 'png' });
  return Jimp.read(buf);
}

// crop region from a Jimp image, clamped to image bounds, return PNG buffer
async function cropPng(img, r) {
  const W = img.bitmap.width, H = img.bitmap.height;
  const x = Math.max(0, Math.min(r.x, W - 1));
  const y = Math.max(0, Math.min(r.y, H - 1));
  const w = Math.max(1, Math.min(r.w, W - x));
  const h = Math.max(1, Math.min(r.h, H - y));
  return img.clone().crop(x, y, w, h).getBufferAsync(Jimp.MIME_PNG);
}

// legenda (VELKÁ PÍSMENA) -> guilda (<...>) -> title -> jméno
function parsePanel(text, titleSet) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  let legend = null, name = null;
  for (const l of lines) {
    if (/<[^>]+>/.test(l)) continue; // guilda
    if (!legend && l.length > 1 && /[A-Z]/.test(l) && l === l.toUpperCase() && /^[A-Z .'\-]+$/.test(l)) {
      legend = l; continue;
    }
    if (titleSet.has(l.toLowerCase())) continue; // title
    if (!name) name = l;
  }
  return { name, legend };
}

const norm = s => (s || '').toLowerCase().replace(/\s+/g, '');

function pickOpponent(left, right, myName) {
  const me = norm(myName);
  const sides = [left, right].filter(p => p.name);
  const meSide = sides.find(p => norm(p.name) === me);
  const oppSide = sides.find(p => norm(p.name) !== me);
  if (meSide && oppSide) return { opponent: oppSide.name, opponentLegend: oppSide.legend };
  return null;
}

// trigger -> wait 8s -> loop 1s screenshot+OCR -> opponent or null after 60s
async function run(myName) {
  const titleSet = new Set([...(await titles.getTitleSet())].map(t => t.toLowerCase()));
  const w = await getWorker();
  await sleep(8000);
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const t0 = Date.now();
    try {
      const full = await grabFull();
      const [lp, rp] = await Promise.all([cropPng(full, LEFT), cropPng(full, RIGHT)]);
      const [lt, rt] = await Promise.all([w.recognize(lp), w.recognize(rp)]);
      const opp = pickOpponent(
        parsePanel(lt.data.text, titleSet),
        parsePanel(rt.data.text, titleSet),
        myName
      );
      if (opp && opp.name) return opp;
    } catch (e) {
      console.error('[ocr loop]', e.message);
    }
    const dt = Date.now() - t0;
    if (dt < 1000) await sleep(1000 - dt);
  }
  return null;
}

module.exports = { run };
