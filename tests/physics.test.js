import { describe, it, expect } from 'vitest';
import {
  dynamicPressure, shueParams, magnetopauseRadius, insideMagnetopause, bowShockStandoff, magnetosonicMach, sheathVelocity,
} from '../src/physics/magnetopause.js';
import {
  dipoleField, quadrupoleField, magneticField, stormerCutoffGV, minLatitudeForRigidity, rigidityToKineticGeV,
  kineticGeVToRigidity, traceFieldLine, dipoleLinePoint, invariantLatitude,
} from '../src/physics/dipole.js';
import { advanceParticle } from '../src/physics/particles.js';
import {
  kpFromSolarWind, stepDstStar, dstFromStar, gScale, sScale, rScale, flareClassName, auroraEquatorwardLat, plasmapauseL,
} from '../src/physics/indices.js';
import { createStorm, stormSolarWindAt, STORM_PRESETS, stormParamsFromStrength, predictStormOutcome } from '../src/physics/stormProfile.js';
import { createState } from '../src/core/state.js';
import { EventBus } from '../src/core/events.js';
import { SpaceWeatherSim } from '../src/core/simulation.js';

describe('manyetopoz', () => {
  it('sakin rüzgârda burun ~10-11 Re', () => {
    const p = dynamicPressure(5, 400);
    expect(p).toBeCloseTo(1.338, 2);
    const { r0, alpha } = shueParams(p, 0);
    expect(r0).toBeGreaterThan(9.5);
    expect(r0).toBeLessThan(11.5);
    expect(alpha).toBeGreaterThan(0.5);
  });

  it('güçlü fırtınada GEO yörüngesinin içine sıkışır', () => {
    const p = dynamicPressure(40, 1000);
    const { r0 } = shueParams(p, -30);
    expect(r0).toBeLessThan(6.6);
  });

  it('alan gücü sıfırken iyonosfer engeli', () => {
    const { r0 } = shueParams(1.3, 0, 0);
    expect(r0).toBeCloseTo(1.08, 5);
  });

  it('r(θ) burunda r0, yanda daha büyük', () => {
    expect(magnetopauseRadius(0, 10, 0.6)).toBeCloseTo(10, 6);
    expect(magnetopauseRadius(Math.PI / 2, 10, 0.6)).toBeCloseTo(10 * 2 ** 0.6, 6);
    expect(insideMagnetopause(9, 0, 0, 10, 0.6)).toBe(true);
    expect(insideMagnetopause(11, 0, 0, 10, 0.6)).toBe(false);
  });

  it('yay şoku manyetopozdan ~%30 ileride', () => {
    const M = magnetosonicMach(400, 5, 5, 1e5);
    expect(M).toBeGreaterThan(3);
    const rbs = bowShockStandoff(10, M);
    expect(rbs / 10).toBeGreaterThan(1.2);
    expect(rbs / 10).toBeLessThan(1.45);
  });

  it('kılıf akışı burunda durur (Rankine yarı-cismi)', () => {
    const v = sheathVelocity([0, 0, 0], 10, 0, 0, 10, 1);
    expect(Math.hypot(...v)).toBeLessThan(1e-9);
  });
});

