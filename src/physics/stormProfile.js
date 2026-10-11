// Güneş fırtınası (patlama + SEP + CME) parametreleri ve zaman profilleri.
// Zaman birimleri: simülasyon saati (h). t = 0 CME şokunun Dünya'ya varışıdır.

import { AU_KM, VISUAL, QUIET_SOLAR_WIND } from '../core/constants.js';
import {
  flareClassName, rScale, sScale, kpFromSolarWind, kpFloorFromDst, gScale, stepDstStar, dstFromStar,
  DST_THRESHOLDS, SCALE_LABELS,
} from './indices.js';
import { dynamicPressure } from './magnetopause.js';
import { t } from '../i18n/index.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Tarihî fırtına önayarları (gözlemlere yakın, yuvarlanmış değerler).
 * name/description tembel özelliklerdir: etkin dile göre her okumada t() ile çözülür.
 */
export const STORM_PRESETS = {
  carrington1859: {
    get name() {
      return t('preset.carrington1859.name');
    },
    get description() {
      return t('preset.carrington1859.description');
    },
    strength: 1,
    vPeak: 2400, nPeak: 60, bsPeak: 55, sheathHours: 3, cloudHours: 18,
    flareFlux: 4.5e-3, sepPeak: 1.5e5, transitHours: 17.6, forbushDepth: 0.3,
  },
  quebec1989: {
    get name() {
      return t('preset.quebec1989.name');
    },
    get description() {
      return t('preset.quebec1989.description');
    },
    strength: 0.8,
    vPeak: 1050, nPeak: 40, bsPeak: 53.2, sheathHours: 4, cloudHours: 20,
    flareFlux: 4.5e-4, sepPeak: 3500, transitHours: 55, forbushDepth: 0.18,
  },
  halloween2003: {
    get name() {
      return t('preset.halloween2003.name');
    },
    get description() {
      return t('preset.halloween2003.description');
    },
    strength: 0.78,
    vPeak: 1900, nPeak: 30, bsPeak: 20, sheathHours: 3, cloudHours: 14,
    flareFlux: 1.72e-3, sepPeak: 29500, transitHours: 19, forbushDepth: 0.25,
  },
  gannon2024: {
    get name() {
      return t('preset.gannon2024.name');
    },
    get description() {
      return t('preset.gannon2024.description');
    },
    strength: 0.72,
    vPeak: 900, nPeak: 45, bsPeak: 41.5, sheathHours: 5, cloudHours: 18,
    flareFlux: 5.8e-4, sepPeak: 200, transitHours: 40, forbushDepth: 0.15,
  },
};

/** Gücü (0..1) fiziksel fırtına parametrelerine çevirir */
export function stormParamsFromStrength(s) {
  s = clamp(s, 0, 1);
  return {
    strength: s,
    vPeak: 420 + 1600 * Math.pow(s, 1.5),
    nPeak: 8 + 42 * s,
    bsPeak: 3 + 40 * Math.pow(s, 1.6),
    sheathHours: 3 + 2 * (1 - s),
    cloudHours: 12 + 10 * s,
    flareFlux: Math.pow(10, -5 + 2.65 * s),
    sepPeak: Math.pow(10, -0.5 + 5.8 * s),
    forbushDepth: 0.02 + 0.26 * Math.pow(s, 1.5),
  };
}

/** Basit sürüklenme tabanlı geçiş süresi [h] */
export function transitHoursFor(vPeak) {
  const vAvg = 0.75 * vPeak + 0.25 * 400;
  return clamp(AU_KM / vAvg / 3600, 14, 100);
}

/** Görsel geçiş süresi [gerçek s] — hızlı CME'ler daha kısa sürede gelir */
export function visualTransitSecFor(vPeak) {
  return clamp(VISUAL.cmeVisualTransitSec * Math.sqrt(1000 / Math.max(vPeak, 400)), 4, 10);
}

