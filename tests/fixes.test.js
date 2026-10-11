// Düzeltme turu testleri: duraklatma, Kp penceresi, kalkan–Kp bağı, Dst sınıfları, önayar Dst’leri,
// analitik engellenen oran, İstanbul gece/gündüz ve ortak sayı biçimi.

import { describe, it, expect } from 'vitest';
import { createState } from '../src/core/state.js';
import { EventBus } from '../src/core/events.js';
import { SpaceWeatherSim } from '../src/core/simulation.js';
import { cosmicBlockedFraction, dstClass, DST_THRESHOLDS, gScale } from '../src/physics/indices.js';
import { predictStormOutcome, stormParamsFromStrength, strengthLabel } from '../src/physics/stormProfile.js';
import { nf, nfs, nfSigned, nint } from '../src/core/format.js';

const mk = () => {
  const state = createState();
  const events = new EventBus();
  const sim = new SpaceWeatherSim(state, events);
  return { state, events, sim };
};

describe('ortak sayı biçimi (Türkçe)', () => {
  it('ondalık virgül, gerçek eksi, -0 yok, ince boşluklu binlik', () => {
    expect(nf(-3.25, 1)).toBe('−3,3');
    expect(nf(-0.04, 1)).toBe('0,0');
    expect(nf(NaN)).toBe('—');
    expect(nfs(2, 2)).toBe('2');
    expect(nfSigned(3.2, 1)).toBe('+3,2');
    expect(nfSigned(-3.2, 1)).toBe('−3,2');
    expect(nint(2020)).toBe('2 020');
    expect(nint(-436.4)).toBe('−436');
  });
});

describe('NOAA G ve Dst sınıfları, fırtına etiketleri', () => {
  it('G5 yalnızca Kp 9’a yakın; 9− hâlâ G4', () => {
    expect(gScale(8.67)).toBe(4);
    expect(gScale(8.9)).toBe(5);
  });

  it('tek Dst eşik tablosu: −100 yoğun, −250 süper', () => {
    expect(dstClass(-5)).toBe('Sakin');
    expect(dstClass(-120)).toBe('Yoğun fırtına');
    expect(dstClass(-260)).toBe('Süper fırtına');
    expect(dstClass(-700)).toBe('Süper fırtına');
    expect(DST_THRESHOLDS.superstorm).toBe(-250);
  });

  it('“Carrington sınıfı” yalnızca Dst ≲ −850 nT için; etiket G düzeyiyle çelişmez', () => {
    expect(strengthLabel(0.8)).not.toContain('Carrington');
    expect(strengthLabel(0.95)).not.toContain('Carrington');
    expect(strengthLabel(1)).toContain('Carrington');
    const o = predictStormOutcome(stormParamsFromStrength(0.5));
    expect(o.g).toBe(4);
    expect(strengthLabel(0.5)).toBe('Şiddetli'); // G4 = NOAA “Şiddetli”
  });

  it('tarihî önayarlar gözlenen Dst’ye yakın (±%5); “Beklenen” tahmin simülasyonla aynı', () => {
    const observed = { quebec1989: -589, halloween2003: -383, gannon2024: -412 };
    for (const [id, obs] of Object.entries(observed)) {
      const { state, sim } = mk();
      state.time.timeScale = 1;
      const storm = sim.applyPreset(id);
      let minDst = 0;
      for (let i = 0; i < 30 * 160; i++) {
        sim.update(1 / 30);
        minDst = Math.min(minDst, state.derived.dst);
      }
      expect(Math.abs(minDst - obs) / Math.abs(obs), id).toBeLessThan(0.05);
      expect(Math.abs(storm.predicted.dstMin - minDst), id).toBeLessThan(8);
    }
  });
});