describe('dipol alanı', () => {
  const axis = [0, 1, 0];
  it('ekvatorda yüzey alanı 1 ve kuzeyi gösterir', () => {
    const b = dipoleField([0, 0, 0], 1, 0, 0, axis, 1);
    expect(b[1]).toBeCloseTo(1, 6);
    expect(Math.hypot(b[0], b[2])).toBeLessThan(1e-9);
  });
  it('kutupta alan 2 ve aşağı (Dünya içine) bakar', () => {
    const b = dipoleField([0, 0, 0], 0, 1, 0, axis, 1);
    expect(b[1]).toBeCloseTo(-2, 6);
  });
  it('kuadrupol alanı potansiyelin negatif gradyanıdır', () => {
    const Q = 0.7;
    const V = (x, y, z) => {
      const r2 = x * x + y * y + z * z;
      return (Q * (3 * y * y - r2)) / (2 * r2 * r2 * Math.sqrt(r2));
    };
    const p = [1.3, 0.7, -0.4];
    const h = 1e-6;
    const b = quadrupoleField([0, 0, 0], ...p, axis, Q);
    const gx = (V(p[0] + h, p[1], p[2]) - V(p[0] - h, p[1], p[2])) / (2 * h);
    const gy = (V(p[0], p[1] + h, p[2]) - V(p[0], p[1] - h, p[2])) / (2 * h);
    const gz = (V(p[0], p[1], p[2] + h) - V(p[0], p[1], p[2] - h)) / (2 * h);
    expect(b[0]).toBeCloseTo(-gx, 5);
    expect(b[1]).toBeCloseTo(-gy, 5);
    expect(b[2]).toBeCloseTo(-gz, 5);
  });
  it('Störmer dikey kesmesi ekvatorda 14.9 GV, kutupta ~0', () => {
    expect(stormerCutoffGV(0)).toBeCloseTo(14.9, 3);
    expect(stormerCutoffGV(89.9)).toBeLessThan(1e-4);
    expect(minLatitudeForRigidity(14.9)).toBe(0);
    const lat = minLatitudeForRigidity(1);
    expect(stormerCutoffGV(lat)).toBeCloseTo(1, 6);
  });
  it('sertlik-enerji dönüşümü tutarlı', () => {
    const E = rigidityToKineticGeV(1);
    expect(E).toBeCloseTo(0.433, 2); // 1 GV proton ≈ 433 MeV
    expect(kineticGeVToRigidity(E)).toBeCloseTo(1, 6);
  });
  it('alan çizgisi izleyici dipol L-kabuğunu takip eder', () => {
    const model = { axis: [0, 1, 0], M: 1, Q: 0, r0: 100, alpha: 0.6, imf: [0, 0, 0], clipToMagnetopause: false };
    // ekvatorda L=4'ten başla, kuzeye doğru (B'ye ters yönde; ekvatorda B +Y yönünde → dir=+1 kuzeye gider)
    const pts = traceFieldLine([4, 0, 0], model, { dir: 1, step: 0.01, maxSteps: 5000 });
    const n = pts.length / 3;
    const x = pts[(n - 1) * 3], y = pts[(n - 1) * 3 + 1], z = pts[(n - 1) * 3 + 2];
    const r = Math.hypot(x, y, z);
    expect(r).toBeLessThan(1.05);
    const lat = Math.asin(y / r);
    expect(lat).toBeCloseTo(invariantLatitude(4), 1);
    const [rho, zz] = dipoleLinePoint(4, 0);
    expect(rho).toBeCloseTo(4, 9);
    expect(zz).toBeCloseTo(0, 9);
  });
});

describe('parçacık yörüngeleri', () => {
  const model = { axis: [0, 1, 0], M: 1, Q: 0, r0: 100, alpha: 0.6, imf: [0, 0, 0], clipToMagnetopause: false };
  it('ekvatora gelen 5 GV proton ulaşamaz, 100 GV ulaşır', () => {
    const shoot = (R) => {
      const p = { pos: [8, 0, 0], dir: [-1, 0, 0], rigidity: R, charge: 1 };
      for (let i = 0; i < 400; i++) {
        const res = advanceParticle(p, 0.5, model, { rHit: 1.0, rEscape: 30 });
        if (res.hit) return 'hit';
        if (res.escaped) return 'escaped';
      }
      return 'trapped';
    };
    expect(shoot(100)).toBe('hit');
    expect(shoot(5)).not.toBe('hit');
  });
  it('hız büyüklüğü korunur', () => {
    const p = { pos: [3, 0.5, 0.2], dir: [-0.6, 0.8, 0], rigidity: 0.5, charge: 1 };
    advanceParticle(p, 5, model, { rHit: 1, rEscape: 50 });
    expect(Math.hypot(...p.dir)).toBeCloseTo(1, 9);
  });
});

