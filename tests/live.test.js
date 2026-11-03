// Canlı uzay havası: NOAA SWPC ayrıştırıcıları, fetchLiveSpaceWeather ve simülasyon etkisi.
import { describe, it, expect } from 'vitest';
import { parseTimeTag, parseWind, parseMag, parseKp, fetchLiveSpaceWeather, LIVE_URLS } from '../src/core/liveData.js';
import { createState } from '../src/core/state.js';
import { EventBus } from '../src/core/events.js';
import { SpaceWeatherSim } from '../src/core/simulation.js';
import { STORM_PRESETS } from '../src/physics/stormProfile.js';

const wind = (o) => ({ time_tag: '2026-11-03T13:25:02', active: false, source: 'ACE', proton_speed: 400, proton_density: 5, ...o });
const mag = (o) => ({ time_tag: '2026-11-03T13:25:02', active: false, source: 'ACE', bt: 5, bx_gsm: 1, by_gsm: 3, bz_gsm: -4, ...o });

describe('parseTimeTag', () => {
  it('Z olmayan zaman damgası UTC sayılır', () => {
    expect(parseTimeTag('2026-11-03T13:25:02')).toBe(Date.UTC(2026, 10, 3, 13, 25, 2));
    expect(parseTimeTag('2026-11-03T13:25:02Z')).toBe(Date.UTC(2026, 10, 3, 13, 25, 2));
    expect(Number.isNaN(parseTimeTag(null))).toBe(true);
  });
});

describe('parseWind / parseMag', () => {
  it('active===true satırını daha yeni etkin olmayana tercih eder', () => {
    const rows = [
      wind({ time_tag: '2026-11-03T13:26:00', active: false, source: 'ACE', proton_speed: 999 }),
      wind({ time_tag: '2026-11-03T13:25:00', active: true, source: 'DSCOVR', proton_speed: 450, proton_density: 7 }),
    ];
    const w = parseWind(rows);
    expect(w.source).toBe('DSCOVR');
    expect(w.speed).toBe(450);
    expect(w.density).toBe(7);
  });

  it('null/sonlu olmayan alanları atlar, en yeni geçerli satırı alır', () => {
    const rows = [
      wind({ time_tag: '2026-11-03T13:27:00', active: true, proton_speed: null }),
      wind({ time_tag: '2026-11-03T13:26:00', active: true, proton_density: 'x' }),
      wind({ time_tag: '2026-11-03T13:25:00', active: true, proton_speed: 512, proton_density: 3 }),
    ];
    const w = parseWind(rows);
    expect(w.speed).toBe(512);
    expect(w.time).toBe(Date.UTC(2026, 10, 3, 13, 25, 0));
  });

  it('etkin satır yoksa herhangi bir kaynaktaki en yeni geçerli satıra düşer', () => {
    const rows = [
      wind({ time_tag: '2026-11-03T13:20:00', source: 'ACE', proton_speed: 380 }),
      wind({ time_tag: '2026-11-03T13:24:00', source: 'IMAP', proton_speed: 390 }),
    ];
    expect(parseWind(rows).source).toBe('IMAP');
    expect(parseWind([wind({ proton_speed: null })])).toBeNull();
    expect(parseWind(null)).toBeNull();
    expect(parseWind([])).toBeNull();
  });

  it('manyetik alan: Bz/By okunur; Bt yoksa hesaplanır', () => {
    const m = parseMag([mag({ active: true, bt: null, by_gsm: 3, bz_gsm: -4 })]);
    expect(m.bz).toBe(-4);
    expect(m.by).toBe(3);
    expect(m.bt).toBeCloseTo(5, 6);
    expect(parseMag([mag({ bz_gsm: null })])).toBeNull();
  });
});

describe('parseKp', () => {
  it('en yeni geçerli Kp satırı (dizi eskiden yeniye)', () => {
    const kp = parseKp([
      { time_tag: '2026-11-03T06:00:00', Kp: 2.33 },
      { time_tag: '2026-11-03T09:00:00', Kp: '3.67' },
      { time_tag: '2026-11-03T12:00:00', Kp: null },
    ]);
    expect(kp.kp).toBeCloseTo(3.67, 6);
    expect(kp.time).toBe(Date.UTC(2026, 10, 3, 9, 0, 0));
    expect(parseKp([])).toBeNull();
    expect(parseKp({})).toBeNull();
  });
});

