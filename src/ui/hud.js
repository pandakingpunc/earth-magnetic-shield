// Veri paneli (HUD): Kp/Dst, güneş rüzgârı, manyetik kalkan, aurora, radyasyon, teknoloji etkileri,
// Van Allen kuşakları ve kozmik ışın istatistiği. DOM bir kez kurulur; yalnızca metin/stil güncellenir.

import './hud.css';
import { SCALE_LABELS, riskLabel, dstClass as dstClassName, cosmicBlockedFraction } from '../physics/indices.js';
import { simDate } from '../core/state.js';
import { RE_KM, ORBITS } from '../core/constants.js';
import { nf, nfSigned, nint } from '../core/format.js';
import { t } from '../i18n/index.js';

const INTERVAL = 0.125; // ~8 Hz DOM güncellemesi
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, fallback = 0) => (isNum(v) ? v : fallback);

// ---------------------------------------------------------------- biçimlendirme

// Sayı biçimi ortak modülden (core/format.js): dile duyarlı ondalık/binlik ayırıcı, gerçek eksi
const fmt = nf;
const fmtSigned = nfSigned;
const fmtInt = nint;

function sup(n) {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}

/** Bilimsel gösterim: 1,2×10⁴ */
function sci(v) {
  if (!isNum(v) || v <= 0) return '0';
  let e = Math.floor(Math.log10(v));
  let m = v / Math.pow(10, e);
  if (m >= 9.95) {
    m = 1;
    e += 1;
  }
  return `${nf(m, 1)}×10${sup(e)}`;
}

/** Proton akısı (pfu): küçükken ondalıklı, büyükken bilimsel. */
function fmtPfu(v) {
  if (!isNum(v)) return '—';
  if (v < 1) return nf(v, 2);
  if (v < 100) return nf(v, 1);
  if (v < 1e4) return fmtInt(v);
  return sci(v);
}

/** Doz (µSv/sa veya µSv/h) */
function fmtDose(v) {
  if (!isNum(v)) return '—';
  if (v < 0.1) return nf(v, 3);
  if (v < 10) return nf(v, 2);
  if (v < 100) return nf(v, 1);
  if (v < 1e5) return fmtInt(v);
  return sci(v);
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return t('hud.clock', {
    dd: p(d.getUTCDate()),
    mm: p(d.getUTCMonth() + 1),
    yyyy: d.getUTCFullYear(),
    hh: p(d.getUTCHours()),
    min: p(d.getUTCMinutes()),
  });
}

/** Yüzde: TR '%85', EN '85%' */
const pct = (n) => t('hud.pct', { n });

// ---------------------------------------------------------------- renk durumları

const NOAA_LEVEL = ['ok', 'warn', 'warn', 'orange', 'danger', 'danger']; // G/S/R 0..5
const noaaState = (n) => NOAA_LEVEL[clamp(Math.round(num(n)), 0, 5)];

const kpState = (kp) => (kp < 5 ? 'ok' : kp < 6 ? 'warn' : kp < 8 ? 'orange' : 'danger');

function dstState(dst) {
  if (dst > DST_SSC) return 'warn';
  if (dst > -30) return 'ok';
  if (dst > -100) return 'warn';
  if (dst > -250) return 'orange';
  return 'danger';
}

// Pozitif Dst: şok sıkıştırması (SSC/kılıf evresi); fırtına yok demek değildir, 'Sakin' denmez
const DST_SSC = 15;

function dstClass(dst) {
  return dst > DST_SSC ? t('hud.dst.pressureJump') : dstClassName(dst); // sınıf eşikleri physics/indices.js'te ortak
}

const hiState = (v, warn, orange, danger) => (v >= danger ? 'danger' : v >= orange ? 'orange' : v >= warn ? 'warn' : '');

// ---------------------------------------------------------------- DOM yardımcıları

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function setText(e, text) {
  if (e._t !== text) {
    e.textContent = text;
    e._t = text;
  }
}

function setState(e, st) {
  const s = st || '';
  if (e._s !== s) {
    if (s) e.setAttribute('data-s', s);
    else e.removeAttribute('data-s');
    e._s = s;
  }
}