describe('indeksler', () => {
  it('sakin koşullarda Kp ~1-2', () => {
    const kp = kpFromSolarWind(400, 5, 4, 1);
    expect(kp).toBeGreaterThan(0.8);
    expect(kp).toBeLessThan(2.5);
  });
  it('aşırı fırtınada Kp 8-9', () => {
    expect(kpFromSolarWind(2000, 30, 0, -50)).toBeGreaterThan(8);
  });
  it('O’Brien-McPherron Dst güney Bz ile düşer, kuzey Bz ile toparlanır', () => {
    let d = 0;
    for (let i = 0; i < 100; i++) d = stepDstStar(d, 800, -20, 0.1);
    expect(d).toBeLessThan(-150);
    const low = d;
    for (let i = 0; i < 200; i++) d = stepDstStar(d, 400, 2, 0.1);
    expect(d).toBeGreaterThan(low * 0.5); // sakin zamanda τ ≈ 19 saat
    expect(dstFromStar(0, 4)).toBeCloseTo(7.26 * 2 - 11, 6);
  });
  it('NOAA ölçekleri', () => {
    expect(gScale(9)).toBe(5);
    expect(gScale(5)).toBe(1);
    expect(gScale(3)).toBe(0);
    expect(sScale(150)).toBe(2);
    expect(rScale(2.1e-4)).toBe(3);
    expect(flareClassName(2.1e-4)).toBe('X2.1');
    expect(flareClassName(5e-5)).toBe('M5.0');
  });
  it('aurora sınırı Kp ile ekvatora iner', () => {
    expect(auroraEquatorwardLat(1, 0)).toBeGreaterThan(auroraEquatorwardLat(8, -200));
    expect(auroraEquatorwardLat(9, -1100)).toBeLessThan(30);
    expect(plasmapauseL(9)).toBeLessThan(plasmapauseL(1));
  });
});

describe('fırtına profili', () => {
  it('güç arttıkça daha hızlı ve güçlü', () => {
    const a = stormParamsFromStrength(0.2);
    const b = stormParamsFromStrength(0.9);
    expect(b.vPeak).toBeGreaterThan(a.vPeak);
    expect(b.bsPeak).toBeGreaterThan(a.bsPeak);
    expect(predictStormOutcome(b).g).toBeGreaterThanOrEqual(predictStormOutcome(a).g);
  });
  it('varıştan önce katkı yok, bulutta güney Bz', () => {
    const st = createStorm({ strength: 0.6, launchSim: 0 });
    const base = { speed: 400, density: 5, by: 4, bz: 1 };
    expect(stormSolarWindAt(st, -1, base)).toBeNull();
    const mid = stormSolarWindAt(st, st.sheathHours + st.cloudHours / 2, base);
    expect(mid.bz).toBeLessThan(-10);
  });
  it('tarihî önayarlar geçerli', () => {
    for (const id of Object.keys(STORM_PRESETS)) {
      const st = createStorm({ presetId: id });
      expect(st.vPeak).toBeGreaterThan(500);
      expect(st.name).toContain('(');
    }
  });
});