/**
 * Fırtına gücünün sözel etiketi. NOAA G ölçeğiyle çelişmesin diye beklenen G düzeyinden türetilir
 * (G4 → “Şiddetli”); “Carrington sınıfı” yalnızca tahmini Dst ≤ −850 nT için kullanılır.
 * o: önceden hesaplanmış predictStormOutcome sonucu (isteğe bağlı).
 */
export function strengthLabel(s, o = predictStormOutcome(stormParamsFromStrength(s))) {
  if (o.dstMin <= DST_THRESHOLDS.carrington) return t('strength.carrington');
  return SCALE_LABELS.G[Math.max(1, o.g)];
}

/**
 * Fırtınanın sonucunu önceden tahmin eder (arayüz önizlemesi ve “Beklenen” uyarısı için).
 * Simülasyonla aynı modeller kullanılır: kılıf/bulut rüzgârı üzerinden Dst* (O’Brien–McPherron)
 * ve gecikmeli Kp, sakin arka planda, tam güçte bir kalkanla. p: stormParamsFromStrength çıktısı ya da fırtına nesnesi.
 */
export function predictStormOutcome(p) {
  const base = QUIET_SOLAR_WIND;
  const storm = {
    sheathHours: p.sheathHours, cloudHours: p.cloudHours, vPeak: p.vPeak, nPeak: p.nPeak, bsPeak: p.bsPeak, seed: p.seed ?? 0,
  };
  const h = 0.1;
  const end = storm.sheathHours + storm.cloudHours + 12;
  let dstStar = 0;
  let dstMin = 0;
  let kp = kpFromSolarWind(base.speed, base.density, base.by, base.bz);
  let kpMax = kp;
  for (let t = h; t <= end; t += h) {
    // simulation.js _effectiveWind ile aynı birleştirme
    const c = stormSolarWindAt(storm, t, base);
    let speed = base.speed;
    let density = base.density;
    let by = base.by;
    let bz = base.bz;
    if (c) {
      speed = Math.max(speed, c.speed);
      density = Math.max(density, c.density);
      by = base.by * (1 - c.weight) + c.by * c.weight;
      bz = base.bz * (1 - c.weight) + c.bz * c.weight;
    }
    dstStar = stepDstStar(dstStar, speed, bz, h);
    const dst = dstFromStar(dstStar, dynamicPressure(density, speed));
    dstMin = Math.min(dstMin, dst);
    const target = Math.max(kpFromSolarWind(speed, density, by, bz), kpFloorFromDst(dst));
    kp += (target - kp) * (1 - Math.exp(-h / (target > kp ? 0.4 : 2.0)));
    kpMax = Math.max(kpMax, kp);
  }
  kpMax = Math.min(kpMax, 9);
  return {
    dstMin,
    kp: kpMax,
    g: gScale(kpMax),
    flareClass: flareClassName(p.flareFlux),
    r: rScale(p.flareFlux),
    s: sScale(p.sepPeak),
    transitHours: p.transitHours ?? transitHoursFor(p.vPeak),
  };
}

let _nextId = 1;

/** Yeni fırtına nesnesi oluşturur. launchSim: fırlatma anı (sim saati) */
export function createStorm({ strength = 0.5, presetId = null, launchSim = 0 } = {}) {
  const preset = presetId ? STORM_PRESETS[presetId] : null;
  const base = preset ? { ...stormParamsFromStrength(preset.strength), ...preset } : stormParamsFromStrength(strength);
  const transitHours = base.transitHours ?? transitHoursFor(base.vPeak);
  const storm = {
    id: _nextId++,
    presetId,
    name: preset ? preset.name : t('storm.generatedName', { label: strengthLabel(base.strength) }),
    strength: base.strength,
    vPeak: base.vPeak,
    nPeak: base.nPeak,
    bsPeak: base.bsPeak,
    sheathHours: base.sheathHours,
    cloudHours: base.cloudHours,
    flareFlux: base.flareFlux,
    flareClass: flareClassName(base.flareFlux),
    rScale: rScale(base.flareFlux),
    sepPeak: base.sepPeak,
    sScale: sScale(base.sepPeak),
    forbushDepth: base.forbushDepth,
    launchSim,
    transitHours,
    arrivalSim: launchSim + transitHours,
    visualTransitSec: visualTransitSecFor(base.vPeak),
    // dinamik alanlar (simülasyon günceller)
    phase: 'transit', // 'transit' | 'sheath' | 'cloud' | 'recovery' | 'ended'
    transitProgress: 0,
    arrived: false,
    sepOnsetEmitted: false,
    seed: Math.random() * 1000,
  };
  storm.predicted = predictStormOutcome(storm);
  return storm;
}

