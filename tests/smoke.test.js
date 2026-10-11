// @vitest-environment happy-dom
//
// Duman testi: tüm sahne katmanlarını ve arayüzü WebGL olmadan oluşturur, çeşitli senaryolarda
// çalıştırır; çalışma zamanı hatalarını, NaN geometrileri ve kaba performansı yakalar.
// Gölgelendirici (GLSL) derleme hataları burada yakalanamaz — onlar tarayıcıda denetlenir.

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { createState } from '../src/core/state.js';
import { EventBus } from '../src/core/events.js';
import { SpaceWeatherSim } from '../src/core/simulation.js';
import { CameraRig } from '../src/scene/cameraRig.js';
import { StarfieldLayer } from '../src/scene/starfield.js';
import { SunLayer } from '../src/scene/sun.js';
import { EarthLayer } from '../src/scene/earth.js';
import { MagnetosphereLayer } from '../src/scene/magnetosphere.js';
import { SolarWindLayer } from '../src/scene/solarWind.js';
import { CosmicRayLayer } from '../src/scene/cosmicRays.js';
import { RadiationBeltLayer } from '../src/scene/radiationBelts.js';
import { AuroraLayer } from '../src/scene/aurora.js';
import { SatelliteLayer } from '../src/scene/satellites.js';

const ALL_LAYER_CLASSES = {
  stars: StarfieldLayer,
  sun: SunLayer,
  earth: EarthLayer,
  magnetosphere: MagnetosphereLayer,
  solarWind: SolarWindLayer,
  belts: RadiationBeltLayer,
  aurora: AuroraLayer,
  cosmicRays: CosmicRayLayer,
  satellites: SatelliteLayer,
};

// İsteğe bağlı: yalnızca belirli katmanları sına (ör. SMOKE_LAYERS=earth,sun npx vitest run tests/smoke.test.js)
const ONLY = (process.env.SMOKE_LAYERS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LAYER_CLASSES = ONLY.length
  ? Object.fromEntries(Object.entries(ALL_LAYER_CLASSES).filter(([k]) => ONLY.includes(k)))
  : ALL_LAYER_CLASSES;
const SKIP_UI = process.env.SMOKE_UI === '0';

function setupDom() {
  document.body.innerHTML = `
    <div id="app"></div><header id="topbar"></header><aside id="panel"></aside><aside id="hud"></aside>
    <section id="bottom"><div id="charts"></div><div id="log"></div></section>
    <div id="toasts"></div><div id="info-modal" hidden></div>`;
}

function makeCtx(textures) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 3000);
  camera.position.set(26, 15, 38);
  const controls = { target: new THREE.Vector3(), update() {}, autoRotate: false, autoRotateSpeed: 1 };
  const canvas = document.createElement('canvas');
  const renderer = {
    domElement: canvas,
    capabilities: { getMaxAnisotropy: () => 1, isWebGL2: true },
    getPixelRatio: () => 1,
    setPixelRatio() {},
    getSize: (v) => v.set(1600, 900),
  };
  const state = createState();
  const events = new EventBus();
  const sim = new SpaceWeatherSim(state, events);
  const cameraRig = new CameraRig(camera, controls);
  return { scene, camera, renderer, controls, state, events, sim, textures, cameraRig, bloom: { strength: 0.85 } };
}

function fakeTextures() {
  const t = () => {
    const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  };
  return { earthDay: t(), earthNight: t(), earthClouds: t(), earthSpecular: t(), earthNormal: t(), moon: t() };
}

function findNaN(scene) {
  const bad = [];
  scene.traverse((o) => {
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    const arr = pos.array;
    const n = Math.min(arr.length, (o.geometry.drawRange?.count ?? Infinity) * pos.itemSize || arr.length);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(arr[i])) {
        bad.push(`${o.name || o.type} (${o.parent?.name || ''}) idx ${i}`);
        break;
      }
    }
    for (const k of ['x', 'y', 'z']) if (!Number.isFinite(o.position[k])) bad.push(`${o.name || o.type} position.${k}`);
  });
  return bad;
}

function runFrames(ctx, layers, n, timing, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    const { simDt, visDt } = ctx.sim.update(dt);
    for (const [name, layer] of Object.entries(layers)) {
      const t0 = performance.now();
      layer.update(visDt, simDt, dt);
      timing[name] = (timing[name] ?? 0) + performance.now() - t0;
    }
  }
}

