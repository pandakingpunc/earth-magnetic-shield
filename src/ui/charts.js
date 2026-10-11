// Grafikler: state.history üzerinden son 24/48/96 sim saatinin zaman serileri (Canvas 2D).
// Sekme 1: Dst, Kp, IMF Bz, rüzgâr hızı. Sekme 2: manyetopoz r₀, SEP (log), kozmik ışın akısı.

import './hud.css';
import { gScale } from '../physics/indices.js';
import { nf, nint, MINUS } from '../core/format.js';
import { t } from '../i18n/index.js';

const REDRAW_INTERVAL = 0.25; // ~4 Hz
const RANGES = [24, 48, 96];
const MONO = "'JetBrains Mono','Cascadia Code',Consolas,monospace";
const SANS = "'Inter','Segoe UI',system-ui,sans-serif";
const GEO_RE = 6.6107;

const COL = {
  text: 'rgba(147,164,195,0.95)',
  faint: 'rgba(136,152,184,0.95)', // eksen yazıları: koyu zeminde ≥5:1 kontrast
  grid: 'rgba(120,170,255,0.08)',
  axis: 'rgba(120,170,255,0.22)',
  panel: 'rgba(255,255,255,0.03)',
  accent: '#59c8ff',
  ok: '#4dff88',
  warn: '#ffc04d',
  orange: '#ff8a3d',
  danger: '#ff4d6d',
  sun: '#ffb347',
  sep: '#fff07a',
  violet: '#b98cff',
  hot: '#ff5a3c',
};

// NOAA G0..G5 renkleri (Kp çubukları)
const G_COLORS = [COL.ok, '#ffd84d', COL.warn, COL.orange, COL.hot, COL.danger];
const S_COLORS = [COL.accent, COL.warn, COL.warn, COL.orange, COL.danger, COL.danger];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Sayı biçimi (core/format.js): dile duyarlı ondalık ayırıcı, gerçek eksi
const fmt = nf;

function sup(n) {
  const map = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
  return String(n).split('').map((c) => map[c] ?? c).join('');
}

/** Yüzde: TR '%85', EN '85%' */
const pct = (n) => t('hud.pct', { n });

function fmtPfu(v) {
  if (!isNum(v)) return '—';
  if (v < 1) return nf(v, 2);
  if (v < 100) return nf(v, 1);
  if (v < 1e4) return nint(v);
  const e = Math.floor(Math.log10(v));
  const m = v / Math.pow(10, e);
  return m >= 9.95 ? `${nf(1, 1)}×10${sup(e + 1)}` : `${nf(m, 1)}×10${sup(e)}`;
}