/** Fırtınanın t (varıştan beri saat) anındaki evresi */
export function stormPhaseAt(storm, t) {
  if (t < 0) return 'transit';
  if (t < storm.sheathHours) return 'sheath';
  if (t < storm.sheathHours + storm.cloudHours) return 'cloud';
  if (t < storm.sheathHours + storm.cloudHours + 48) return 'recovery';
  return 'ended';
}

/**
 * Fırtınanın güneş rüzgârına katkısı. base: arka plan rüzgârı.
 * Dönen: { speed, density, by, bz, weight } — weight∈[0,1]: IMF'ye ne kadar hâkim olduğu.
 */
export function stormSolarWindAt(storm, t, base) {
  if (t < 0) return null;
  const Ts = storm.sheathHours;
  const Tc = storm.cloudHours;
  const ph = storm.seed;
  if (t < Ts) {
    // Kılıf: şokla ani sıçrama, yoğun ve türbülanslı alan
    const ramp = clamp(t / 0.3, 0, 1);
    const turb = Math.sin(t * 4.1 + ph) * 0.6 + Math.sin(t * 9.7 + ph * 2) * 0.4;
    return {
      speed: base.speed + (storm.vPeak - base.speed) * ramp,
      density: base.density + (storm.nPeak * (1 + 0.25 * Math.sin(t * 3 + ph)) - base.density) * ramp,
      by: storm.bsPeak * 0.55 * Math.cos(t * 2.3 + ph),
      bz: -storm.bsPeak * 0.45 * (0.4 + turb * 0.6),
      weight: ramp,
    };
  }
  if (t < Ts + Tc) {
    // Manyetik bulut: düşük yoğunluk, düzgün dönen güçlü alan (güneye yönelmiş)
    const u = (t - Ts) / Tc;
    const sn = Math.sin(Math.PI * u);
    return {
      speed: storm.vPeak * (1 - 0.15 * u),
      density: Math.max(base.density, storm.nPeak * 0.35 * (1 - 0.5 * u)),
      by: storm.bsPeak * 0.45 * Math.cos(Math.PI * u),
      bz: -storm.bsPeak * Math.pow(sn, 0.7),
      weight: 1,
    };
  }
  // Toparlanma: rüzgâr yavaşça normale döner
  const tr = t - Ts - Tc;
  const w = Math.exp(-tr / 10);
  return {
    speed: base.speed + (storm.vPeak * 0.85 - base.speed) * w,
    density: base.density,
    by: base.by,
    bz: base.bz,
    weight: w * 0.5,
  };
}

/** SEP (≥10 MeV) proton akısı katkısı [pfu]. tl: fırlatmadan beri saat */
export function stormSepAt(storm, tl) {
  const tp = 4 + 8 * (1 - storm.strength);
  const t1 = tl - 0.3; // hızlı protonların gelişi
  if (t1 <= 0) return 0;
  const g = (t1 / tp) * Math.exp(1 - t1 / tp);
  // Şok varışında enerjik parçacık (ESP) artışı
  const esp = 1 + 2 * Math.exp(-Math.abs(tl - storm.transitHours) / 4);
  return storm.sepPeak * g * esp;
}

/** Forbush azalması derinliği katkısı (0..1). t: varıştan beri saat */
export function stormForbushAt(storm, t) {
  if (t <= 0) return 0;
  const h = (1 - Math.exp(-t / 2)) * Math.exp(-Math.max(0, t - 8) / 60);
  return storm.forbushDepth * h;
}
