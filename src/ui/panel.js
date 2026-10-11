// Kontrol paneli (#panel): akordeon bölümler, kaydırıcılar, anahtarlar ve tetikleyiciler.
// state.params'a yazar ve ctx.sim tetikleyicilerini çağırır; başka yerden gelen değişiklikleri
// (önayarlar, klavye…) ~5 Hz'de state'ten geri okuyup denetimlere yansıtır.

import './panel.css';
import { CAMERA_PRESETS } from '../scene/cameraRig.js';
import {
  STORM_PRESETS, stormParamsFromStrength, predictStormOutcome, strengthLabel, transitHoursFor,
} from '../physics/stormProfile.js';
import { SCENARIOS } from '../core/simulation.js';
import { PARTICLES, rigidityToKineticGeV, minLatitudeForRigidity } from '../physics/dipole.js';
import { nf, nfs, nint, dayMonth } from '../core/format.js';
import { t, hasKey } from '../i18n/index.js';

// Dile duyarlı sayı biçimi core/format.js'te; diğer arayüz modülleri buradan da alabilsin diye yeniden dışa aktarılır
export { nf, nfs };

const SYNC_INTERVAL = 0.2; // sn (~5 Hz)

// ------------------------------------------------------------------ küçük yardımcılar

/** DOM oluşturucu: el('div', { class, text, onclick, 'aria-label' … }, ...çocuklar) */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === undefined || v === null || v === false) continue;
      if (key === 'class') node.className = v;
      else if (key === 'text') node.textContent = v;
      else if (key === 'hidden' || key === 'disabled' || key === 'checked') node[key] = true;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), v);
      else node.setAttribute(key, v === true ? '' : String(v));
    }
  }
  appendAll(node, children);
  return node;
}

function appendAll(node, children) {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) appendAll(node, c);
    else node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** Yalnızca değiştiyse yaz (gereksiz DOM güncellemesi yapma) */
export function setText(node, text) {
  if (node._t !== text) {
    node._t = text;
    node.textContent = text;
  }
}

function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

const clampNum = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Enerjiyi MeV/GeV olarak yazar (GeV girdi) */
function fmtEnergy(gev) {
  if (gev < 1) {
    const mev = gev * 1000;
    return `${mev < 10 ? nfs(mev, 1) : nf(mev, 0)} MeV`;
  }
  return `${gev < 10 ? nfs(gev, 2) : gev < 100 ? nfs(gev, 1) : nf(gev, 0)} GeV`;
}

/** sim saati/gerçek saniye → '15 dk/s' veya '2 sa/s' (EN: '15 min/s', '2 h/s') */
function fmtRate(h) {
  if (h >= 1) return `${nfs(h, h < 10 ? 1 : 0)} ${t('panel.unit.hourPerSec')}`;
  const min = h * 60;
  return `${min < 10 ? nfs(min, 1) : nf(min, 0)} ${t('panel.unit.minPerSec')}`;
}

const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Yılın günü (1..365) → '21 Haziran' (EN: 'June 21') */
function dayLabel(doy) {
  const d = clampNum(Math.round(doy), 1, 365);
  let m = 11;
  while (m > 0 && MONTH_START[m] >= d) m--;
  return dayMonth(d - MONTH_START[m], m);
}

/** Eksen eğikliğinin Güneş'e göre durumu (simulation.js'teki mevsim modeliyle aynı faz) */
function seasonHint(doy) {
  const c = Math.cos((2 * Math.PI * (doy - 172)) / 365.25);
  if (c >= 0.9) return t('panel.season.northTilt');
  if (c <= -0.9) return t('panel.season.southTilt');
  if (Math.abs(c) < 0.12) return t('panel.season.equinox');
  return c > 0 ? t('panel.season.northPart') : t('panel.season.southPart');
}

// Metinler t() ile oluşturma/kullanım anında alınır
const layerName = (key) => (hasKey(`layer.${key}`) ? t(`layer.${key}`) : key);

const phaseText = (phase) => (hasKey(`panel.phase.${phase}`) ? t(`panel.phase.${phase}`) : t('panel.phase.ended'));

const PARTICLE_KEYS = ['proton', 'electron', 'alpha'];
const particleName = (k) => t(`panel.particle.${k}`);

// ------------------------------------------------------------------ panel