describe('fetchLiveSpaceWeather', () => {
  const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const make = (overrides = {}) => async (url) => {
    if (overrides[url]) return overrides[url]();
    if (url === LIVE_URLS.wind) return json([wind({ active: true, source: 'DSCOVR', proton_speed: 470, proton_density: 6.5 })]);
    if (url === LIVE_URLS.mag) return json([mag({ active: true, source: 'DSCOVR', bt: 8, by_gsm: -2, bz_gsm: -7.5 })]);
    if (url === LIVE_URLS.kp) return json([{ time_tag: '2026-11-03T09:00:00', Kp: 4 }]);
    throw new Error('bilinmeyen url');
  };

  it('başarı', async () => {
    const s = await fetchLiveSpaceWeather({ fetchImpl: make() });
    expect(s).toMatchObject({ speed: 470, density: 6.5, bt: 8, by: -2, bz: -7.5, kpObserved: 4, source: 'DSCOVR' });
    expect(s.windTime).toBe(Date.UTC(2026, 10, 3, 13, 25, 2));
  });

  it('Kp hatası önemsiz', async () => {
    const s = await fetchLiveSpaceWeather({ fetchImpl: make({ [LIVE_URLS.kp]: () => Promise.reject(new Error('ağ')) }) });
    expect(s.kpObserved).toBeNull();
    expect(s.speed).toBe(470);
  });

  it('rüzgâr, manyetik alan veya tümü başarısızsa fırlatır', async () => {
    const bad = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve([]) });
    await expect(fetchLiveSpaceWeather({ fetchImpl: make({ [LIVE_URLS.wind]: bad }) })).rejects.toThrow(/503/);
    await expect(fetchLiveSpaceWeather({ fetchImpl: make({ [LIVE_URLS.mag]: () => json([]) }) })).rejects.toThrow();
    await expect(fetchLiveSpaceWeather({ fetchImpl: () => Promise.reject(new Error('çevrimdışı')) })).rejects.toThrow('çevrimdışı');
  });

  it('zaman aşımı isteği iptal eder', async () => {
    const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(fetchLiveSpaceWeather({ fetchImpl: hang, timeoutMs: 20 })).rejects.toThrow('aborted');
  });
});

