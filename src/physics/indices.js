// Uzay havası indeksleri ve etkileri: Newell bağlaşımı, Kp, Dst (O'Brien & McPherron 2000),
// aurora sınırı, NOAA G/S/R ölçekleri ve teknolojik etki tahminleri.
// Not: Etki tahminleri (doz, GPS hatası, sürüklenme) eğitsel amaçlı kaba yaklaşımlardır.

import { DIPOLE } from '../core/constants.js';
import { t, getLang } from '../i18n/index.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** IMF saat açısı θc = atan2(By, Bz) */
export function clockAngle(by, bz) {
  return Math.atan2(by, bz);
}

/** Newell ve ark. (2007) evrensel bağlaşım fonksiyonu dΦ/dt = v^(4/3) Bt^(2/3) sin^(8/3)(θc/2) */
export function newellCoupling(v, by, bz) {
  const bt = Math.hypot(by, bz);
  const s = Math.abs(Math.sin(clockAngle(by, bz) / 2));
  return Math.pow(Math.max(v, 0), 4 / 3) * Math.pow(bt, 2 / 3) * Math.pow(s, 8 / 3);
}

/**
 * Kp tahmini: Newell ve ark. (2008) Kp = 0.05 + 2.244e-4·dΦ/dt + 2.844e-6·n^½·v²
 * ve gerçek Kp 9’da doyduğu için yumuşak doyum: Kp = 9(1 − e^(−ham/11)).
 */
export function kpFromSolarWind(v, n, by, bz) {
  const raw = 0.05 + 2.244e-4 * newellCoupling(v, by, bz) + 2.844e-6 * Math.sqrt(Math.max(n, 0)) * v * v;
  return clamp(9 * (1 - Math.exp(-raw / 11)), 0, 9);
}

/** Dst'den Kp alt sınırı (fırtına ana evresinde Kp'nin düşmemesi için kaba eşleme) */
export function kpFloorFromDst(dst) {
  if (dst >= -20) return 0;
  return clamp(2 + 2.1 * Math.log(-dst / 20) * 1.2, 0, 9);
}

/** Bs ile kenetlenmiş y-bileşenli elektrik alanı VBs [mV/m]: v km/s, bz nT */
export function vbs(v, bz) {
  return bz < 0 ? (v * -bz) / 1000 : 0;
}

/**
 * O'Brien & McPherron (2000) halka akımı modeli tek adım (Euler, alt adımlı).
 * dDst*÷dt = Q − Dst* ÷ τ;  Q = −4.4 (VBs − 0.49) [nT/h], τ = 2.4 exp(9.74/(4.69+VBs)) [h]
 * Dst = Dst* + 7.26 √Pdyn − 11
 * Dönen: yeni dstStar
 */
export function stepDstStar(dstStar, v, bz, dtHours) {
  const e = vbs(v, bz);
  const Q = e > 0.49 ? -4.4 * (e - 0.49) : 0;
  const tau = 2.4 * Math.exp(9.74 / (4.69 + e));
  const steps = Math.max(1, Math.ceil(dtHours / 0.05));
  const h = dtHours / steps;
  let d = dstStar;
  for (let i = 0; i < steps; i++) {
    // Kararlı yarı-örtük güncelleme
    d = (d + h * Q) / (1 + h / tau);
  }
  return d;
}

export function dstFromStar(dstStar, pdyn) {
  return dstStar + 7.26 * Math.sqrt(Math.max(pdyn, 0)) - 11;
}

export function dstStarFromDst(dst, pdyn) {
  return dst - 7.26 * Math.sqrt(Math.max(pdyn, 0)) + 11;
}

/**
 * Dst fırtına sınıfı eşikleri [nT]; HUD, bilgi tablosu ve uyarılar aynı eşikleri kullanır.
 * Yoğun: Dst < −100 (Gonzalez ve ark. 1994); süper fırtına: Dst ≤ −250 (Echer ve ark. 2008).
 * “Şiddetli” sözcüğü NOAA G4 için ayrılmıştır, Dst sınıflarında kullanılmaz.
 */
export const DST_THRESHOLDS = {
  weak: -30,
  moderate: -50,
  intense: -100,
  superstorm: -250,
  carrington: -850, // 1859 tahminlerinin alt ucu (−850…−1 760 nT)
};