/** İlk x ≥ değer olan indeks (artan dizi). */
function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** i0'dan sonuna sonlu değerlerin [en küçük, en büyük] aralığı; veri yoksa null. */
function extent(arr, i0, map) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = i0; i < arr.length; i++) {
    const v = map ? map(arr[i]) : arr[i];
    if (!isNum(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

const pickStep = (steps, v, fallback) => {
  for (const s of steps) if (v <= s) return s;
  return fallback;
};

// ---------------------------------------------------------------- panel tanımları

/**
 * Her panel: key (history alanı), title (dilden bağımsız) ya da titleKey (i18n anahtarı), unit, type (line | bars | bz), fmt, color(v) → başlık değeri rengi,
 * scale(ext) → { min, max, ticks: [{ v, label, color?, dashed?, line? }] }, map? (değer dönüşümü, ör. log).
 */
const PANELS = {
  storm: [
    {
      key: 'dst',
      title: 'Dst',
      unit: 'nT',
      type: 'line',
      fill: 'dst',
      fmt: (v) => fmt(v, 0),
      color: (v) => (v > -30 ? COL.ok : v > -100 ? COL.warn : v > -250 ? COL.orange : COL.danger),
      scale(ext) {
        const lo = ext ? ext[0] : 0;
        const hi = ext ? ext[1] : 0;
        const min = pickStep([100, 200, 300, 500, 800, 1200], -lo / 0.92, 1500) * -1;
        const max = Math.max(20, Math.ceil(hi / 10) * 10 + 10);
        // Sıra, etiket önceliğidir: küçük panelde sıkışınca kılavuz eşikleri sıfır etiketinden önce yer alır
        return {
          min,
          max,
          ticks: [
            { v: -250, label: `${MINUS}250`, color: COL.danger, dashed: true },
            { v: -100, label: `${MINUS}100`, color: COL.orange, dashed: true },
            { v: -50, label: `${MINUS}50`, color: COL.warn, dashed: true },
            { v: 0, label: '0', line: true },
            { v: min, label: fmt(min), edge: true },
          ],
        };
      },
    },
    {
      key: 'kp',
      title: 'Kp',
      unit: '',
      type: 'bars',
      fmt: (v) => fmt(v, 1),
      color: (v) => G_COLORS[gScale(v)],
      scale: () => ({
        min: 0,
        max: 9,
        ticks: [
          { v: 5, label: '5', color: COL.warn, dashed: true },
          { v: 0, label: '0', edge: true },
          { v: 9, label: '9', edge: true },
        ],
      }),
    },
    {
      key: 'bz',
      title: 'IMF Bz',
      unit: 'nT',
      type: 'bz',
      fmt: (v) => fmt(v, 1),
      color: (v) => (v < -0.5 ? COL.danger : COL.ok),
      scale(ext) {
        const m = ext ? Math.max(Math.abs(ext[0]), Math.abs(ext[1])) : 0;
        const r = pickStep([10, 20, 30, 50, 80], m * 1.05, 120);
        return {
          min: -r,
          max: r,
          ticks: [
            { v: 0, label: '0', line: true },
            { v: r, label: `+${r}`, edge: true },
            { v: -r, label: `${MINUS}${r}`, edge: true },
          ],
        };
      },
    },
    {
      key: 'speed',
      titleKey: 'chart.speed',
      unit: 'km/s',
      type: 'line',
      fmt: (v) => fmt(v, 0),
      color: (v) => (v >= 900 ? COL.danger : v >= 600 ? COL.warn : COL.sun),
      line: COL.sun,
      scale(ext) {
        const lo = ext ? ext[0] : 400;
        const hi = ext ? ext[1] : 400;
        const min = lo < 250 ? Math.floor(lo / 50) * 50 : 250;
        const max = pickStep([600, 800, 1000, 1400, 2000, 3000], hi * 1.04, 4000);
        return {
          min,
          max,
          ticks: [
            { v: 400, label: '400', color: COL.faint, dashed: true },
            { v: min, label: fmt(min), edge: true },
            { v: max, label: fmt(max), edge: true },
          ],
        };
      },
    },
  ],
  shield: [
    {
      key: 'r0',
      titleKey: 'hud.sh.r0',
      unit: 'Re',
      type: 'line',
      fmt: (v) => fmt(v, 1),
      color: (v) => (v > GEO_RE * 1.15 ? COL.ok : v > GEO_RE ? COL.warn : COL.danger),
      line: COL.accent,
      scale(ext) {
        const hi = ext ? ext[1] : 10;
        const max = Math.max(14, Math.ceil(hi + 1));
        return {
          min: 0,
          max,
          ticks: [
            { v: GEO_RE, label: 'GEO', color: COL.warn, dashed: true },
            { v: 0, label: '0', edge: true },
            { v: max, label: String(max), edge: true },
          ],
        };
      },
    },
    {
      key: 'sep',
      titleKey: 'hud.ra.sep',
      unit: 'pfu',
      type: 'line',
      map: (v) => Math.log10(Math.max(v, 0.1)),
      fmt: fmtPfu,
      color: (v) => {
        const s = v >= 1e5 ? 5 : v >= 1e4 ? 4 : v >= 1e3 ? 3 : v >= 1e2 ? 2 : v >= 10 ? 1 : 0;
        return S_COLORS[s];
      },
      line: COL.sep,
      scale(ext) {
        const hi = ext ? ext[1] : -1;
        const max = clamp(Math.ceil(hi + 0.3), 2, 6);
        const ticks = [];
        for (let s = 1; s <= 5; s++) {
          if (s <= max) ticks.push({ v: s, label: `S${s}`, color: S_COLORS[s], dashed: true });
        }
        ticks.push({ v: -1, label: nf(0.1, 1), edge: true });
        return { min: -1, max, ticks };
      },
    },
    {
      key: 'gcr',
      titleKey: 'hud.ra.gcr',
      unit: '',
      type: 'line',
      fmt: (v) => (isNum(v) ? pct(Math.round(v * 100)) : '—'),
      color: (v) => (v < 0.98 ? COL.warn : COL.ok),
      line: COL.violet,
      scale(ext) {
        const lo = ext ? ext[0] : 1;
        const min = clamp(Math.floor((lo - 0.03) * 20) / 20, 0.3, 0.95);
        const max = 1.05;
        return {
          min,
          max,
          ticks: [
            { v: 1, label: pct(100), color: COL.faint, dashed: true },
            { v: min, label: pct(Math.round(min * 100)), edge: true },
          ],
        };
      },
    },
  ],
};

const TABS = [
  { id: 'storm', labelKey: 'chart.tab.storm', titleKey: 'chart.tab.stormTitle', ariaKey: 'chart.aria.storm' },
  { id: 'shield', labelKey: 'chart.tab.shield', titleKey: 'chart.tab.shieldTitle', ariaKey: 'chart.aria.shield' },
];

// ---------------------------------------------------------------- bileşen

export function createCharts(ctx) {
  const { state } = ctx;
  const root = document.getElementById('charts');
  if (!root) return { update() {} };
  root.classList.add('glass', 'charts');
  root.textContent = '';

  let range = 48;
  let tab = 'storm';

  // -------- DOM

  const head = document.createElement('div');
  head.className = 'ch-head';
  const title = document.createElement('div');
  title.className = 'ch-title';
  title.textContent = t('chart.title');
  head.appendChild(title);

  const tabGroup = document.createElement('div');
  tabGroup.className = 'ch-group';
  tabGroup.setAttribute('role', 'group');
  tabGroup.setAttribute('aria-label', t('chart.groupAria'));
  const tabBtns = TABS.map((tb) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ch-btn';
    b.textContent = t(tb.labelKey);
    b.title = t(tb.titleKey);
    b.addEventListener('click', () => {
      tab = tb.id;
      hoverX = null;
      syncButtons();
      requestDraw();
    });
    tabGroup.appendChild(b);
    return b;
  });

  const rangeGroup = document.createElement('div');
  rangeGroup.className = 'ch-group';
  rangeGroup.setAttribute('role', 'group');
  rangeGroup.setAttribute('aria-label', t('chart.rangeAria'));
  const rangeBtns = RANGES.map((h) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ch-btn';
    b.textContent = t('chart.range.btn', { h });
    b.title = t('chart.range.title', { h });
    b.addEventListener('click', () => {
      range = h;
      syncButtons();
      requestDraw();
    });
    rangeGroup.appendChild(b);
    return b;
  });
  head.append(tabGroup, rangeGroup);

  const plot = document.createElement('div');
  plot.className = 'ch-plot';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('chart.aria.storm'));
  plot.appendChild(canvas);
  root.append(head, plot);

  function syncButtons() {
    TABS.forEach((tb, i) => tabBtns[i].setAttribute('aria-pressed', String(tb.id === tab)));
    RANGES.forEach((h, i) => rangeBtns[i].setAttribute('aria-pressed', String(h === range)));
    canvas.setAttribute('aria-label', t(TABS.find((tb) => tb.id === tab).ariaKey));
  }
  syncButtons();

  // -------- tuval

  let g = null;
  try {
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  const size = { w: 0, h: 0, dpr: 1 };
  let dirty = true;
  let lastSig = '';
  let hoverX = null;

  function resize() {
    const w = Math.floor(plot.clientWidth || 0);
    const h = Math.floor(plot.clientHeight || 0);
    if (w < 60 || h < 40) {
      size.w = 0;
      size.h = 0;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== size.w || h !== size.h || dpr !== size.dpr) {
      size.w = w;
      size.h = h;
      size.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      requestDraw(); // yeniden boyutlandırma tuvali siler: hemen çiz
    }
  }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    try {
      ro = new ResizeObserver(() => resize());
      ro.observe(plot);
    } catch {
      ro = null;
    }
  }
  // Pencere yeniden boyutlanması/yakınlaştırma (devicePixelRatio değişimi) ResizeObserver'dan bağımsız da izlenir
  window.addEventListener('resize', resize);

  function requestDraw() {
    dirty = true;
    draw();
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    hoverX = e.clientX - r.left;
    dirty = true;
    draw();
  });
  const leave = () => {
    if (hoverX != null) {
      hoverX = null;
      dirty = true;
      draw();
    }
  };
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointercancel', leave);

  // -------- çizim

  const LEFT = 40; // y etiketleri için sol boşluk (px)
  const RIGHT = 8;
  const AXIS_H = 14;
  const GAP = 3;

  function draw() {
    if (!g || !size.w) return;
    dirty = false;
    const W = size.w;
    const H = size.h;
    const hist = state.history;
    const T = hist?.t ?? [];
    const now = state.time.simHours;
    const tMin = now - range;
    const panels = PANELS[tab];
    const n = panels.length;
    const x0 = LEFT;
    const x1 = W - RIGHT;
    const pw = Math.max(10, x1 - x0);
    const ph = (H - AXIS_H - GAP * (n - 1)) / n;
    const xAt = (t) => x0 + ((t - tMin) / range) * pw;

    g.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    const i0 = Math.max(0, lowerBound(T, tMin - 0.5) - 1);
    const hasData = T.length - i0 >= 1;

    // yatay fare konumu → en yakın örnek
    let hIdx = -1;
    if (hoverX != null && hasData && hoverX >= x0 && hoverX <= x1) {
      const th = tMin + ((hoverX - x0) / pw) * range;
      let k = lowerBound(T, th);
      if (k >= T.length) k = T.length - 1;
      if (k > 0 && Math.abs(T[k - 1] - th) < Math.abs(T[k] - th)) k -= 1;
      if (k >= i0 && Math.abs(T[k] - th) <= 1) hIdx = k;
    }

    // dikey ızgara + zaman ekseni etiketleri
    const stepH = range / 4;
    g.font = `400 10px ${MONO}`;
    g.textBaseline = 'alphabetic';
    for (let i = 0; i <= 4; i++) {
      const hAgo = range - i * stepH;
      const x = xAt(now - hAgo);
      g.strokeStyle = i === 4 ? COL.axis : COL.grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, H - AXIS_H);
      g.stroke();
      g.fillStyle = COL.faint;
      let label;
      if (i === 4) {
        label = t('chart.now');
        g.textAlign = 'right';
      } else {
        label = t('chart.ago', { h: fmt(hAgo) });
        g.textAlign = i === 0 ? 'left' : 'center';
      }
      g.fillText(label, i === 4 ? x : i === 0 ? x - 2 : x, H - 3);
    }

    // paneller
    for (let p = 0; p < n; p++) {
      const def = panels[p];
      const top = p * (ph + GAP);
      const bot = top + ph;
      drawPanel(def, top, bot, i0, hasData, hIdx, T, xAt, x0, x1);
    }

    // fare imleci + zaman etiketi
    if (hIdx >= 0) {
      const x = xAt(T[hIdx]);
      g.strokeStyle = 'rgba(230,238,252,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, H - AXIS_H);
      g.stroke();
      const ago = now - T[hIdx];
      const txt = ago < 0.05 ? t('chart.now') : t('chart.ago', { h: nf(ago, 1) });
      g.font = `600 10px ${MONO}`;
      const tw = g.measureText(txt).width + 8;
      const bx = clamp(x - tw / 2, x0, x1 - tw);
      g.fillStyle = 'rgba(8,14,30,0.92)';
      g.fillRect(bx, H - AXIS_H + 1, tw, AXIS_H - 1);
      g.fillStyle = '#e6eefc';
      g.textAlign = 'center';
      g.fillText(txt, bx + tw / 2, H - 3);
    }
  }

  function drawPanel(def, top, bot, i0, hasData, hIdx, T, xAt, x0, x1) {
    const series = state.history?.[def.key] ?? [];
    const ph = bot - top;
    const map = def.map;

    // arka plan
    g.fillStyle = COL.panel;
    g.fillRect(x0, top, x1 - x0, ph);

    const ext = hasData ? extent(series, i0, map) : null;
    const sc = def.scale(ext);
    const span = sc.max - sc.min || 1;
    const padY = 2;
    const yAt = (v) => bot - padY - ((v - sc.min) / span) * (ph - 2 * padY);

    // kılavuz çizgileri ve y etiketleri
    const labels = [];
    g.lineWidth = 1;
    for (const tk of sc.ticks) {
      if (tk.v < sc.min - 1e-9 || tk.v > sc.max + 1e-9) continue;
      const y = yAt(tk.v);
      if (!tk.edge) {
        g.strokeStyle = tk.color ? withAlpha(tk.color, 0.55) : tk.line ? COL.axis : COL.grid;
        if (tk.dashed) g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(x0, Math.round(y) + 0.5);
        g.lineTo(x1, Math.round(y) + 0.5);
        g.stroke();
        g.setLineDash([]);
      }
      labels.push({ y, text: tk.label, color: tk.color || COL.faint });
    }
    // y etiketleri (çakışanları atla; öncelik sırası tanım sırasıdır)
    g.font = `400 10px ${MONO}`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    const placed = [];
    for (const lb of labels) {
      const y = clamp(lb.y, top + 5, bot - 5);
      if (placed.some((py) => Math.abs(py - y) < 11)) continue;
      placed.push(y);
      g.fillStyle = lb.color;
      g.fillText(lb.text, x0 - 4, y);
    }
    g.textBaseline = 'alphabetic';

    // seri
    if (hasData) {
      g.save();
      g.beginPath();
      g.rect(x0, top, x1 - x0, ph);
      g.clip();
      if (def.type === 'bars') drawBars(def, series, i0, T, xAt, yAt, bot, x1 - x0);
      else if (def.type === 'bz') drawBz(series, i0, T, xAt, yAt, top, bot, x0, x1, sc);
      else drawLine(def, series, i0, T, xAt, yAt, top, bot, x0, x1, sc);
      g.restore();
    } else {
      g.fillStyle = COL.faint;
      g.font = `400 10px ${SANS}`;
      g.textAlign = 'center';
      g.fillText(t('chart.collecting'), (x0 + x1) / 2, top + ph / 2 + 3);
    }

    // başlık + güncel (veya fare altındaki) değer
    const idx = hIdx >= 0 ? hIdx : series.length - 1;
    const val = hasData && idx >= 0 ? series[idx] : null;
    g.textAlign = 'left';
    g.font = `600 9.5px ${SANS}`;
    const titleTxt = def.titleKey ? t(def.titleKey) : def.title;
    const tw = g.measureText(titleTxt).width;
    let valTxt = isNum(val) ? def.fmt(val) : '—';
    if (isNum(val) && def.unit) valTxt += ` ${def.unit}`;
    g.font = `600 10px ${MONO}`;
    const vw = g.measureText(valTxt).width;
    g.fillStyle = 'rgba(8,14,30,0.6)';
    g.fillRect(x0 + 2, top + 2, tw + vw + 14, 13);
    g.fillStyle = COL.text;
    g.font = `600 9.5px ${SANS}`;
    g.fillText(titleTxt, x0 + 6, top + 11.5);
    g.fillStyle = isNum(val) ? def.color(val) : COL.faint;
    g.font = `600 10px ${MONO}`;
    g.fillText(valTxt, x0 + 6 + tw + 6, top + 11.5);

    // fare altındaki nokta
    if (hIdx >= 0 && isNum(val)) {
      const v = map ? map(val) : val;
      const y = clamp(yAt(v), top + 2, bot - 2);
      g.fillStyle = '#e6eefc';
      g.beginPath();
      g.arc(xAt(T[hIdx]), y, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  function withAlpha(hex, a) {
    // '#rrggbb' → rgba(); zaten rgba ise olduğu gibi döner
    if (hex[0] !== '#' || hex.length !== 7) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const gr = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${gr},${b},${a})`;
  }

  function drawLine(def, series, i0, T, xAt, yAt, top, bot, x0, x1, sc) {
    const map = def.map;
    const pts = pathPoints(series, i0, T, xAt, yAt, map);
    if (pts.length < 2) return;

    if (def.fill === 'dst') {
      // sıfır çizgisinin altını hafifçe doldur
      const zeroY = yAt(0);
      g.save();
      g.beginPath();
      g.rect(x0, zeroY, x1 - x0, Math.max(0, bot - zeroY));
      g.clip();
      g.beginPath();
      g.moveTo(pts[0], zeroY);
      for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.lineTo(pts[pts.length - 2], zeroY);
      g.closePath();
      const grad = g.createLinearGradient(0, zeroY, 0, bot);
      grad.addColorStop(0, 'rgba(255,77,109,0.05)');
      grad.addColorStop(1, 'rgba(255,77,109,0.30)');
      g.fillStyle = grad;
      g.fill();
      g.restore();
    }

    g.lineWidth = 1.5;
    if (def.fill === 'dst') {
      // eşiklere göre renkli çizgi (−50, −100, −250 nT)
      const span = sc.max - sc.min || 1;
      const off = (v) => clamp((sc.max - v) / span, 0, 1);
      const grad = g.createLinearGradient(0, top, 0, bot);
      const stops = [[-50, COL.accent, COL.warn], [-100, COL.warn, COL.orange], [-250, COL.orange, COL.danger]];
      grad.addColorStop(0, COL.accent);
      for (const [v, a, b] of stops) {
        const o = off(v);
        grad.addColorStop(o, a);
        grad.addColorStop(o, b);
      }
      grad.addColorStop(1, COL.danger);
      g.strokeStyle = grad;
    } else {
      g.strokeStyle = def.line || COL.accent;
    }
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  }

  function drawBz(series, i0, T, xAt, yAt, top, bot, x0, x1, sc) {
    const pts = pathPoints(series, i0, T, xAt, yAt, null);
    if (pts.length < 2) return;
    const zeroY = yAt(0);
    const fillPoly = () => {
      g.beginPath();
      g.moveTo(pts[0], zeroY);
      for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.lineTo(pts[pts.length - 2], zeroY);
      g.closePath();
      g.fill();
    };
    // negatif (güney) kısım kırmızı, pozitif kısım soluk yeşil
    g.save();
    g.beginPath();
    g.rect(x0, zeroY, x1 - x0, Math.max(0, bot - zeroY));
    g.clip();
    g.fillStyle = 'rgba(255,77,109,0.38)';
    fillPoly();
    g.restore();
    g.save();
    g.beginPath();
    g.rect(x0, top, x1 - x0, Math.max(0, zeroY - top));
    g.clip();
    g.fillStyle = 'rgba(77,255,136,0.16)';
    fillPoly();
    g.restore();

    g.lineWidth = 1.2;
    g.strokeStyle = '#d6e6ff';
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  }

  function drawBars(def, series, i0, T, xAt, yAt, bot, plotW) {
    const bw = Math.max(1, (plotW * 0.25) / range - 0.2);
    let last = '';
    for (let i = i0; i < series.length; i++) {
      const v = series[i];
      if (!isNum(v)) continue;
      const x = xAt(T[i]);
      const y = yAt(clamp(v, 0, 9));
      const c = G_COLORS[gScale(v)];
      if (c !== last) {
        g.fillStyle = c;
        last = c;
      }
      g.fillRect(x - bw, y, bw, Math.max(1, bot - 2 - y));
    }
  }

  /** Sonlu örnekleri [x0,y0,x1,y1,…] biçiminde ortak diziye yazar (her çağrıda yeniden kullanılır). */
  const scratch = [];
  function pathPoints(series, i0, T, xAt, yAt, map) {
    const out = scratch;
    out.length = 0;
    for (let i = i0; i < series.length; i++) {
      const raw = series[i];
      if (!isNum(raw) || !isNum(T[i])) continue;
      const v = map ? map(raw) : raw;
      out.push(xAt(T[i]), yAt(v));
    }
    return out;
  }

  // -------- güncelleme

  let acc = REDRAW_INTERVAL;
  let first = true;
  return {
    update(dt) {
      if (first) {
        first = false;
        resize();
      }
      acc += dt;
      if (acc < REDRAW_INTERVAL) return;
      acc = 0;
      if (!g || document.body.classList.contains('ui-hidden')) return;
      // farklı ekrana taşınınca DPR değişir ama boyut değişmeyebilir (layout okumadan kontrol)
      if (size.w && Math.min(window.devicePixelRatio || 1, 2) !== size.dpr) resize();
      const T = state.history?.t;
      const sig = `${T?.length ?? 0}|${T?.length ? T[T.length - 1] : 0}|${state.time.simHours.toFixed(3)}|${range}|${tab}|${size.w}x${size.h}`;
      if (!dirty && sig === lastSig) return;
      lastSig = sig;
      draw();
    },
    redraw: requestDraw,
    dispose() {
      ro?.disconnect();
      window.removeEventListener('resize', resize);
    },
  };
}