describe('kalkanın engellediği kozmik ışın oranı (analitik)', () => {
  it('alan yokken 0, alan arttıkça tekdüze artar', () => {
    expect(cosmicBlockedFraction(0)).toBe(0);
    let prev = -1;
    for (const M of [0.02, 0.06, 0.25, 0.5, 1, 2]) {
      const f = cosmicBlockedFraction(M);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
    expect(cosmicBlockedFraction(1)).toBeGreaterThan(0.7);
    expect(cosmicBlockedFraction(1)).toBeLessThan(1);
    expect(cosmicBlockedFraction(0.06)).toBeLessThan(0.4);
  });
});

describe('simülasyon: duraklatma, pencere, Kp ve etkiler', () => {
  it('duraklatılmışken sıfırlama ve kaydırıcı değişiklikleri türetilmiş değerlere yansır', () => {
    const { state, sim } = mk();
    state.time.timeScale = 1;
    sim.triggerSolarStorm({ strength: 1, presetId: null });
    for (let i = 0; i < 60 * 14; i++) sim.update(1 / 60);
    expect(state.sw.speed).toBeGreaterThan(1500);
    state.time.paused = true;
    sim.reset();
    for (let i = 0; i < 10; i++) sim.update(1 / 60);
    expect(state.storms.length).toBe(0);
    expect(state.sw.speed).toBe(400);
    expect(state.derived.r0).toBeGreaterThan(10);
    expect(state.derived.kp).toBeLessThan(2.5);
    expect(state.history.t.length).toBeGreaterThan(0);
    sim.setFieldStrength(0);
    sim.update(1 / 60);
    expect(state.derived.shieldStrength).toBe(0);
    expect(state.derived.r0).toBeCloseTo(1.08, 2);
    state.params.solarWind.speed = 900;
    sim.update(1 / 60);
    expect(state.sw.speed).toBe(900);
  });

  it('fırtına ortasında duraklatmak Kp/Dst/geçmişi değiştirmez ve pencereyi şişirmez', () => {
    const { state, sim } = mk();
    state.time.timeScale = 1;
    sim.triggerSolarStorm({ strength: 1, presetId: null });
    for (let i = 0; i < 60 * 24; i++) sim.update(1 / 60);
    const snap = () => [state.derived.kp, state.derived.dst, state.derived.kpMax24, state.history.t.length, sim._kpRecent.length];
    const before = snap();
    state.time.paused = true;
    for (let i = 0; i < 300; i++) sim.update(1 / 60);
    expect(snap()).toEqual(before);
  });

  it('son 24 saatin en büyük Kp’si kare hızına bağlı değildir', () => {
    const results = [];
    for (const fps of [30, 144]) {
      const { state, sim } = mk();
      sim.applyPreset('halloween2003');
      const log = [];
      for (let i = 0; i < fps * 220; i++) {
        sim.update(1 / fps);
        log.push([state.time.simHours, state.derived.kp]);
      }
      const now = state.time.simHours;
      const trueMax = log.filter((e) => e[0] >= now - 24).reduce((m, e) => Math.max(m, e[1]), 0);
      expect(Math.abs(state.derived.kpMax24 - trueMax)).toBeLessThan(0.1);
      results.push(state.derived.kpMax24);
    }
    expect(Math.abs(results[0] - results[1])).toBeLessThan(0.1);
  });

  it('manyetik alan yokken fırtınada bile Kp/G ve şebeke riski sönük kalır', () => {
    const { state, sim } = mk();
    state.time.timeScale = 1;
    sim.applyPreset('halloween2003');
    state.params.fieldStrength = 0;
    let maxKp = 0;
    let maxGrid = 0;
    for (let i = 0; i < 30 * 40; i++) {
      sim.update(1 / 30);
      maxKp = Math.max(maxKp, state.derived.kp);
      maxGrid = Math.max(maxGrid, state.derived.impacts.gridRisk);
    }
    expect(maxKp).toBeLessThan(3.5);
    expect(maxGrid).toBeLessThan(0.1);
  });

  it('CME varış uyarısı rampa öncesi değil, fırtınanın tepe hızını söyler', () => {
    const { state, sim } = mk();
    sim.triggerSolarStorm({ strength: 1, presetId: null });
    const vPeak = state.storms[0].vPeak;
    for (let i = 0; i < 60 * 12; i++) sim.update(1 / 60);
    const a = state.log.find((l) => l.text.includes('CME şoku'));
    expect(a).toBeTruthy();
    expect(a.text).toContain(nint(vPeak));
  });

  it('İstanbul’un manyetik enlemi tersinmede canlı dipol eksenini izler', () => {
    const { state, sim } = mk();
    sim.startPoleReversal();
    const seen = [];
    for (let i = 0; i < 60 * 25; i++) {
      sim.update(1 / 60);
      if (i % 30 === 0) seen.push(state.derived.istanbulMagLat);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(20); // 38°’de sabit kalmaz
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0); // mutlak değer
  });

  it('sıfırlama alt fırtına sayacını sıfırlar', () => {
    const { state, sim } = mk();
    state.time.timeScale = 2;
    sim.triggerSolarStorm({ strength: 1, presetId: null });
    for (let i = 0; i < 60 * 25; i++) sim.update(1 / 30);
    expect(state.derived.substormCount).toBeGreaterThan(0);
    sim.reset();
    expect(state.derived.substormCount).toBe(0);
  });

  it('zaman hızlandırmada kısa süren patlama R rozetinde birkaç gerçek saniye görünür', () => {
    const { state, sim } = mk();
    sim.triggerSolarStorm({ strength: 1, presetId: null });
    let frames = 0;
    for (let i = 0; i < 60 * 10; i++) {
      sim.update(1 / 60);
      if (state.derived.r > 0) frames++;
    }
    expect(frames).toBeGreaterThan(60 * 3);
  });

  it('İstanbul’da gündüz aurora gözlenemez (turkeyDark), gece gözlenir', () => {
    const { state, sim } = mk();
    sim.update(0.001); // başlangıç 12:00 UT = 15:00 TRT
    expect(state.derived.turkeyDark).toBe(false);
    expect(state.derived.istanbulSunElevDeg).toBeGreaterThan(0);
    state.time.simHours = 10; // 22:00 UT = 01:00 TRT
    sim.update(0.001);
    expect(state.derived.turkeyDark).toBe(true);
  });
});
