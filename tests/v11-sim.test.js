// v1.1 simülasyon düzeltmeleri: patlama sınıfı sınırları, reset/quiet temizliği, önayar hata yolu, dispose.

import { describe, it, expect } from 'vitest';
import { createState } from '../src/core/state.js';
import { EventBus } from '../src/core/events.js';
import { SpaceWeatherSim } from '../src/core/simulation.js';
import { flareClassName } from '../src/physics/indices.js';

const mk = () => {
  const state = createState({ startEpochMs: Date.UTC(2026, 9, 11, 12, 0, 0) });
  const events = new EventBus();
  const sim = new SpaceWeatherSim(state, events);
  return { state, events, sim };
};

/** Fırtına etkisi Dst'ye yansıyana kadar ilerlet */
function runUntilDst(sim, state, limit) {
  state.time.timeScale = 4;
  for (let i = 0; i < 4000 && state.derived.dst > limit; i++) sim.update(0.1);
}

describe('flareClassName sınıf sınırları', () => {
  it('yuvarlama bir üst sınıfa terfi eder', () => {
    expect(flareClassName(9.96e-6)).toBe('M1.0');
    expect(flareClassName(9.96e-7)).toBe('C1.0');
    expect(flareClassName(9.96e-8)).toBe('B1.0');
    expect(flareClassName(9.96e-5)).toBe('X1.0');
  });

  it('sınıf içi değerler korunur; X açık uçlu', () => {
    expect(flareClassName(5.24e-6)).toBe('C5.2');
    expect(flareClassName(1e-5)).toBe('M1.0');
    expect(flareClassName(2.8e-3)).toBe('X28.0');
    expect(flareClassName(1e-9)).toBe('A0.0');
  });
});

describe('reset()', () => {
  it('fırtına önayarı ve gücünü varsayılana döndürür, UT saatini korur', () => {
    const { state, sim } = mk();
    const start = state.time.startEpochMs;
    state.params.stormPresetId = 'quebec1989';
    state.params.stormStrength = 0.9;
    state.time.simHours = 5;
    sim.reset();
    expect(state.params.stormPresetId).toBeNull();
    expect(state.params.stormStrength).toBe(createState().params.stormStrength);
    expect(state.time.startEpochMs).toBe(start);
    expect(state.time.simHours).toBe(5);
  });

  it('duraklatılmışken fastForward/effectiveRate hemen doğru olur ve fırtına kalıntısı temizlenir', () => {
    const { state, sim } = mk();
    state.time.timeScale = 1;
    sim.triggerSolarStorm({ strength: 0.8 });
    sim.update(0.05); // CME yolda: zaman hızlanır
    expect(state.time.fastForward).toBe(true);
    state.time.paused = true;
    sim.reset();
    expect(state.storms.length).toBe(0);
    expect(state.time.fastForward).toBe(false);
    expect(state.time.effectiveRate).toBe(1);
    expect(state.derived.dstStar).toBe(0);
  });
});

describe('quiet önayarı', () => {
  it('fırtına türevlerini temizler ve storm:ended yayınlar', () => {
    const { state, events, sim } = mk();
    sim.applyPreset('quebec1989');
    runUntilDst(sim, state, -100);
    expect(state.derived.dst).toBeLessThan(-100);
    expect(state.derived.dstStar).toBeLessThan(-50);

    let ended = 0;
    events.on('storm:ended', () => ended++);
    state.time.paused = true; // duraklatılmışken de anında sakinleşmeli
    sim.applyPreset('quiet');
    expect(ended).toBe(1);
    expect(state.storms.length).toBe(0);
    expect(state.derived.dstStar).toBe(0);
    expect(state.derived.dstMinStorm).toBeGreaterThan(-30);
    expect(state.derived.dst).toBeGreaterThan(-30);
    expect(state.derived.kp).toBeLessThan(3);
    expect(state.derived.belts.outer).toBe(1);
    expect(state.derived.belts.slot).toBe(0);
  });
});

describe('önayar hata yolu', () => {
  it('en çok fırtına sınırında preset:applied yayınlanmaz, yalnızca uyarı çıkar', () => {
    const { state, events, sim } = mk();
    for (let i = 0; i < 6; i++) expect(sim.triggerSolarStorm({ strength: 0.3 })).not.toBeNull();
    let applied = 0;
    events.on('preset:applied', () => applied++);
    const before = state.log.length;
    expect(sim.applyPreset('carrington1859')).toBeNull();
    expect(applied).toBe(0);
    const added = state.log.slice(before);
    expect(added.length).toBe(1);
    expect(added[0].level).toBe('warn');
  });

  it('başarılı önayar preset:applied yayınlar', () => {
    const { events, sim } = mk();
    let applied = 0;
    events.on('preset:applied', () => applied++);
    expect(sim.applyPreset('quebec1989')).not.toBeNull();
    expect(applied).toBe(1);
  });
});

describe('dispose()', () => {
  it('olay dinleyicilerini kaldırır', () => {
    const { state, events, sim } = mk();
    events.emit('cosmic:escaped', {});
    expect(state.cosmic.stats.escaped).toBe(1);
    sim.dispose();
    events.emit('cosmic:escaped', {});
    events.emit('cosmic:impact', { magLatDeg: 60 });
    expect(state.cosmic.stats.escaped).toBe(1);
    expect(state.cosmic.stats.impacts).toBe(0);
  });
});