describe('simülasyon motoru (uçtan uca)', () => {
  const run = (sim, seconds, dt = 1 / 30) => {
    for (let t = 0; t < seconds; t += dt) sim.update(dt);
  };

  it('Carrington fırtınası: süper fırtına, GEO maruz, Türkiye’den aurora', () => {
    const state = createState();
    const events = new EventBus();
    const seen = new Set();
    for (const ev of ['flare', 'storm:launched', 'storm:arrived', 'sep:onset']) events.on(ev, () => seen.add(ev));
    const sim = new SpaceWeatherSim(state, events);
    state.time.timeScale = 1;
    sim.applyPreset('carrington1859');
    let minDst = 0, maxKp = 0, minR0 = 99, turkey = false;
    for (let i = 0; i < 30 * 60; i++) {
      sim.update(1 / 30);
      minDst = Math.min(minDst, state.derived.dst);
      maxKp = Math.max(maxKp, state.derived.kp);
      minR0 = Math.min(minR0, state.derived.r0);
      if (state.derived.turkeyAurora !== 'none') turkey = true;
    }
    expect([...seen].sort()).toEqual(['flare', 'sep:onset', 'storm:arrived', 'storm:launched'].sort());
    expect(minDst).toBeLessThan(-700);
    expect(maxKp).toBeGreaterThan(8.5);
    expect(minR0).toBeLessThan(6);
    expect(turkey).toBe(true);
    expect(state.log.some((l) => l.text.includes('GEO'))).toBe(true);
  });

  it('Gannon 2024 fırtınası Dst −300…−550 aralığında', () => {
    const state = createState();
    const sim = new SpaceWeatherSim(state, new EventBus());
    state.time.timeScale = 1;
    sim.applyPreset('gannon2024');
    let minDst = 0;
    for (let i = 0; i < 30 * 80; i++) {
      sim.update(1 / 30);
      minDst = Math.min(minDst, state.derived.dst);
    }
    expect(minDst).toBeLessThan(-300);
    expect(minDst).toBeGreaterThan(-560);
  });

  it('sakin koşullarda kararlı', () => {
    const state = createState();
    const sim = new SpaceWeatherSim(state, new EventBus());
    run(sim, 20);
    expect(state.derived.kp).toBeLessThan(3);
    expect(state.derived.dst).toBeGreaterThan(-30);
    expect(state.derived.r0).toBeGreaterThan(9);
    expect(state.history.t.length).toBeGreaterThan(5);
  });

  it('kutup tersinmesi kutupluluğu çevirir ve süreklidir', () => {
    const state = createState();
    const sim = new SpaceWeatherSim(state, new EventBus());
    sim.startPoleReversal();
    let minShield = 9;
    let lastM = state.derived.dipoleMoment;
    for (let i = 0; i < 30 * 26; i++) {
      sim.update(1 / 30);
      minShield = Math.min(minShield, state.derived.shieldStrength);
      lastM = state.derived.dipoleMoment;
    }
    expect(state.params.polarity).toBe(-1);
    expect(lastM).toBeLessThan(0);
    expect(minShield).toBeLessThan(0.4);
  });

  it('mevsim: Haziran gündönümünde kuzey ekseni Güneş’e eğik', () => {
    const state = createState();
    const sim = new SpaceWeatherSim(state, new EventBus());
    sim.setDayOfYear(172);
    expect(state.frame.spinAxis.x).toBeGreaterThan(0.39);
    sim.setDayOfYear(355);
    expect(state.frame.spinAxis.x).toBeLessThan(-0.39);
  });

  it('İstanbul’un manyetik enlemi makul (~36-40°)', () => {
    const state = createState();
    new SpaceWeatherSim(state, new EventBus());
    expect(state.derived.istanbulMagLat).toBeGreaterThan(34);
    expect(state.derived.istanbulMagLat).toBeLessThan(41);
  });
});

describe('kalkansız Dünya', () => {
  it('alan yokken Türkiye için aurora uyarısı verilmez', () => {
    const state = createState();
    const sim = new SpaceWeatherSim(state, new EventBus());
    sim.applyPreset('noShield');
    for (let i = 0; i < 300; i++) sim.update(1 / 30);
    expect(state.derived.r0).toBeCloseTo(1.08, 2);
    expect(state.derived.turkeyAurora).toBe('none');
    expect(state.log.some((l) => l.text.includes('Türkiye'))).toBe(false);
    expect(state.log.some((l) => l.text.includes('kalkan devre dışı'))).toBe(true);
  });
});

describe('fırtına sınırı', () => {
  it('aynı anda en fazla 6 fırtına', () => {
    const state = createState();
    const sim = new SpaceWeatherSim(state, new EventBus());
    for (let i = 0; i < 10; i++) sim.triggerSolarStorm({ strength: 0.3 });
    expect(state.storms.length).toBe(6);
    expect(sim.triggerSolarStorm({ strength: 0.3 })).toBeNull();
  });
});