/** Dst fırtına sınıfının görünen adı (etkin dilde) */
export function dstClass(dst) {
  if (dst > DST_THRESHOLDS.weak) return t('dst.class.quiet');
  if (dst > DST_THRESHOLDS.moderate) return t('dst.class.weak');
  if (dst > DST_THRESHOLDS.intense) return t('dst.class.moderate');
  if (dst > DST_THRESHOLDS.superstorm) return t('dst.class.intense');
  return t('dst.class.super');
}

/**
 * Aurora ovalinin ekvator tarafı sınırı (manyetik enlem, derece).
 * ~66° − 2°·Kp (Starkov 1994 yaklaşık) + aşırı fırtınalarda Dst'ye bağlı ek genişleme
 * (Carrington ~ −1000 nT için ~25°, gözlemlerle uyumlu).
 */
export function auroraEquatorwardLat(kp, dst) {
  const extra = Math.max(0, (-dst - 300) / 40);
  return clamp(66.5 - 2.0 * kp - extra, 18, 70);
}

/** Oval genişliği (derece) */
export function auroraOvalWidth(kp) {
  return 4 + 0.8 * kp;
}

/** Aurora gözlemcinin ufkunda görülebilir mi? ~100–400 km yükseklik → ~8–10° ötesinden görülür. Dönen kod: 'none' | 'horizon' | 'visible' | 'overhead' */
export function auroraVisibility(observerMagLatDeg, equatorwardLat) {
  const d = Math.abs(observerMagLatDeg) - equatorwardLat;
  if (d >= 0) return 'overhead';
  if (d >= -5) return 'visible';
  if (d >= -9) return 'horizon';
  return 'none';
}

/**
 * NOAA jeomanyetik fırtına ölçeği (Kp eşikleri: G1 = 5-, G2 = 6-, G3 = 7-, G4 = 8-, G5 = yalnız 9o).
 * 9- (8,67) hâlâ G4’tür; sürekli Kp için G5 sınırı 9- ile 9o arasındaki orta nokta (8,83).
 */
export function gScale(kp) {
  if (kp >= 8.83) return 5;
  if (kp >= 7.67) return 4;
  if (kp >= 6.67) return 3;
  if (kp >= 5.67) return 2;
  if (kp >= 4.67) return 1;
  return 0;
}

/** NOAA radyasyon fırtınası ölçeği (≥10 MeV proton akısı, pfu) */
export function sScale(pfu) {
  if (pfu >= 1e5) return 5;
  if (pfu >= 1e4) return 4;
  if (pfu >= 1e3) return 3;
  if (pfu >= 1e2) return 2;
  if (pfu >= 10) return 1;
  return 0;
}

/** NOAA radyo karartması ölçeği (X-ışını tepe akısı, W/m²) */
export function rScale(flux) {
  if (flux >= 2e-3) return 5;
  if (flux >= 1e-3) return 4;
  if (flux >= 1e-4) return 3;
  if (flux >= 5e-5) return 2;
  if (flux >= 1e-5) return 1;
  return 0;
}

/** GOES X-ışını akısından patlama sınıfı metni (ör. 'X2.1', 'M5.0') */
export function flareClassName(flux) {
  const classes = [
    ['X', 1e-4],
    ['M', 1e-5],
    ['C', 1e-6],
    ['B', 1e-7],
    ['A', 1e-8],
  ];
  for (const [letter, base] of classes) {
    if (flux >= base) return `${letter}${(flux / base).toFixed(1)}`;
  }
  return 'A0.0';
}

/**
 * Kalkanın engellediği galaktik kozmik ışın oranı (kaba, analitik; 0..1). M: dipol momenti çarpanı.
 * Her manyetik enlemde dikey Störmer kesmesi Rc = 14,9·|M|·cos⁴λ GV; kesmenin altındaki parçacıklar
 * giremez. Spektrum E⁻²·⁷ → ≥R integral akı ∝ R⁻¹·⁷ (0,5–200 GV arası). Enlemler cosλ ile
 * (küre alan elemanı) ağırlıklanır. Alan yoksa 0: parçacıklar hiç saptırılmaz.
 * (Sahnedeki parçacık sayaçları yalnızca görsel örnektir; bu oran onlardan türetilmez.)
 */