describe('simülasyon: canlı mod', () => {
  const make = () => {
    const state = createState({ startEpochMs: Date.UTC(2020, 0, 1) });
    const events = new EventBus();
    return { state, events, sim: new SpaceWeatherSim(state, events) };
  };
  const sample = { speed: 620, density: 12, bt: 9, by: -3, bz: -8, kpObserved: 4, kpTime: 0, windTime: Date.now(), magTime: Date.now(), source: 'DSCOVR' };

  it('açılışta ağ/örnek yok; kapalıyken örnek yok sayılır', () => {
    const { state, sim } = make();
    expect(state.live).toMatchObject({ on: false, status: 'idle', sample: null });
    sim.applyLiveSample(sample);
    expect(state.params.solarWind.speed).toBe(400);
  });

  it('açınca saat gerçek ana, alan gücü 1 olur; örnek state.params içine yazılır', () => {
    const { state, sim, events } = make();
    state.params.fieldStrength = 0.4;
    let updates = 0;
    events.on('live:update', () => updates++);
    const before = Date.now();
    sim.setLiveMode(true);
    expect(state.live.status).toBe('loading');
    expect(state.params.fieldStrength).toBe(1);
    expect(Math.abs(state.time.startEpochMs - before)).toBeLessThan(2000);
    sim.applyLiveSample(sample);
    expect(state.params.solarWind).toMatchObject({ speed: 620, density: 12, by: -3, bz: -8 });
    expect(state.live.status).toBe('ok');
    expect(state.live.sample).toBe(sample);
    expect(updates).toBeGreaterThanOrEqual(2);
    sim.update(0.1);
    expect(state.sw.speed).toBeGreaterThan(500);
  });

  it('kaydırıcı aralıklarına sıkıştırır, geçersiz alanı atlar', () => {
    const { state, sim } = make();
    sim.setLiveMode(true);
    sim.applyLiveSample({ ...sample, speed: 3000, density: 0.1, by: -99, bz: 99 });
    expect(state.params.solarWind).toMatchObject({ speed: 1000, density: 1, by: -20, bz: 30 });
    sim.applyLiveSample({ ...sample, speed: NaN, density: 8, by: 2, bz: 1 });
    expect(state.params.solarWind.speed).toBe(1000);
    expect(state.params.solarWind.density).toBe(8);
  });

  it('hata: son değerler korunur, uyarı spam yapmaz; kapatınca değerler kalır', () => {
    const { state, sim } = make();
    sim.setLiveMode(true);
    sim.applyLiveSample(sample);
    const n0 = state.log.length;
    sim.setLiveStatus('error', new Error('x'));
    sim.setLiveStatus('error', new Error('x'));
    sim.setLiveStatus('error', new Error('x'));
    expect(state.live.status).toBe('error');
    expect(state.live.error).toBe('x');
    expect(state.log.length - n0).toBe(1);
    expect(state.params.solarWind.speed).toBe(620);
    sim.setLiveMode(false);
    expect(state.live.on).toBe(false);
    sim.applyLiveSample({ ...sample, speed: 300 });
    expect(state.params.solarWind.speed).toBe(620);
  });

  it('canlıyken saat gerçek zamanda akar (timeScale yok sayılır); çıkınca kullanıcı hızı döner', () => {
    const { state, sim } = make();
    state.time.timeScale = 4;
    sim.setLiveMode(true);
    expect(state.time.effectiveRate).toBeCloseTo(1 / 3600, 12);
    const h0 = state.time.simHours;
    for (let i = 0; i < 100; i++) sim.update(0.1); // 10 gerçek sn
    expect(state.time.simHours - h0).toBeCloseTo(10 / 3600, 6);
    expect(state.time.timeScale).toBe(4);
    sim.setLiveMode(false);
    expect(state.time.effectiveRate).toBe(4);
  });

  it('örnek uygulanınca saat gerçek UTC ile yeniden eşitlenir (simHours sıçramaz)', () => {
    const { state, sim } = make();
    sim.setLiveMode(true);
    state.time.startEpochMs -= 3 * 60e3; // 3 dk kayma
    const h = state.time.simHours;
    sim.applyLiveSample(sample);
    expect(Math.abs(state.time.startEpochMs + h * 3600e3 - Date.now())).toBeLessThan(1000);
    expect(state.time.simHours).toBe(h);
  });

  it('elle fırtına/önayar/senaryo canlı modu kapatır (tek bilgi uyarısı); kozmik patlama kapatmaz', () => {
    const { state, sim } = make();
    sim.setLiveMode(true);
    sim.applyLiveSample(sample);
    sim.triggerCosmicBurst();
    expect(state.live.on).toBe(true);

    let n0 = state.log.length;
    expect(sim.triggerSolarStorm({ strength: 0.5 })).toBeTruthy();
    expect(state.live.on).toBe(false);
    expect(state.storms.length).toBe(1);
    const paused = state.log.slice(n0).filter((e) => e.text.includes('Canlı uzay havası duraklatıldı') || e.text.includes('Live space weather paused'));
    expect(paused.length).toBe(1);
    expect(paused[0].level).toBe('info');
    expect(state.log.slice(n0).some((e) => /kapatıldı|turned off|Live space weather off/.test(e.text) && e.text.includes('📡') && !e.text.includes('duraklat') && !e.text.includes('paused'))).toBe(false);

    for (const id of ['highSpeedStream', Object.keys(STORM_PRESETS)[0]]) {
      sim.setLiveMode(true);
      sim.applyPreset(id);
      expect(state.live.on).toBe(false);
    }
  });
});
