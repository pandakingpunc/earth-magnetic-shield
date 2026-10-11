// @vitest-environment happy-dom
//
// Dil desteği: TR/EN sözlük tutarlılığı, dile duyarlı sayı biçimi ve İngilizce arayüz duman testi
// (tüm düğmeler, senaryolar ve sahne etiketleri sonrasında Türkçe'ye özgü harf kalmamalı).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import tr from '../src/i18n/tr.js';
import en from '../src/i18n/en.js';
import { setLang, getLang, t } from '../src/i18n/index.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('sözlükler', () => {
  it('tr ve en aynı anahtar kümesine sahip', () => {
    const a = Object.keys(tr).sort();
    const b = Object.keys(en).sort();
    expect(a.filter((k) => !(k in en)), 'en’de eksik').toEqual([]);
    expect(b.filter((k) => !(k in tr)), 'tr’de eksik').toEqual([]);
  });

  it('boş değer yok, tümü metin', () => {
    for (const [name, dict] of [['tr', tr], ['en', en]]) {
      for (const [k, v] of Object.entries(dict)) {
        expect(typeof v, `${name}:${k}`).toBe('string');
        expect(v.trim().length, `${name}:${k} boş`).toBeGreaterThan(0);
      }
    }
  });

  it('yer tutucular iki dilde eşleşir', () => {
    for (const k of Object.keys(tr)) {
      if (!(k in en)) continue;
      expect(placeholders(en[k]), k).toEqual(placeholders(tr[k]));
    }
  });

  it('İngilizce metinlerde Türkçe’ye özgü harf yok (özel adlar hariç)', () => {
    const bad = Object.entries(en).filter(([, v]) => TR_CHARS.test(stripAllowed(v))).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe('t() ve dil seçimi', () => {
  it('yer tutucu doldurur, eksik anahtarda anahtarı döndürür', () => {
    setLang('en', { reload: false });
    expect(getLang()).toBe('en');
    expect(t('date.dayMonth', { d: 20, m: 'March' })).toBe('March 20');
    expect(t('yok.boyle.bir.anahtar')).toBe('yok.boyle.bir.anahtar');
    expect(document.documentElement.lang).toBe('en');
    setLang('tr', { reload: false });
    expect(t('date.dayMonth', { d: 20, m: 'Mart' })).toBe('20 Mart');
  });

  it('sayı biçimi dile duyarlı', async () => {
    const { nf, nfs, nint, nfSigned } = await import('../src/core/format.js');
    setLang('en', { reload: false });
    expect(nf(-3.26, 1)).toBe('−3.3');
    expect(nfs(2.0, 2)).toBe('2');
    expect(nfs(2.5, 2)).toBe('2.5');
    expect(nfSigned(3.2, 1)).toBe('+3.2');
    expect(nint(2020)).toBe('2,020');
    expect(nint(-1234567)).toBe('−1,234,567');
    setLang('tr', { reload: false });
    expect(nfs(2.5, 2)).toBe('2,5');
    expect(nint(2020)).toBe('2 020');
  });
});

// Türkçe'ye özgü harfler ve izin verilen özel adlar
const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const ALLOWED = ['İstanbul', 'İzmir', 'Türksat', 'Québec', 'Türkçe', 'Türkiye', 'Manyetik Kalkan', 'Störmer', 'Ørsted'];
function stripAllowed(s) {
  let out = s;
  for (const w of ALLOWED) out = out.split(w).join('');
  return out;
}
function turkishFragments(text) {
  const clean = stripAllowed(text);
  const out = new Set();
  for (const m of clean.matchAll(/[^\s]*[çğıöşüÇĞİÖŞÜ][^\s]*/g)) out.add(m[0]);
  return [...out];
}

function setupDom() {
  document.body.innerHTML = `
    <div id="app"></div><header id="topbar"></header><aside id="panel"></aside><aside id="hud"></aside>
    <section id="bottom"><div id="charts"></div><div id="log"></div></section>
    <div id="toasts"></div><div id="info-modal" hidden></div>`;
}

describe('İngilizce arayüz (lang=en)', () => {
  it('tüm düğmeler, senaryolar ve sahne etiketleri sonrasında Türkçe harf kalmaz', async () => {
    setLang('en', { reload: false });
    setupDom();
    // Modüller dil seçildikten sonra yüklenir (modül düzeyindeki metinler de İngilizce olsun)
    const { createState } = await import('../src/core/state.js');
    const { EventBus } = await import('../src/core/events.js');
    const { SpaceWeatherSim, SCENARIOS } = await import('../src/core/simulation.js');
    const { STORM_PRESETS } = await import('../src/physics/stormProfile.js');
    const { CameraRig } = await import('../src/scene/cameraRig.js');
    const layerModules = await Promise.all([
      import('../src/scene/starfield.js'),
      import('../src/scene/sun.js'),
      import('../src/scene/earth.js'),
      import('../src/scene/magnetosphere.js'),
      import('../src/scene/solarWind.js'),
      import('../src/scene/radiationBelts.js'),
      import('../src/scene/aurora.js'),
      import('../src/scene/cosmicRays.js'),
      import('../src/scene/satellites.js'),
    ]);
    const { createUI } = await import('../src/ui/ui.js');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 3000);
    camera.position.set(26, 15, 38);
    const controls = { target: new THREE.Vector3(), update() {}, autoRotate: false, autoRotateSpeed: 1 };
    const renderer = {
      domElement: document.createElement('canvas'),
      capabilities: { getMaxAnisotropy: () => 1, isWebGL2: true },
      getPixelRatio: () => 1,
      setPixelRatio() {},
      getSize: (v) => v.set(1600, 900),
    };
    const state = createState();
    state.perf = { fps: 60 };
    const events = new EventBus();
    const sim = new SpaceWeatherSim(state, events);
    const cameraRig = new CameraRig(camera, controls);
    const textures = { earthDay: null, earthNight: null, earthClouds: null, earthSpecular: null, earthNormal: null, moon: null };
    const ctx = { scene, camera, renderer, controls, state, events, sim, textures, cameraRig, bloom: { strength: 0.85 } };
    const layers = {};
    for (const mod of layerModules) {
      const Cls = Object.values(mod).find((v) => typeof v === 'function' && /Layer$/.test(v.name));
      layers[Cls.name] = new Cls(ctx);
    }
    ctx.layers = layers;
    const ui = createUI(ctx);

    // Sahne etiketlerinin (CSS2D) metinlerini topla
    const labelTexts = new Set();
    const collectLabels = () => {
      scene.traverse((o) => {
        if (o.isCSS2DObject && o.element) labelTexts.add(o.element.textContent);
      });
    };
    const step = (n, dt = 1 / 30) => {
      for (let i = 0; i < n; i++) {
        const { simDt, visDt } = sim.update(dt);
        for (const l of Object.values(layers)) l.update(visDt, simDt, dt);
        ui.update(dt);
      }
      collectLabels();
    };
    // Kayan bildirimlerin ve bilgi penceresinin metinleri DOM'dan kalkabilir: biriktir
    const seen = new Set();
    const snap = () => {
      seen.add(document.body.textContent);
      for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
        for (const a of ['title', 'aria-label', 'placeholder']) if (el.getAttribute(a)) seen.add(el.getAttribute(a));
      }
    };

    step(60);
    snap();
    // Girişler
    for (const input of document.querySelectorAll('input, select')) {
      if (input.type === 'checkbox') {
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (input.tagName === 'SELECT') {
        for (let i = 0; i < input.options.length; i++) {
          input.selectedIndex = i;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          ui.update(1 / 60);
          snap();
        }
      } else if (input.type === 'range') {
        for (const v of [input.min ?? '0', input.max ?? '1']) {
          input.value = v;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          ui.update(1 / 60);
          snap();
        }
      }
    }
    // Düğmeler (dil anahtarı hariç: sayfayı yeniden yükler)
    for (const btn of document.querySelectorAll('button:not([data-lang])')) {
      btn.click();
      step(2);
      snap();
    }
    // Senaryolar, tarihî fırtınalar, kozmik patlamalar, tersinme
    for (const id of [...Object.keys(SCENARIOS), ...Object.keys(STORM_PRESETS)]) {
      sim.reset();
      sim.applyPreset(id);
      step(200);
      snap();
    }
    sim.reset();
    sim.triggerSolarStorm({ strength: 1 });
    state.time.timeScale = 2;
    step(600);
    snap();
    for (const particle of ['proton', 'electron', 'alpha']) {
      sim.triggerCosmicBurst({ intensity: 1, rigidityGV: 2, particle });
      step(60);
      snap();
    }
    sim.startPoleReversal();
    step(800);
    snap();
    sim.setFieldStrength(0);
    step(60);
    snap();
    // Bilgi penceresi konuları
    for (const topic of ['magnetosphere', 'solarStorm', 'cosmicRays', 'vanAllen', 'aurora', 'indices', 'reversal', 'controls', 'about']) {
      ctx.ui?.openInfo?.(topic);
      document.querySelector('#info-modal button')?.click?.();
    }
    const infoRoot = document.querySelector('#info-modal');
    snap();
    // Bilgi konularını doğrudan aç
    const { createInfo } = await import('../src/ui/info.js');
    const info = createInfo({ ...ctx, ui: { openInfo() {}, toggleHidden() {} } });
    for (const topic of ['magnetosphere', 'solarStorm', 'cosmicRays', 'vanAllen', 'aurora', 'indices', 'reversal', 'controls', 'about']) {
      info.open(topic);
      seen.add(infoRoot.textContent);
    }
    // Günlük kayıtları
    for (const l of state.log) seen.add(l.text);

    const frags = new Set();
    for (const s of [...seen, ...labelTexts]) for (const f of turkishFragments(s)) frags.add(f);
    expect([...frags].sort()).toEqual([]);
    setLang('tr', { reload: false });
  });
});
