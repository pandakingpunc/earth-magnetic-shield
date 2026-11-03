// v1.1 arayüz/görünüm yardımcıları: URL parametreleri, kalite otomatiği (histerezis), dil değişimi anlık görüntüsü,
// paylaşım bağlantısı, etiket çakışma önleyici.
// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';
import { createState } from '../src/core/state.js';
import {
  parseUrlParams, buildShareUrl, screenshotName, createAutoQuality, stepAutoQuality, pixelRatioFor, msaaSamplesFor,
  makeSnapshot, saveSnapshot, takeSnapshot, applySnapshot, copyText, QUALITY_PROFILES, SNAPSHOT_KEY,
} from '../src/core/viewState.js';
import { onBeforeLangReload, runBeforeLangReload } from '../src/i18n/index.js';
import { declutterLabels } from '../src/scene/labels.js';
import { STORM_PRESETS } from '../src/physics/stormProfile.js';
import { SCENARIOS } from '../src/core/simulation.js';
import { CAMERA_PRESETS } from '../src/scene/cameraRig.js';

const known = { presets: [...Object.keys(STORM_PRESETS), ...Object.keys(SCENARIOS)], cams: Object.keys(CAMERA_PRESETS) };

describe('parseUrlParams', () => {
  it('bilinen önayar ve kamerayı okur', () => {
    const preset = Object.keys(STORM_PRESETS)[0];
    expect(parseUrlParams(`?lang=en&preset=${preset}&cam=tail`, known)).toEqual({ preset, cam: 'tail' });
    expect(parseUrlParams('?preset=quiet', known).preset).toBe('quiet');
  });
  it('bilinmeyen/boş değerleri sessizce yok sayar', () => {
    expect(parseUrlParams('?preset=nope&cam=zzz', known)).toEqual({ preset: null, cam: null });
    expect(parseUrlParams('', known)).toEqual({ preset: null, cam: null });
    expect(parseUrlParams(undefined, known)).toEqual({ preset: null, cam: null });
    expect(parseUrlParams('?preset=quiet', {})).toEqual({ preset: null, cam: null });
  });
});

describe('buildShareUrl / screenshotName', () => {
  it('yalnızca lang, preset, cam taşır; eski parametre ve hash düşer', () => {
    const u = buildShareUrl('https://x.test/app/?foo=1&lang=tr#h', { lang: 'en', preset: 'quiet', cam: 'tail' });
    expect(u).toBe('https://x.test/app/?lang=en&preset=quiet&cam=tail');
    expect(buildShareUrl('https://x.test/', { lang: 'tr', preset: null, cam: null })).toBe('https://x.test/?lang=tr');
  });
  it('dosya adı biçimi', () => {
    expect(screenshotName(new Date(2026, 0, 5, 9, 7))).toBe('manyetik-kalkan-20260105-0907.png');
  });
  it('copyText: clipboard/execCommand yoksa fırlatmaz', async () => {
    await expect(copyText('x')).resolves.toBeTypeOf('boolean');
  });
});

describe('kalite profilleri', () => {
  it('düşük: DPR 1, MSAA yok, bloom kapalı; yüksek: mevcut davranış', () => {
    expect(pixelRatioFor('low', 3)).toBe(1);
    expect(pixelRatioFor('medium', 3)).toBe(1.25);
    expect(pixelRatioFor('high', 3)).toBe(2);
    expect(pixelRatioFor('high', 1.5)).toBe(1.5);
    expect(msaaSamplesFor('low', 1)).toBe(0);
    expect(msaaSamplesFor('high', 2)).toBe(2);
    expect(msaaSamplesFor('high', 1)).toBe(4);
    expect(QUALITY_PROFILES.low.bloom).toBe(false);
    expect(QUALITY_PROFILES.medium.bloom).toBe(true);
  });
  it('varsayılan params.quality auto', () => {
    expect(createState().params.quality).toBe('auto');
  });
});