describe.skipIf(ONLY.length === 1 && ONLY[0] === 'none').each([
  ['dokusuz (prosedürel yedek)', () => null],
  ['dokulu', fakeTextures],
])('sahne katmanları — %s', (_label, texFactory) => {
  let ctx;
  let layers;
  const timing = {};
  let frames = 0;

  beforeAll(() => {
    setupDom();
    const tex = texFactory();
    ctx = makeCtx(tex ?? { earthDay: null, earthNight: null, earthClouds: null, earthSpecular: null, earthNormal: null, moon: null });
    layers = {};
    for (const [name, Cls] of Object.entries(LAYER_CLASSES)) layers[name] = new Cls(ctx);
    ctx.layers = layers;
  });

  it('sakin koşullarda çalışır', () => {
    runFrames(ctx, layers, 120, timing);
    frames += 120;
    expect(findNaN(ctx.scene)).toEqual([]);
  });

  it('aşırı güneş fırtınası (yolculuk → varış → bulut)', () => {
    ctx.state.time.timeScale = 2;
    ctx.sim.triggerSolarStorm({ strength: 1 });
    runFrames(ctx, layers, 900, timing);
    frames += 900;
    expect(ctx.state.storms.length === 0 || ctx.state.storms[0].arrived).toBe(true);
    expect(findNaN(ctx.scene)).toEqual([]);
  });

  it('kozmik ışın patlamaları (proton, elektron, alfa; düşük ve yüksek sertlik)', () => {
    for (const [particle, R] of [['proton', 0.3], ['electron', 2], ['alpha', 40], ['proton', 100]]) {
      ctx.sim.triggerCosmicBurst({ intensity: 1, rigidityGV: R, particle });
      runFrames(ctx, layers, 90, timing);
      frames += 90;
    }
    expect(findNaN(ctx.scene)).toEqual([]);
  });

  it('kalkan kapalı + kutup tersinmesi', () => {
    ctx.sim.setFieldStrength(0);
    runFrames(ctx, layers, 120, timing);
    ctx.sim.setFieldStrength(1);
    ctx.sim.startPoleReversal();
    runFrames(ctx, layers, 60 * 26, timing);
    frames += 120 + 60 * 26;
    expect(ctx.state.params.polarity).toBe(-1);
    expect(findNaN(ctx.scene)).toEqual([]);
  });

  it('katmanlar kapatılıp açılabilir, duraklatma çalışır', () => {
    for (const k of Object.keys(ctx.state.params.layers)) ctx.state.params.layers[k] = false;
    runFrames(ctx, layers, 30, timing);
    for (const k of Object.keys(ctx.state.params.layers)) ctx.state.params.layers[k] = true;
    ctx.state.time.paused = true;
    runFrames(ctx, layers, 30, timing);
    ctx.state.time.paused = false;
    ctx.sim.reset();
    ctx.sim.applyPreset('laschamp');
    ctx.sim.setDayOfYear(172);
    runFrames(ctx, layers, 60, timing);
    frames += 120;
    expect(findNaN(ctx.scene)).toEqual([]);
  });

  it('kaba performans raporu (node, WebGL yok)', () => {
    const report = Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, +(v / frames).toFixed(3)]));
    console.log('Ortalama ms/kare:', report);
    for (const [name, ms] of Object.entries(report)) expect(ms, `${name} çok yavaş`).toBeLessThan(6);
  });

  it('dispose hatasız', () => {
    for (const layer of Object.values(layers)) layer.dispose();
  });
});

describe.skipIf(SKIP_UI)('arayüz', () => {
  it('oluşturulur, düğmeler ve girişler hatasız çalışır', async () => {
    setupDom();
    const ctx = makeCtx({ earthDay: null, earthNight: null, earthClouds: null, earthSpecular: null, earthNormal: null, moon: null });
    ctx.layers = {};
    ctx.state.perf = { fps: 60 };
    const { createUI } = await import('../src/ui/ui.js');
    const ui = createUI(ctx);
    for (let i = 0; i < 60; i++) {
      ctx.sim.update(1 / 60);
      ui.update(1 / 60);
    }
    const errors = [];
    const origError = console.error;
    console.error = (...a) => {
      errors.push(a.map(String).join(' '));
      origError(...a);
    };
    try {
      for (const sel of ['#topbar', '#panel', '#hud', '#charts', '#log']) {
        const root = document.querySelector(sel);
        expect(root.children.length, `${sel} boş`).toBeGreaterThan(0);
      }
      // Tüm giriş öğelerini oynat
      for (const input of document.querySelectorAll('input, select')) {
        if (input.type === 'checkbox') {
          input.checked = !input.checked;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (input.tagName === 'SELECT') {
          if (input.options.length > 1) input.selectedIndex = input.options.length - 1;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (input.type === 'range') {
          input.value = input.max ?? '1';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        ui.update(1 / 60);
      }
      // Tüm düğmelere tıkla
      for (const btn of document.querySelectorAll('button:not([data-lang])')) {
        btn.click();
        ctx.sim.update(1 / 60);
        ui.update(1 / 60);
      }
      // Bilgi penceresi konuları
      for (const topic of ['magnetosphere', 'solarStorm', 'cosmicRays', 'vanAllen', 'aurora', 'indices', 'reversal', 'controls', 'about']) {
        ctx.ui?.openInfo?.(topic);
      }
      // Klavye kısayolları
      for (const key of [' ', 'f', 'k', 'h', 'l', '1', '2', 'Escape']) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        ui.update(1 / 60);
      }
      for (let i = 0; i < 120; i++) {
        ctx.sim.update(1 / 30);
        ui.update(1 / 30);
      }
    } finally {
      console.error = origError;
    }
    expect(errors.filter((e) => e.includes('arayüz'))).toEqual([]);
  });
});