export function cosmicBlockedFraction(M) {
  const m = Math.abs(M);
  if (!(m > 1e-6)) return 0;
  const lo = 0.5;
  const a = Math.pow(lo, -1.7);
  const b = Math.pow(200, -1.7);
  const N = 90;
  let wSum = 0;
  let tSum = 0;
  for (let i = 0; i < N; i++) {
    const lat = ((i + 0.5) / N) * (Math.PI / 2);
    const c = Math.cos(lat);
    const rc = DIPOLE.stormerVerticalGV * m * c * c * c * c;
    const T = (Math.pow(Math.max(rc, lo), -1.7) - b) / (a - b);
    wSum += c;
    tSum += c * T;
  }
  return clamp(1 - tSum / wSum, 0, 1);
}

/** Carpenter & Anderson (1992) plazmapoz konumu: Lpp = 5.6 − 0.46·Kpmax(24 saat) */
export function plasmapauseL(kpMax24) {
  return clamp(5.6 - 0.46 * kpMax24, 1.8, 6.5);
}

// Dil başına önbellek: getter her çağrıda dizi üretmesin (HUD sık okur); dil değişirse yeniden kurulur
let _scaleLang = null;
let _scaleLabels = null;
function scaleLabels() {
  const lang = getLang();
  if (_scaleLang !== lang) {
    const build = () => [0, 1, 2, 3, 4, 5].map((i) => t(`scale.${i}`));
    _scaleLabels = { G: build(), S: build(), R: build() };
    _scaleLang = lang;
  }
  return _scaleLabels;
}

/** NOAA ölçek açıklamaları (G/S/R için 0..5 düzey adları); özellikler etkin dile göre tembel çözülür */
export const SCALE_LABELS = {
  get G() {
    return scaleLabels().G;
  },
  get S() {
    return scaleLabels().S;
  },
  get R() {
    return scaleLabels().R;
  },
};

/**
 * Teknolojik etki tahminleri (eğitsel, kaba).
 * input: { kp, dst, sepPfu, gcrRelative, fieldStrength, r0, flareFlux }
 */
export function impactEstimates({ kp, dst, sepPfu, gcrRelative, fieldStrength, r0 }) {
  const shieldLoss = clamp(1 - fieldStrength, 0, 1);
  // ISS içinde tipik ~0.5 mSv/gün ≈ 20 µSv/h; GKI kalkan zayıfladıkça artar; SEP katkısı yüksek enlem geçişlerinde
  const issDose = 20 * gcrRelative * (1 + 1.6 * shieldLoss * shieldLoss) + 0.09 * sepPfu * (0.15 + 0.85 * shieldLoss);
  // Kutup uçuşu (~11 km): tipik ~5–7 µSv/h
  const flightDose = 6 * gcrRelative * (1 + 2.2 * shieldLoss) + 0.004 * sepPfu;
  // Yerdeki ek doz (kalkan + atmosfer); kalkan kalkarsa artar
  const groundDose = 0.03 * gcrRelative * (1 + 1.4 * shieldLoss) + 1e-6 * sepPfu * (1 + 30 * shieldLoss);
  // Tek frekans GPS iyonosferik hata [m]
  const gpsError = 1.5 + 0.35 * Math.exp(0.42 * kp) + Math.max(0, -dst) * 0.01;
  // Termosfer yoğunluğu artışı → LEO sürüklenme çarpanı
  const dragFactor = Math.exp(0.14 * Math.max(0, kp - 1)) * (1 + Math.max(0, -dst - 100) / 400);
  // Elektrik şebekesi GIC riski 0..1
  const gridRisk = clamp((kp - 5) / 4, 0, 1) * 0.6 + clamp((-dst - 150) / 600, 0, 1) * 0.4;
  // GEO uyduları manyetopozun dışında kalabilir (r0 < 6.6 Re)
  const geoExposed = r0 < 6.61;
  return { issDose, flightDose, groundDose, gpsError, dragFactor, gridRisk, geoExposed };
}

/** Risk düzeyinin görünen adı (0..1 → Kritik … Minimal), etkin dilde */
export function riskLabel(x) {
  if (x >= 0.8) return t('risk.critical');
  if (x >= 0.55) return t('risk.high');
  if (x >= 0.3) return t('risk.moderate');
  if (x >= 0.1) return t('risk.low');
  return t('risk.minimal');
}