function setStyle(e, prop, val) {
  const key = `_${prop}`;
  if (e[key] !== val) {
    e.style[prop] = val;
    e[key] = val;
  }
}

// ---------------------------------------------------------------- HUD

export function createHud(ctx) {
  const { state } = ctx;
  const root = document.getElementById('hud');
  if (!root) return { update() {} };
  root.classList.add('glass', 'hud');
  root.textContent = '';

  // -------- yapı taşları

  function card(title, topic) {
    const sec = el('section', 'hud-card');
    const head = el('div', 'hud-card__head');
    const toggle = el('button', 'hud-card__title', title);
    toggle.type = 'button';
    toggle.title = t('hud.card.toggle');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.addEventListener('click', () => {
      const collapsed = sec.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    head.appendChild(toggle);
    if (topic) {
      const info = el('button', 'hud-info', 'i');
      info.type = 'button';
      info.title = t('hud.card.infoTitle', { title });
      info.setAttribute('aria-label', t('hud.card.infoAria', { title }));
      info.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.ui?.openInfo?.(topic);
      });
      head.appendChild(info);
    }
    const body = el('div', 'hud-card__body');
    sec.append(head, body);
    root.appendChild(sec);
    return body;
  }

  /** Etiket solda, değer sağda. */
  function field(parent, label, unit, opts = {}) {
    const row = el('div', 'hud-row');
    if (opts.title) row.title = opts.title;
    const k = el('span', 'hud-k', label);
    const extra = opts.chip ? el('span', 'chip', '—') : null;
    if (opts.tag) k.appendChild(el('span', 'hud-tag', opts.tag));
    if (extra) k.appendChild(extra);
    const v = el('span', 'hud-v');
    const n = el('span', 'hud-n', '—');
    v.appendChild(n);
    const u = unit ? el('span', 'hud-u', unit) : null;
    if (u) v.appendChild(u);
    row.append(k, v);
    parent.appendChild(row);
    const subEl = opts.sub ? el('div', 'hud-sub') : null;
    if (subEl) parent.appendChild(subEl);
    return {
      set(text, st) {
        setText(n, text);
        setState(v, st);
      },
      setUnit(text) {
        if (u) setText(u, text);
      },
      setSub(text) {
        if (subEl) setText(subEl, text);
      },
      setChip(text, st) {
        if (extra) {
          setText(extra, text);
          setState(extra, st);
        }
      },
    };
  }

  /** Küçük sayı kutucuğu. */
  function tile(parent, label, unit, opts = {}) {
    const box = el('div', 'hud-tile');
    if (opts.title) box.title = opts.title;
    const k = el('div', 'hud-tile__k');
    k.appendChild(el('span', '', label));
    const note = opts.note ? el('span', 'hud-tile__note', '') : null;
    if (note) k.appendChild(note);
    const v = el('div', 'hud-tile__v');
    const n = el('span', 'hud-n', '—');
    v.appendChild(n);
    const u = unit ? el('span', 'hud-u', unit) : null;
    if (u) v.appendChild(u);
    box.append(k, v);
    parent.appendChild(box);
    return {
      set(text, st) {
        setText(n, text);
        setState(v, st);
      },
      setNote(text, st) {
        if (note) {
          setText(note, text);
          setState(note, st);
        }
      },
    };
  }

  /**
   * Yatay çubuk. center: sıfır ortada (−1..1). marks: [{ at, label?, align? }] 0..1.
   * Dönen set(değer, durum): değer 0..1 (center için −1..1).
   */
  function meter(parent, opts = {}) {
    const m = el('div', `meter${opts.tall ? ' meter--tall' : ''}`);
    const fill = el('i');
    m.appendChild(fill);
    const marks = opts.marks ? [...opts.marks] : [];
    if (opts.center) marks.push({ at: 0.5 });
    for (const mk of marks) {
      const x = el('span', 'meter__mark');
      x.style.left = `${mk.at * 100}%`;
      m.appendChild(x);
    }
    parent.appendChild(m);
    const labelled = marks.filter((mk) => mk.label);
    if (labelled.length) {
      const ticks = el('div', 'meter-ticks');
      for (const mk of labelled) {
        const s = el('span', mk.align ? `is-${mk.align}` : '', mk.label);
        s.style.left = `${mk.at * 100}%`;
        ticks.appendChild(s);
      }
      parent.appendChild(ticks);
    }
    return {
      el: m,
      set(v, st) {
        const f = isNum(v) ? v : 0;
        let left = 0;
        let width;
        if (opts.center) {
          width = Math.abs(clamp(f, -1, 1)) * 50;
          left = f < 0 ? 50 - width : 50;
        } else {
          width = clamp(f, 0, 1) * 100;
        }
        setStyle(fill, 'left', `${left.toFixed(1)}%`);
        setStyle(fill, 'width', `${width.toFixed(1)}%`);
        setState(m, st);
      },
      setSplit(on) {
        if (m._split !== on) {
          m.classList.toggle('is-split', on);
          m._split = on;
        }
      },
    };
  }

  // -------- başlık

  const head = el('div', 'hud-head');
  const live = el('span', 'hud-live');
  const liveDot = el('i', 'hud-live__dot');
  liveDot.setAttribute('data-s', 'ok');
  const liveTxt = el('span', '', t('hud.live.sim'));
  live.title = t('hud.live.title');
  live.append(liveDot, liveTxt);
  const clock = el('span', 'hud-clock', '—');
  head.append(live, clock);
  root.appendChild(head);

  // -------- Kp / Dst

  const kpBody = card(t('hud.card.indices'), 'indices');
  const kpTop = el('div', 'kp-top');
  const kpLeft = el('div');
  kpLeft.appendChild(el('div', 'kp-label', t('hud.kp.label')));
  const kpVal = el('div', 'kp-big', '—');
  kpLeft.appendChild(kpVal);
  const gChip = el('span', 'chip', '—');
  kpTop.append(kpLeft, gChip);
  kpBody.appendChild(kpTop);

  const SEG_COLORS = ['#4dff88', '#4dff88', '#4dff88', '#4dff88', '#4dff88', '#ffc04d', '#ff8a3d', '#ff8a3d', '#ff4d6d'];
  const gauge = el('div', 'kp-gauge');
  const segFills = SEG_COLORS.map((c) => {
    const seg = el('div', 'kp-seg');
    seg.style.setProperty('--seg', c);
    const f = el('i');
    seg.appendChild(f);
    gauge.appendChild(seg);
    return f;
  });
  kpBody.appendChild(gauge);
  const kpTicks = el('div', 'kp-ticks');
  for (let i = 0; i <= 9; i++) {
    const tick = el('span', '', String(i));
    tick.style.left = `${(i / 9) * 100}%`;
    kpTicks.appendChild(tick);
  }
  kpBody.appendChild(kpTicks);
  const kpCap = el('div', 'kp-cap');
  kpCap.append(`${t('hud.kp.max24')} `);
  const kpMaxVal = el('b', '', '—');
  kpCap.appendChild(kpMaxVal);
  kpBody.appendChild(kpCap);

  const dstBlock = el('div', 'dst-block');
  const dstRow = el('div', 'dst-row');
  const dstVal = el('span', 'dst-val', '—');
  const dstTrend = el('span', 'dst-trend');
  const dstArrow = el('span', 'dst-trend-arrow', '→');
  const dstRate = el('span', '', '—');
  dstTrend.append(dstArrow, dstRate);
  dstTrend.title = t('hud.dst.trendTitle');
  dstRow.append(el('span', 'dst-label', 'Dst'), dstVal, el('span', 'dst-unit', 'nT'), dstTrend);
  const dstCls = el('div', 'dst-class');
  const dstClassChip = el('span', 'chip', '—');
  const dstHint = el('span', 'kp-cap', t('hud.dst.hint'));
  dstHint.title = t('hud.dst.hintTitle');
  dstCls.append(dstClassChip, dstHint);
  dstBlock.append(dstRow, dstCls);
  kpBody.appendChild(dstBlock);

  // -------- Güneş rüzgârı

  const swBody = card(t('hud.card.wind'), 'solarStorm'); // CME, Bz ve güneye dönük IMF anlatılır
  const swTiles = el('div', 'hud-tiles');
  swBody.appendChild(swTiles);
  const tSpeed = tile(swTiles, t('hud.sw.speed'), 'km/s');
  const tDens = tile(swTiles, t('hud.sw.density'), 'cm⁻³');
  const tPdyn = tile(swTiles, t('hud.sw.pdyn'), 'nPa');
  const tBz = tile(swTiles, 'IMF Bz', 'nT', { note: true, title: t('hud.sw.bzTitle') });
  const tBt = tile(swTiles, 'IMF Bt', 'nT', { title: t('hud.sw.btTitle') });
  const tMach = tile(swTiles, 'Mach', '', { title: t('hud.sw.machTitle') });
  const bzWrap = el('div');
  bzWrap.style.marginTop = '7px';
  swBody.appendChild(bzWrap);
  const bzMeter = meter(bzWrap, {
    center: true,
    marks: [
      { at: 0, label: t('hud.sw.bzScaleSouth'), align: 'start' },
      { at: 1, label: t('hud.sw.bzScaleNorth'), align: 'end' },
    ],
  });

  // -------- Manyetik kalkan

  const shBody = card(t('hud.card.shield'), 'magnetosphere');
  const fR0 = field(shBody, t('hud.sh.r0'), 'Re', { sub: true });
  const fRbs = field(shBody, t('hud.sh.bowShock'), 'Re');
  const fShield = field(shBody, t('hud.sh.strength'), '');
  const shieldMeter = meter(shBody, { marks: [{ at: 1 / 1.5 }] });
  const fTilt = field(shBody, t('hud.sh.tilt'), '', { title: t('hud.sh.tiltTitle') });
  const fPol = field(shBody, t('hud.sh.polarity'), '');
  const GEO_RE = ORBITS.GEO.radiusRe;
  const fGeo = field(shBody, t('hud.sh.geo'), '', { title: t('hud.sh.geoTitle', { r: fmt(GEO_RE, 1) }) });
  const R0_SCALE = 16;
  const r0Bar = el('div');
  r0Bar.style.marginTop = '5px';
  shBody.appendChild(r0Bar);
  const r0Meter = meter(r0Bar, {
    tall: true,
    marks: [
      { at: 0, label: t('hud.sh.earth'), align: 'start' },
      { at: GEO_RE / R0_SCALE, label: `GEO ${fmt(GEO_RE, 1)} Re` },
      { at: 1, label: `${R0_SCALE} Re`, align: 'end' },
    ],
  });

  // -------- Aurora

  const auBody = card(t('hud.card.aurora'), 'aurora');
  const fAuLat = field(auBody, t('hud.au.eqEdge'), t('hud.au.eqEdgeUnit'));
  const fAuInt = field(auBody, t('hud.au.intensity'), '');
  const auMeter = meter(auBody);
  const fAuTr = field(auBody, t('hud.au.istanbul'), '', { sub: true, title: t('hud.au.istanbulTitle') });
  const fSub = field(auBody, t('hud.au.substorms'), '');

  // -------- Radyasyon

  const raBody = card(t('hud.card.radiation'), 'cosmicRays');
  const fSep = field(raBody, t('hud.ra.sep'), 'pfu', { chip: true, title: t('hud.ra.sepTitle') });
  const SEP_LO = -1; // log10(0.1)
  const SEP_SPAN = 6; // 0.1 .. 10⁵ pfu
  const sepMeter = meter(raBody, {
    marks: [1, 2, 3, 4, 5].map((s) => ({ at: (s - SEP_LO) / SEP_SPAN, label: `S${s}` })),
  });
  const fGcr = field(raBody, t('hud.ra.gcr'), '', { title: t('hud.ra.gcrTitle') });
  const gcrNote = el('div', 'hud-note');
  gcrNote.title = t('hud.ra.gcrNoteTitle');
  gcrNote.hidden = true;
  raBody.appendChild(gcrNote);
  raBody.appendChild(el('div', 'hud-sep'));
  const doseHead = el('div', 'hud-sub-title');
  doseHead.append(el('span', '', t('hud.ra.dose')), el('span', 'hud-tag', t('hud.estimated')));
  doseHead.title = t('hud.ra.doseTitle');
  raBody.appendChild(doseHead);
  const fIss = field(raBody, t('hud.ra.iss'), t('hud.unit.dose'), { title: t('hud.ra.issTitle') });
  const fFlight = field(raBody, t('hud.ra.flight'), t('hud.unit.dose'), { title: t('hud.ra.flightTitle') });
  const fGround = field(raBody, t('hud.ra.ground'), t('hud.unit.dose'), { title: t('hud.ra.groundTitle') });

  // -------- Teknoloji etkileri

  const teBody = card(t('hud.card.tech'), 'indices');
  const fGps = field(teBody, t('hud.te.gps'), 'm', { title: t('hud.te.gpsTitle') });
  const fDrag = field(teBody, t('hud.te.drag'), '', { title: t('hud.te.dragTitle') });
  const fGrid = field(teBody, t('hud.te.grid'), '', { title: t('hud.te.gridTitle') });
  const gridMeter = meter(teBody);
  const fHf = field(teBody, t('hud.te.hf'), '', { title: t('hud.te.hfTitle') });
  const fXray = field(teBody, t('hud.te.xray'), '');
  const fEsc = field(teBody, t('hud.te.escape'), 'kg/s', { tag: t('hud.estimated') });

  // -------- Van Allen kuşakları

  const vaBody = card(t('hud.card.belts'), 'vanAllen');
  const fInner = field(vaBody, t('hud.va.inner'), '');
  const innerMeter = meter(vaBody, { marks: [{ at: 1 / 3 }] });
  const fOuter = field(vaBody, t('hud.va.outer'), '');
  const outerMeter = meter(vaBody, { marks: [{ at: 1 / 3 }] });
  const fSlot = field(vaBody, t('hud.va.slot'), '');
  const slotMeter = meter(vaBody);
  const fPp = field(vaBody, t('hud.va.pp'), '', { title: t('hud.va.ppTitle') });

  // -------- Kozmik ışın istatistiği

  const csBody = card(t('hud.card.cosmic'), 'cosmicRays');
  const fSpawn = field(csBody, t('hud.cs.spawned'), t('hud.cs.spawnedUnit'));
  const fImp = field(csBody, t('hud.cs.impacts'), '');
  const fEsc2 = field(csBody, t('hud.cs.escaped'), '', { title: t('hud.cs.escapedTitle') });
  const fPolar = field(csBody, t('hud.cs.polar'), '');
  const fEq = field(csBody, t('hud.cs.equator'), '');
  csBody.appendChild(el('div', 'hud-sep'));
  const blockRow = el('div', 'hud-row');
  blockRow.title = t('hud.cs.blockedTitle');
  blockRow.appendChild(el('span', 'hud-k', t('hud.cs.blocked')));
  const blockV = el('span', 'hud-v', '—');
  blockV.style.fontSize = '15px';
  blockRow.appendChild(blockV);
  csBody.appendChild(blockRow);
  const blockMeter = meter(csBody, { tall: true });

  // ---------------------------------------------------------------- güncelleme

  /** Dst eğilimi (nT/sa): ~1 sim saat önceki örnekle karşılaştırır. */
  function dstRatePerHour() {
    const H = state.history;
    const n = H?.t?.length ?? 0;
    if (n < 3) return null;
    const now = state.time.simHours;
    const target = now - 1;
    let i = n - 1;
    while (i > 0 && H.t[i] > target) i--;
    const span = now - H.t[i];
    if (!(span >= 0.5)) return null;
    const r = (state.derived.dst - H.dst[i]) / span;
    return isNum(r) ? r : null;
  }

  const TURKEY = {
    none: { icon: '🌑', st: 'dim' },
    horizon: { icon: '🌅', st: 'warn' },
    visible: { icon: '🌌', st: 'ok' },
    overhead: { icon: '🌠', st: 'accent' },
  };

  function auroraWord(x) {
    return x < 0.25 ? t('hud.au.faint') : x < 0.6 ? t('hud.au.moderate') : x < 0.95 ? t('hud.au.bright') : t('hud.au.veryBright');
  }

  function refresh() {
    const d = state.derived;
    const sw = state.sw;
    const imp = d.impacts || {};

    // başlık
    const paused = !!state.time.paused;
    setText(liveTxt, paused ? t('hud.live.paused') : t('hud.live.sim'));
    setState(liveDot, paused ? 'warn' : 'ok');
    setText(clock, fmtDate(simDate(state)));

    // Kp / Dst
    const kp = num(d.kp);
    setText(kpVal, fmt(kp, 1));
    setState(kpVal, kpState(kp));
    for (let i = 0; i < segFills.length; i++) {
      setStyle(segFills[i], 'width', `${Math.round(clamp(kp - i, 0, 1) * 100)}%`);
    }
    const g = clamp(Math.round(num(d.g)), 0, 5);
    setText(gChip, `G${g} · ${SCALE_LABELS.G[g]}`);
    setState(gChip, noaaState(g));
    setText(kpMaxVal, fmt(d.kpMax24, 1));

    const dst = num(d.dst);
    setText(dstVal, fmtSigned(dst, 0));
    setState(dstVal, dstState(dst));
    setText(dstClassChip, dstClass(dst));
    setState(dstClassChip, dstState(dst));
    const sscTitle = dst > DST_SSC ? t('hud.dst.sscTitle') : '';
    if (dstClassChip._title !== sscTitle) {
      dstClassChip._title = sscTitle;
      dstClassChip.title = sscTitle;
    }
    const rate = dstRatePerHour();
    if (rate == null) {
      setText(dstArrow, '→');
      setText(dstRate, '—');
      setState(dstTrend, 'dim');
    } else if (rate <= -5) {
      setText(dstArrow, '↓');
      setText(dstRate, t('hud.dst.rate', { v: fmtSigned(rate, 0) }));
      setState(dstTrend, rate <= -20 ? 'danger' : 'orange');
    } else if (rate >= 5) {
      setText(dstArrow, '↑');
      setText(dstRate, t('hud.dst.rate', { v: fmtSigned(rate, 0) }));
      setState(dstTrend, 'ok');
    } else {
      setText(dstArrow, '→');
      setText(dstRate, t('hud.dst.rate', { v: fmtSigned(rate, 0) }));
      setState(dstTrend, 'dim');
    }

    // Güneş rüzgârı
    tSpeed.set(fmtInt(sw.speed), hiState(sw.speed, 500, 700, 1000));
    tDens.set(sw.density >= 100 ? fmtInt(sw.density) : fmt(sw.density, 1), hiState(sw.density, 15, 30, 60));
    tPdyn.set(sw.pdyn >= 10 ? fmt(sw.pdyn, 1) : fmt(sw.pdyn, 2), hiState(sw.pdyn, 3, 8, 20));
    const bz = num(sw.bz);
    const south = bz < -0.05; // negatif Bz = güney: manyetopoz kenetlenmesi, kırmızı
    const north = bz > 0.05;
    tBz.set(fmtSigned(bz, 1), south ? 'danger' : north ? 'ok' : '');
    tBz.setNote(south ? t('hud.sw.south') : north ? t('hud.sw.north') : t('hud.sw.neutral'), south ? 'danger' : north ? 'ok' : 'dim');
    tBt.set(fmt(sw.bt, 1), hiState(num(sw.bt), 15, 30, 50));
    tMach.set(fmt(sw.mach, 1), sw.mach < 3 ? 'warn' : '');
    bzMeter.set(bz / 30, south ? 'danger' : 'ok');

    // Manyetik kalkan
    const r0 = num(d.r0);
    const r0State = r0 > GEO_RE * 1.15 ? 'ok' : r0 > GEO_RE ? 'warn' : 'danger';
    fR0.set(fmt(r0, 1), r0State);
    fR0.setSub(`≈ ${fmtInt(r0 * RE_KM)} km`);
    fRbs.set(fmt(d.rbs, 1), '');
    const shield = num(d.shieldStrength);
    const shState = shield >= 0.75 ? 'ok' : shield >= 0.4 ? 'warn' : shield >= 0.15 ? 'orange' : 'danger';
    fShield.set(pct(Math.round(shield * 100)), shState);
    shieldMeter.set(shield / 1.5, shState);
    fTilt.set(`${fmtSigned(d.dipoleTiltDeg, 1)}°`, '');
    if (state.reversal?.active) {
      fPol.set(t('hud.sh.reversing', { n: Math.round(clamp(num(state.reversal.progress), 0, 1) * 100) }), 'warn');
    } else if (shield < 0.02) {
      fPol.set(t('hud.sh.noField'), 'danger'); // moment ~0: işaret anlamsız
    } else {
      // işaret dipol momentinden; moment ~0 ise (−0 dahil) kullanıcı kutupluluğundan
      const m = num(d.dipoleMoment, 1);
      const normal = (Math.abs(m) > 1e-3 ? m : num(state.params?.polarity, 1)) >= 0;
      fPol.set(normal ? t('hud.sh.normal') : t('hud.sh.reversed'), normal ? 'ok' : 'orange');
    }
    fGeo.set(imp.geoExposed ? t('hud.sh.geoExposed') : t('hud.sh.geoSafe'), imp.geoExposed ? 'danger' : 'ok');
    r0Meter.set(r0 / R0_SCALE, r0State);

    // Aurora
    fAuLat.set(`${fmt(d.auroraLat, 1)}°`, '');
    const auI = num(d.auroraIntensity);
    fAuInt.set(auroraWord(auI), 'ok');
    auMeter.set(auI / 1.2, auI >= 0.95 ? 'accent' : 'ok');
    const vis = typeof d.turkeyAurora === 'string' && TURKEY[d.turkeyAurora] ? d.turkeyAurora : 'none';
    const tk = TURKEY[vis];
    if (vis !== 'none' && !d.turkeyDark) {
      // Oval enlemce ulaştı ama Güneş ufkun üstünde/yakınında: aurora gözlenemez
      const elev = num(d.istanbulSunElevDeg);
      fAuTr.set(elev > 0 ? t('hud.au.daytime') : t('hud.au.twilight'), 'warn');
      fAuTr.setSub(t('hud.au.blocked', { status: t(`aurora.status.${vis}`), elev: fmtSigned(elev, 0), lat: fmt(d.istanbulMagLat, 1) }));
    } else {
      fAuTr.set(`${tk.icon} ${t(`aurora.status.${vis}`)}`, tk.st);
      fAuTr.setSub(t('hud.au.magLat', { lat: fmt(d.istanbulMagLat, 1) }));
    }
    fSub.set(fmtInt(d.substormCount), '');

    // Radyasyon
    const sep = num(d.sepPfu);
    const sS = clamp(Math.round(num(d.s)), 0, 5);
    fSep.set(fmtPfu(sep), noaaState(sS));
    fSep.setChip(`S${sS} · ${SCALE_LABELS.S[sS]}`, noaaState(sS));
    sepMeter.set((Math.log10(Math.max(sep, 0.1)) - SEP_LO) / SEP_SPAN, sS === 0 ? 'accent' : noaaState(sS));
    const gcr = num(d.gcrRelative, 1);
    fGcr.set(pct(Math.round(gcr * 100)), gcr < 0.98 ? 'warn' : '');
    if (gcr < 0.98) {
      gcrNote.hidden = false;
      setText(gcrNote, t('hud.ra.forbush', { n: Math.round((1 - gcr) * 100) }));
      setState(gcrNote, 'warn');
    } else if (gcr > 1.02) {
      gcrNote.hidden = false;
      setText(gcrNote, t('hud.ra.gcrHigh', { n: Math.round((gcr - 1) * 100) }));
      setState(gcrNote, 'orange');
    } else if (!gcrNote.hidden) {
      gcrNote.hidden = true;
    }
    fIss.set(fmtDose(imp.issDose), hiState(num(imp.issDose), 40, 120, 500));
    fFlight.set(fmtDose(imp.flightDose), hiState(num(imp.flightDose), 15, 60, 300));
    fGround.set(fmtDose(imp.groundDose), hiState(num(imp.groundDose), 0.08, 0.5, 5));

    // Teknoloji etkileri
    fGps.set(fmt(imp.gpsError, 1), hiState(num(imp.gpsError), 4, 10, 25));
    fDrag.set(`×${fmt(imp.dragFactor, 2)}`, hiState(num(imp.dragFactor), 1.5, 2.5, 5));
    const grid = clamp(num(imp.gridRisk), 0, 1);
    const gridSt = grid >= 0.8 ? 'danger' : grid >= 0.55 ? 'orange' : grid >= 0.3 ? 'warn' : 'ok';
    fGrid.set(riskLabel(grid), gridSt);
    gridMeter.set(grid, gridSt);
    const rS = clamp(Math.round(num(d.r)), 0, 5);
    fHf.set(rS === 0 ? t('hud.te.hfNormal') : t('hud.te.hfBlackout', { n: rS, label: SCALE_LABELS.R[rS] }), noaaState(rS));
    const fc = typeof d.flareClass === 'string' && d.flareClass ? d.flareClass : 'A0.0';
    fXray.set(fc, fc[0] === 'X' ? 'danger' : fc[0] === 'M' ? 'warn' : '');
    fEsc.set(fmt(d.atmosphericEscape, 1), hiState(num(d.atmosphericEscape), 4, 10, 30));

    // Van Allen kuşakları
    const belts = d.belts || {};
    const inner = num(belts.inner, 1);
    const outer = num(belts.outer, 1);
    const slot = clamp(num(belts.slot), 0, 1);
    fInner.set(`×${fmt(inner, 2)}`, '');
    innerMeter.set(inner / 3, 'belt-in');
    const outSt = outer < 0.6 ? 'warn' : outer > 2 ? 'orange' : '';
    fOuter.set(`×${fmt(outer, 2)}${outer < 0.6 ? ` · ${t('hud.va.depleted')}` : outer > 2 ? ` · ${t('hud.va.enhanced')}` : ''}`, outSt);
    outerMeter.set(outer / 3, 'belt-out');
    fSlot.set(slot < 0.05 ? t('hud.va.slotEmpty') : t('hud.va.slotFilled', { n: Math.round(slot * 100) }), slot >= 0.5 ? 'orange' : slot >= 0.05 ? 'warn' : '');
    slotMeter.set(slot, slot >= 0.5 ? 'orange' : 'warn');
    fPp.set(`L = ${fmt(d.plasmapauseL, 1)}`, '');

    // Kozmik ışın istatistiği
    const st = state.cosmic?.stats || {};
    fSpawn.set(fmtInt(st.spawned), '');
    fImp.set(fmtInt(st.impacts), '');
    fEsc2.set(fmtInt(st.escaped), '');
    fPolar.set(fmtInt(st.polarImpacts), '');
    fEq.set(fmtInt(st.equatorialImpacts), '');
    // Engellenen oran: sayaçlardan değil, alan gücünden analitik (sayaçlar yanlı örnekleme içerir; bkz. cosmicBlockedFraction)
    const frac = cosmicBlockedFraction(shield);
    setText(blockV, pct(Math.round(frac * 100)));
    const bs = frac >= 0.7 ? 'ok' : frac >= 0.4 ? 'warn' : 'danger';
    setState(blockV, bs);
    blockMeter.set(frac, bs);
    blockMeter.setSplit(true);
  }

  let acc = INTERVAL; // ilk karede hemen çiz
  return {
    update(dt) {
      acc += dt;
      if (acc < INTERVAL) return;
      acc = 0;
      if (document.body.classList.contains('ui-hidden')) return;
      refresh();
    },
  };
}