export function createPanel(ctx) {
  const { state, sim, events } = ctx;
  const root = document.getElementById('panel');
  if (!root) return { update() {} };

  root.textContent = '';
  root.classList.add('glass');
  const scroll = el('div', { class: 'pn-scroll' });
  root.appendChild(scroll);

  const syncers = []; // ~5 Hz'de çağrılan eşitleyiciler
  const sliders = [];
  let acc = 0;
  let uid = 0;

  const openInfo = (topic) => ctx.ui?.openInfo?.(topic);
  const requestSync = () => {
    acc = SYNC_INTERVAL;
  };

  // --- Kaydırıcı: sürekli veya logaritmik; iz dolgusu değeri gösterir
  function slider(o) {
    const log = !!o.log;
    const step = o.step ?? 1;
    const id = `pn-r${++uid}`;
    const input = el('input', {
      class: 'pn-range', type: 'range', id,
      min: log ? 0 : o.min, max: log ? 1000 : o.max, step: log ? 1 : step,
    });
    const valEl = el('span', { class: 'pn-val' });
    const subEl = o.sub ? el('div', { class: 'pn-sub' }) : null;
    const effEl = o.eff ? el('div', { class: 'pn-eff', hidden: true }) : null;
    const rootEl = el(
      'div', { class: 'pn-ctl' },
      el('div', { class: 'pn-ctl-head' }, el('label', { class: 'pn-lbl', for: id, text: o.label }), valEl),
      input, subEl, effEl,
    );

    const lo = log ? 0 : o.min;
    const hi = log ? 1000 : o.max;
    const toPos = (v) => (log ? (1000 * Math.log(clampNum(v, o.min, o.max) / o.min)) / Math.log(o.max / o.min) : clampNum(v, o.min, o.max));
    const fromPos = (p) => (log ? o.min * Math.pow(o.max / o.min, p / 1000) : p);

    const api = { root: rootEl, input, dragging: false };

    const paint = (v, withEff = true) => {
      input.style.setProperty('--p', ((toPos(v) - lo) / (hi - lo)).toFixed(4));
      const vt = o.fmt(v);
      if (valEl._t !== vt) input.setAttribute('aria-valuetext', vt);
      setText(valEl, vt);
      if (subEl) {
        const s = o.sub(v);
        const text = typeof s === 'string' ? s : s.text;
        const tone = typeof s === 'string' ? '' : s.tone || '';
        setText(subEl, text);
        if (subEl._tone !== tone) {
          subEl._tone = tone;
          subEl.classList.toggle('is-warn', tone === 'warn');
          subEl.classList.toggle('is-calm', tone === 'calm');
        }
      }
      if (effEl && withEff) {
        const et = o.eff();
        if (et) setText(effEl, et);
        setHidden(effEl, !et);
      }
    };

    input.addEventListener('input', () => {
      const v = fromPos(parseFloat(input.value));
      if (!Number.isFinite(v)) return;
      o.set(v);
      paint(v, false); // etkin değer bir sonraki eşitlemede güncellenir (sim henüz yeniden hesaplamadı)
      o.after?.();
    });
    input.addEventListener('pointerdown', () => {
      api.dragging = true;
    });
    input.addEventListener('blur', () => {
      api.dragging = false;
    });

    api.sync = () => {
      if (api.dragging) return;
      const v = o.get();
      if (!Number.isFinite(v)) return;
      const pos = toPos(v);
      if (!(Math.abs(parseFloat(input.value) - pos) <= (log ? 0.6 : step * 0.5))) input.value = String(pos);
      paint(v);
    };

    sliders.push(api);
    syncers.push(api.sync);
    return api;
  }

  // --- Anahtar (toggle switch)
  function toggle(label, { get, set, cls = '' }) {
    const input = el('input', { type: 'checkbox', role: 'switch' });
    const rootEl = el(
      'label', { class: `pn-switch ${cls}`.trim() },
      el('span', { class: 'pn-switch-txt', text: label }),
      input,
      el('span', { class: 'pn-track', 'aria-hidden': 'true' }),
    );
    input.addEventListener('change', () => set(input.checked));
    const sync = () => {
      const v = !!get();
      if (input.checked !== v) input.checked = v;
    };
    syncers.push(sync);
    return { root: rootEl, input, sync };
  }

  // --- Akordeon bölümü: içerik kapsayıcısını döndürür
  function section(id, title, topic, open = false) {
    const body = el('div', { class: 'pn-content' });
    const bodyId = `pn-body-${id}`;
    const toggleBtn = el(
      'button', { class: 'pn-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': bodyId },
      el('span', { class: 'pn-ttl', text: title }),
      el('span', { class: 'pn-chev', 'aria-hidden': 'true' }),
    );
    const helpBtn = el('button', {
      class: 'pn-help', type: 'button', text: '?',
      title: t('panel.help.title'), 'aria-label': t('panel.help.aria', { title }),
      onclick: () => openInfo(topic),
    });
    const sec = el(
      'section', { class: open ? 'pn-sec open' : 'pn-sec', 'data-sec': id },
      el('div', { class: 'pn-head' }, toggleBtn, helpBtn),
      el('div', { class: 'pn-body', id: bodyId }, el('div', { class: 'pn-inner' }, body)),
    );
    toggleBtn.addEventListener('click', () => {
      const isOpen = sec.classList.toggle('open');
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
    });
    scroll.appendChild(sec);
    return body;
  }

  // ================================================================ 1. Güneş fırtınası
  {
    const body = section('storm', t('panel.storm.title'), 'solarStorm', true);

    const prevTitle = el('div', { class: 'pn-preview-ttl' });
    const prevText = el('div');
    const prev = el('div', { class: 'pn-preview', 'data-lv': '0', 'aria-live': 'polite' }, prevTitle, prevText);
    let prevKey = -1;
    const refreshPreview = () => {
      const s = state.params.stormStrength;
      const key = Math.round(s * 1000);
      if (key === prevKey) return;
      prevKey = key;
      const p = stormParamsFromStrength(s);
      const o = predictStormOutcome(p);
      setText(prevTitle, strengthLabel(s, o));
      setText(
        prevText,
        t('panel.storm.preview', { flare: o.flareClass, v: nint(p.vPeak), h: Math.round(transitHoursFor(p.vPeak)), g: o.g, dst: nf(Math.round(o.dstMin)) }),
      );
      if (prev.dataset.lv !== String(o.g)) prev.dataset.lv = String(o.g);
    };

    const strength = slider({
      label: t('panel.storm.strength'), min: 0, max: 100, step: 1,
      get: () => state.params.stormStrength * 100,
      set: (v) => {
        state.params.stormStrength = clampNum(v / 100, 0, 1);
      },
      fmt: (v) => t('panel.pct', { v: Math.round(v) }),
      after: refreshPreview,
    });
    syncers.push(refreshPreview);

    const trigger = el('button', {
      class: 'pn-btn pn-btn--primary pn-btn--storm pn-btn--block', type: 'button', text: t('panel.storm.trigger'),
      title: t('panel.storm.triggerTitle'),
      onclick: () => sim.triggerSolarStorm({ strength: state.params.stormStrength, presetId: null }),
    });

    const select = el(
      'select', { class: 'pn-select', 'aria-label': t('panel.storm.historic') },
      Object.entries(STORM_PRESETS).map(([id, p]) => el('option', { value: id, text: p.name })),
    );
    const desc = el('div', { class: 'pn-sub pn-desc' });
    const showDesc = () => setText(desc, STORM_PRESETS[select.value]?.description ?? '');
    select.addEventListener('change', showDesc);
    showDesc();
    const replay = el('button', {
      class: 'pn-btn pn-btn--block', type: 'button', text: t('panel.storm.replay'),
      onclick: () => sim.applyPreset(select.value),
    });

    const list = el('div', { class: 'pn-storms' });
    const empty = el('div', { class: 'pn-empty', text: t('panel.storm.none') });
    const items = new Map();

    const makeItem = (st) => {
      const name = el('span', { class: 'pn-storm-name', text: st.name, title: st.name });
      const phase = el('span', { class: 'pn-storm-phase' });
      const fill = el('i');
      const meta = el('div', {
        class: 'pn-storm-meta',
        text: t('panel.storm.meta', { flare: st.flareClass, v: nint(st.vPeak), g: st.predicted?.g ?? 0 }),
      });
      const rootEl = el(
        'div', { class: 'pn-storm', 'data-phase': st.phase },
        el('div', { class: 'pn-storm-top' }, name, phase),
        meta,
        el('div', { class: 'pn-bar' }, fill),
      );
      list.appendChild(rootEl);
      return { rootEl, phase, fill };
    };

    const syncStorms = () => {
      const alive = new Set();
      for (const st of state.storms) {
        alive.add(st.id);
        let it = items.get(st.id);
        if (!it) {
          it = makeItem(st);
          items.set(st.id, it);
        }
        if (it.rootEl.dataset.phase !== st.phase) it.rootEl.dataset.phase = st.phase;
        setText(it.phase, st.phase === 'transit' ? t('panel.phase.transit', { pct: Math.round(st.transitProgress * 100) }) : phaseText(st.phase));
        const frac = st.phase === 'transit'
          ? st.transitProgress
          : (state.time.simHours - st.arrivalSim) / (st.sheathHours + st.cloudHours + 48);
        const w = `${(clampNum(frac, 0, 1) * 100).toFixed(1)}%`;
        if (it.fill._w !== w) {
          it.fill._w = w;
          it.fill.style.width = w;
        }
      }
      for (const [id, it] of items) {
        if (!alive.has(id)) {
          it.rootEl.remove();
          items.delete(id);
        }
      }
      setHidden(empty, state.storms.length > 0);
    };
    syncers.push(syncStorms);

    body.append(
      strength.root, prev, trigger,
      el('div', { class: 'pn-subhead', text: t('panel.storm.historicHead') }),
      select, desc, replay,
      el('div', { class: 'pn-subhead', text: t('panel.storm.activeHead') }),
      list, empty,
    );
  }

  // ================================================================ 2. Kozmik ışınlar
  {
    const body = section('cosmic', t('panel.cosmic.title'), 'cosmicRays', true);
    const c = state.params.cosmic;

    const gcr = slider({
      label: t('panel.cosmic.gcr'), min: 0, max: 1, step: 0.01,
      get: () => c.backgroundIntensity,
      set: (v) => {
        c.backgroundIntensity = clampNum(v, 0, 1);
      },
      fmt: (v) => t('panel.pct', { v: Math.round(v * 100) }),
      sub: () => t('panel.cosmic.gcrSub', { pct: Math.round(state.derived.gcrRelative * 100) }),
    });

    const burst = slider({
      label: t('panel.cosmic.burst'), min: 0, max: 1, step: 0.01,
      get: () => c.burstIntensity,
      set: (v) => {
        c.burstIntensity = clampNum(v, 0, 1);
      },
      fmt: (v) => t('panel.cosmic.burstVal', { pct: Math.round(v * 100), n: Math.round(20 + 380 * clampNum(v, 0, 1)) }),
    });

    const energy = slider({
      label: t('panel.cosmic.energy'), min: 0.05, max: 100, log: true,
      get: () => c.rigidityGV,
      set: (v) => {
        c.rigidityGV = clampNum(v, 0.05, 100);
      },
      fmt: (v) => `${v < 1 ? nf(v, 2) : nfs(v, v < 10 ? 2 : 1)} GV`,
      sub: () => {
        const p = PARTICLES[c.particle] ?? PARTICLES.proton;
        const name = particleName(PARTICLE_KEYS.includes(c.particle) ? c.particle : 'proton');
        return t('panel.cosmic.kinetic', { e: fmtEnergy(rigidityToKineticGeV(c.rigidityGV, p)), name });
      },
      after: () => refreshHint(),
    });

    const seg = el('div', { class: 'pn-seg', role: 'radiogroup', 'aria-label': t('panel.cosmic.particle') });
    const segBtns = PARTICLE_KEYS.map((key) => {
      const label = particleName(key);
      const b = el('button', {
        type: 'button', role: 'radio', 'aria-checked': 'false', text: label,
        onclick: () => {
          c.particle = key;
          syncSeg();
          energy.sync();
        },
      });
      b.dataset.key = key;
      seg.appendChild(b);
      return b;
    });
    const syncSeg = () => {
      for (const b of segBtns) {
        const on = b.dataset.key === c.particle ? 'true' : 'false';
        if (b.getAttribute('aria-checked') !== on) b.setAttribute('aria-checked', on);
      }
    };
    syncers.push(syncSeg);

    const hint = el('div', { class: 'pn-hint' });
    const refreshHint = () => {
      const M = Math.abs(state.derived.dipoleMoment);
      let text;
      if (M < 0.03) {
        text = t('panel.cosmic.hintNoShield');
      } else {
        const lat = minLatitudeForRigidity(c.rigidityGV, M);
        text = lat < 0.5
          ? t('panel.cosmic.hintAll')
          : t('panel.cosmic.hintLat', { lat: Math.round(lat) });
      }
      setText(hint, text);
    };
    syncers.push(refreshHint);

    const fire = el('button', {
      class: 'pn-btn pn-btn--primary pn-btn--cosmic pn-btn--block', type: 'button', text: t('panel.cosmic.fire'),
      title: t('panel.cosmic.fireTitle'),
      onclick: () => sim.triggerCosmicBurst(),
    });

    body.append(
      gcr.root, burst.root, energy.root,
      el('div', { class: 'pn-ctl' }, el('div', { class: 'pn-ctl-head' }, el('span', { class: 'pn-lbl', text: t('panel.cosmic.particle') })), seg),
      hint, fire,
    );
  }

  // ================================================================ 3. Güneş rüzgârı
  {
    const body = section('wind', t('panel.wind.title'), 'magnetosphere');
    const w = state.params.solarWind;

    const effText = (cur, base, unit, d, thr) => (Math.abs(cur - base) > thr ? t('panel.wind.effective', { v: nf(cur, d), unit }) : null);

    const speed = slider({
      label: t('panel.wind.speed'), min: 250, max: 1000, step: 10,
      get: () => w.speed,
      set: (v) => {
        w.speed = v;
      },
      fmt: (v) => `${nf(v, 0)} km/s`,
      eff: () => effText(state.sw.speed, w.speed, 'km/s', 0, 1),
    });
    const density = slider({
      label: t('panel.wind.density'), min: 1, max: 50, step: 1,
      get: () => w.density,
      set: (v) => {
        w.density = v;
      },
      fmt: (v) => `${nf(v, 0)} cm⁻³`,
      eff: () => effText(state.sw.density, w.density, 'cm⁻³', 1, 0.2),
    });
    const bz = slider({
      label: 'IMF Bz', min: -30, max: 30, step: 0.5,
      get: () => w.bz,
      set: (v) => {
        w.bz = v;
      },
      fmt: (v) => `${nf(v, 1)} nT`,
      sub: (v) => (v < -0.25
        ? { text: t('panel.wind.bzSouth'), tone: 'warn' }
        : v > 0.25 ? { text: t('panel.wind.bzNorth'), tone: 'calm' } : t('panel.wind.bzFlat')),
      eff: () => effText(state.sw.bz, w.bz, 'nT', 1, 0.2),
    });
    const by = slider({
      label: 'IMF By', min: -20, max: 20, step: 0.5,
      get: () => w.by,
      set: (v) => {
        w.by = v;
      },
      fmt: (v) => `${nf(v, 1)} nT`,
      eff: () => effText(state.sw.by, w.by, 'nT', 1, 0.2),
    });

    body.append(speed.root, density.root, bz.root, by.root);
  }

  // ================================================================ 4. Manyetik alan
  {
    const body = section('field', t('panel.field.title'), 'magnetosphere');

    const field = slider({
      label: t('panel.field.strength'), min: 0, max: 200, step: 1,
      get: () => state.params.fieldStrength * 100,
      set: (v) => sim.setFieldStrength(v / 100),
      fmt: (v) => t('panel.pct', { v: Math.round(v) }),
      sub: (v) => t('panel.field.moment', { v: nf((7.7 * v) / 100, 1) }),
    });

    // Kalkan anahtarı: kapatınca önceki değeri hatırla, açınca geri yükle
    let lastField = 1;
    const shield = toggle(t('panel.field.shield'), {
      get: () => {
        const f = state.params.fieldStrength;
        if (f > 0.01) lastField = f;
        return f > 0.001;
      },
      set: (on) => {
        const f = state.params.fieldStrength;
        if (on) {
          sim.setFieldStrength(lastField > 0.01 ? lastField : 1);
        } else {
          if (f > 0.01) lastField = f;
          sim.setFieldStrength(0);
        }
        field.sync();
      },
    });

    const tilt = toggle(t('panel.field.tilt'), {
      get: () => state.params.realisticTilt,
      set: (on) => {
        state.params.realisticTilt = on;
      },
    });

    const polVal = el('b');
    const pol = el('span', { class: 'pn-pol' }, t('panel.field.polarity'), ' ', polVal);
    const syncPol = () => {
      const normal = state.params.polarity > 0;
      setText(polVal, normal ? t('panel.field.polNormal') : t('panel.field.polReversed'));
      pol.classList.toggle('is-reversed', !normal);
    };
    syncers.push(syncPol);

    const revBtn = el('button', {
      class: 'pn-btn pn-btn--reversal pn-btn--block', type: 'button', text: t('panel.field.reversal'),
      title: t('panel.field.reversalTitle'),
      onclick: () => sim.startPoleReversal(),
    });
    const revFill = el('i');
    const revText = el('div');
    const revBox = el('div', { class: 'pn-rev', hidden: true }, revText, el('div', { class: 'pn-bar' }, revFill));
    const syncRev = () => {
      const rv = state.reversal;
      if (revBtn.disabled !== rv.active) revBtn.disabled = rv.active;
      setHidden(revBox, !rv.active);
      if (rv.active) {
        const pct = Math.round(clampNum(rv.progress, 0, 1) * 100);
        setText(revText, t('panel.field.reversalPct', { pct }));
        const wd = `${pct}%`;
        if (revFill._w !== wd) {
          revFill._w = wd;
          revFill.style.width = wd;
        }
      }
    };
    syncers.push(syncRev);

    const revInfo = el('button', { class: 'pn-link', type: 'button', text: t('panel.field.reversalInfo'), onclick: () => openInfo('reversal') });

    // Hazır senaryolar (kutup tersinmesi ayrı düğmeyle başlar)
    const scDesc = el('div', { class: 'pn-sub' });
    const scDefault = t('panel.field.scenarioDefault');
    setText(scDesc, scDefault);
    const scGrid = el('div', { class: 'pn-grid' });
    for (const id of Object.keys(SCENARIOS)) {
      if (id === 'reversal') continue;
      const sc = SCENARIOS[id];
      const b = el('button', {
        class: 'pn-btn', type: 'button', text: sc.name, title: sc.description,
        onclick: () => sim.applyPreset(id),
      });
      const on = () => setText(scDesc, sc.description);
      const off = () => setText(scDesc, scDefault);
      b.addEventListener('mouseenter', on);
      b.addEventListener('focus', on);
      b.addEventListener('mouseleave', off);
      b.addEventListener('blur', off);
      scGrid.appendChild(b);
    }

    body.append(
      field.root,
      el('div', { class: 'pn-switches' }, shield.root, tilt.root),
      el('div', { class: 'pn-row' }, pol, revInfo),
      revBtn, revBox,
      el('div', { class: 'pn-subhead', text: t('panel.field.scenarios') }),
      scGrid, scDesc,
    );
  }

  // ================================================================ 5. Katmanlar
  {
    const body = section('layers', t('panel.layers.title'), 'controls');
    const list = el('div', { class: 'pn-switches' });
    for (const key of Object.keys(state.params.layers)) {
      const sw = toggle(layerName(key), {
        get: () => state.params.layers[key],
        set: (on) => {
          state.params.layers[key] = on;
          events.emit('layers:changed', { layers: state.params.layers });
        },
      });
      list.appendChild(sw.root);
    }
    body.appendChild(list);
  }

  // ================================================================ 6. Kamera
  {
    const body = section('camera', t('panel.camera.title'), 'controls');
    const grid = el('div', { class: 'pn-grid' });
    const camBtns = [];
    Object.entries(CAMERA_PRESETS).forEach(([name, p], i) => {
      const b = el(
        'button', {
          class: 'pn-btn', type: 'button',
          onclick: () => {
            ctx.cameraRig?.goTo(name);
            events.emit('camera:preset', { name });
          },
        },
        el('span', { class: 'pn-kbd', text: String(i + 1) }),
        p.label,
      );
      b.dataset.cam = name;
      grid.appendChild(b);
      camBtns.push(b);
    });
    syncers.push(() => {
      const cur = ctx.cameraRig?.current;
      for (const b of camBtns) {
        const on = b.dataset.cam === cur;
        if (b.classList.contains('is-active') !== on) b.classList.toggle('is-active', on);
      }
    });
    const rot = toggle(t('panel.camera.autoRotate'), {
      get: () => !!ctx.cameraRig?.autoRotate,
      set: (on) => ctx.cameraRig?.setAutoRotate(on),
    });
    body.append(grid, rot.root);
  }

  // ================================================================ 7. Zaman
  {
    const body = section('time', t('panel.time.title'), 'controls');
    const tm = state.time;

    const scale = slider({
      label: t('panel.time.scale'), min: 0.02, max: 4, log: true,
      get: () => tm.timeScale,
      set: (v) => {
        tm.timeScale = clampNum(v, 0.02, 4);
      },
      fmt: fmtRate,
      sub: (v) => {
        const secs = 24 / v;
        return t('panel.time.dayAbout', { v: secs < 100 ? `${nf(secs, 0)} ${t('panel.unit.sec')}` : `${nfs(secs / 60, 1)} ${t('panel.unit.min')}` });
      },
      eff: () => (tm.fastForward ? t('panel.time.warpActive', { rate: fmtRate(tm.effectiveRate) }) : null),
    });

    const visual = slider({
      label: t('panel.time.visual'), min: 0.1, max: 3, step: 0.05,
      get: () => tm.visualSpeed,
      set: (v) => {
        tm.visualSpeed = clampNum(v, 0.1, 3);
      },
      fmt: (v) => `${nfs(v, 2)}×`,
    });

    const season = slider({
      label: t('panel.time.season'), min: 1, max: 365, step: 1,
      get: () => clampNum(Math.floor(state.frame.dayOfYear), 1, 365),
      set: (v) => sim.setDayOfYear(v),
      fmt: (v) => t('panel.time.day', { d: Math.round(v) }),
      sub: (v) => `${dayLabel(v)} — ${seasonHint(v)}`,
    });

    const warp = toggle(t('panel.time.warp'), {
      get: () => state.params.autoTimeWarp,
      set: (on) => {
        state.params.autoTimeWarp = on;
      },
      cls: 'pn-switch--sun',
    });

    const pauseBtn = el('button', {
      class: 'pn-btn', type: 'button', title: t('panel.time.pauseTitle'),
      onclick: () => {
        tm.paused = !tm.paused;
        syncPause();
      },
    });
    const syncPause = () => setText(pauseBtn, tm.paused ? t('panel.time.resume') : t('panel.time.pause'));
    syncers.push(syncPause);
    const resetBtn = el('button', {
      class: 'pn-btn', type: 'button', text: t('panel.time.reset'), title: t('panel.time.resetTitle'),
      onclick: () => sim.reset(),
    });

    body.append(scale.root, visual.root, season.root, warp.root, el('div', { class: 'pn-grid' }, pauseBtn, resetBtn));
  }

  // --- Alt bilgi
  root.appendChild(
    el(
      'div', { class: 'pn-foot' },
      el('span', {}, t('panel.foot.helpPre'), el('kbd', { text: '?' }), t('panel.foot.helpPost')),
      el('button', { class: 'pn-link', type: 'button', text: t('panel.foot.shortcuts'), onclick: () => openInfo('controls') }),
    ),
  );

  // --- Fare ile tıklandıktan sonra odağı bırak: global klavye kısayolları (Boşluk, F, K …) çalışmaya devam etsin
  root.addEventListener('click', (e) => {
    if (e.detail === 0) return; // klavye ile etkinleştirme: odak kalsın
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a) && a.tagName !== 'SELECT') a.blur();
  });
  const releaseDrag = () => {
    for (const s of sliders) s.dragging = false;
  };
  window.addEventListener('pointerup', releaseDrag);
  window.addEventListener('pointercancel', releaseDrag);

  // --- Dışarıdan gelen değişikliklerde hemen eşitle
  for (const type of ['sim:reset', 'preset:applied', 'storm:launched', 'reversal:start', 'reversal:end']) {
    events.on(type, requestSync);
  }

  const syncAll = () => {
    for (const fn of syncers) fn();
  };
  syncAll();

  return {
    update(dt) {
      acc += dt;
      if (acc < SYNC_INTERVAL) return;
      acc = 0;
      syncAll();
    },
  };
}