describe('stepAutoQuality (histerezis)', () => {
  const run = (s, fps, seconds, step = 0.5) => {
    let last = -1;
    for (let t = 0; t < seconds; t += step) {
      const r = stepAutoQuality(s, fps, step);
      if (r >= 0) last = r;
    }
    return last;
  };
  it('~3 sn düşük FPS bir kademe indirir; 2 sn yetmez', () => {
    const s = createAutoQuality(0);
    expect(run(s, 30, 2)).toBe(-1);
    expect(s.level).toBe(0);
    expect(run(s, 30, 1.5)).toBe(1);
    expect(s.level).toBe(1);
  });
  it('arada iyi bir ölçüm sayacı sıfırlar', () => {
    const s = createAutoQuality(0);
    run(s, 30, 2.5);
    run(s, 50, 0.5);
    run(s, 30, 2.5);
    expect(s.level).toBe(0);
  });
  it('yukarı çıkış 58 FPS üstünde ~10 sn gerektirir; 40-58 arası bölge bekletir', () => {
    const s = createAutoQuality(2);
    run(s, 70, 9);
    expect(s.level).toBe(2);
    run(s, 50, 20); // ölü bölge
    expect(s.level).toBe(2);
    run(s, 70, 10.5);
    expect(s.level).toBe(1);
  });
  it('en alt/üst düzeyin ötesine geçmez', () => {
    const lo = createAutoQuality(2);
    run(lo, 5, 30);
    expect(lo.level).toBe(2);
    const hi = createAutoQuality(0);
    run(hi, 120, 60);
    expect(hi.level).toBe(0);
  });
  it('dakikada en çok 3 değişiklik', () => {
    const s = createAutoQuality(0);
    let n = 0;
    // 3 sn düşük + 10.5 sn yüksek döngüsü: sınırsız olsa sürekli salınırdı
    for (let i = 0; i < 100 && s.clock < 45; i++) {
      for (let k = 0; k < 6; k++) if (stepAutoQuality(s, 20, 0.5) >= 0) n++;
      for (let k = 0; k < 21; k++) if (stepAutoQuality(s, 90, 0.5) >= 0) n++;
    }
    expect(n).toBeLessThanOrEqual(3);
  });
  it('geçersiz FPS yok sayılır', () => {
    const s = createAutoQuality(0);
    expect(stepAutoQuality(s, NaN, 5)).toBe(-1);
  });
});

describe('dil değişimi anlık görüntüsü', () => {
  const memStore = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
  };
  const fakeCam = { position: { x: 1, y: 2, z: 3 } };
  const fakeCtl = { target: { x: -4, y: 0, z: 0 } };

  it('kaydet, oku, uygula; anahtar bir kez geçerli', () => {
    const a = createState();
    a.params.layers.labels = false;
    a.params.solarWind.speed = 777;
    a.params.fieldStrength = 0.4;
    a.params.stormStrength = 0.9;
    a.params.stormPresetId = 'x';
    a.params.quality = 'low';
    a.time.timeScale = 2;
    const st = memStore();
    expect(saveSnapshot(makeSnapshot(a, fakeCam, fakeCtl), st)).toBe(true);
    const snap = takeSnapshot(st);
    expect(st.m.has(SNAPSHOT_KEY)).toBe(false);
    expect(takeSnapshot(st)).toBeNull();

    const b = createState();
    const cam = applySnapshot(b, snap);
    expect(b.params.layers.labels).toBe(false);
    expect(b.params.solarWind.speed).toBe(777);
    expect(b.params.fieldStrength).toBe(0.4);
    expect(b.params.stormStrength).toBe(0.9);
    expect(b.params.stormPresetId).toBe('x');
    expect(b.params.quality).toBe('low');
    expect(b.time.timeScale).toBe(2);
    expect(cam).toEqual({ pos: [1, 2, 3], target: [-4, 0, 0] });
  });
  it('bozuk/yabancı veriyi reddeder, depo hatasında fırlatmaz', () => {
    const b = createState();
    expect(applySnapshot(b, { quality: 'ultra', fieldStrength: 'a', layers: { labels: 'x', bogus: true }, cam: { pos: [1], target: [1, 2, 3] } })).toBeNull();
    expect(b.params.quality).toBe('auto');
    expect(b.params.fieldStrength).toBe(1);
    expect('bogus' in b.params.layers).toBe(false);
    const bad = { getItem: () => '{oops', removeItem() {}, setItem() { throw new Error('dolu'); } };
    expect(takeSnapshot(bad)).toBeNull();
    expect(saveSnapshot({}, bad)).toBe(false);
    expect(takeSnapshot(null)).toBeNull();
  });
  it('setLang kancası: runBeforeLangReload kayıtlı işlevleri çağırır, hatayı yutar', () => {
    const ok = vi.fn();
    onBeforeLangReload(() => {
      throw new Error('x');
    });
    onBeforeLangReload(ok);
    expect(() => runBeforeLangReload()).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });
});

describe('declutterLabels', () => {
  it('çakışanı gizler; kamera/etiket değişmediyse ölçümü atlar', () => {
    const box = document.createElement('div');
    const mk = (cls, text) => {
      const e = document.createElement('div');
      e.className = `scene-label scene-label--${cls}`;
      e.textContent = text;
      box.appendChild(e);
      return e;
    };
    const a = mk('danger', 'a');
    const b = mk('small', 'b');
    let measured = 0;
    const rect = { left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 };
    for (const e of [a, b]) e.getBoundingClientRect = () => (measured++, rect);
    const cam = { matrixWorld: { elements: new Array(16).fill(0) } };
    declutterLabels(box, 3, cam);
    expect(a.classList.contains('is-occluded')).toBe(false);
    expect(b.classList.contains('is-occluded')).toBe(true);
    const m1 = measured;
    declutterLabels(box, 3, cam); // değişiklik yok: atla
    expect(measured).toBe(m1);
    cam.matrixWorld.elements[12] = 5; // kamera oynadı: yeniden ölç
    declutterLabels(box, 3, cam);
    expect(measured).toBeGreaterThan(m1);
    declutterLabels(box); // kamerasız çağrı her zaman tarar
  });
});
