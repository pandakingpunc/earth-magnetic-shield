// Paylaşılan fiziksel ve sahne sabitleri.
// Sahne birimi: 1 birim = 1 Dünya yarıçapı (Re).
// Koordinatlar (GSE benzeri): +X Güneş'e doğru, +Y ekliptik kuzeyi, +Z şafak (dawn) tarafı.

export const RE_KM = 6371;
export const AU_KM = 1.495978707e8;

// Güneş görsel olarak ölçeksiz konumlandırılır (gerçekte ~23 500 Re uzakta).
export const SUN_SCENE_DISTANCE = 48;
export const SUN_VISUAL_RADIUS = 4.2;

export const EARTH = {
  siderealHours: 23.9345,
  axialTiltDeg: 23.44,
  // IGRF-13 (2020) jeomanyetik kuzey kutbu
  geomagNorthLatDeg: 80.65,
  geomagNorthLonDeg: -72.68,
  atmosphereTopRe: 1.0157, // ~100 km
};

// Sakin güneş rüzgârı (L1 tipik değerleri)
export const QUIET_SOLAR_WIND = {
  speed: 400, // km/s
  density: 5, // cm^-3
  by: 4, // nT (IMF GSM By)
  bz: 1, // nT (IMF GSM Bz, + kuzey, - güney)
  temperature: 1.0e5, // K
};

// Dipol alanı: yüzey ekvator alanı ve Störmer sabitleri
export const DIPOLE = {
  surfaceEquatorTesla: 3.12e-5,
  // Gyro yarıçapı [Re] = GYRO_RE_PER_GV * R[GV] / |b|   (b: yüzey ekvator alanına göre normalize)
  gyroRePerGV: 0.01678,
  // Dikey Störmer kesme sertliği (ekvator, yüzey) [GV]
  stormerVerticalGV: 14.9,
};

export const ORBITS = {
  ISS: { altitudeKm: 420, inclinationDeg: 51.64, periodMin: 92.7 },
  GPS: { radiusRe: 4.164, inclinationDeg: 55, periodHours: 11.967, planes: 6, perPlane: 4 },
  GEO: { radiusRe: 6.6107, inclinationDeg: 0, periodHours: 23.9345 },
  MOON: { radiusRe: 60.27, periodDays: 27.3217, inclinationDeg: 5.14 },
};

// Türkiye'deki bazı şehirler (coğrafi enlem/boylam)
export const TURKISH_CITIES = [
  { name: 'İstanbul', lat: 41.01, lon: 28.98 },
  { name: 'Ankara', lat: 39.93, lon: 32.86 },
  { name: 'İzmir', lat: 38.42, lon: 27.14 },
  { name: 'Erzurum', lat: 39.9, lon: 41.27 },
  { name: 'Kars', lat: 40.6, lon: 43.1 },
];

// Görsel hız ölçekleri (gerçek saniye başına sahne birimi). Fiziksel hızla orantılıdır.
export const VISUAL = {
  solarWindRePerSecAt400: 6.0, // 400 km/s rüzgâr görselde ~6 Re/s akar
  cosmicRayRePerSec: 14.0, // ~ışık hızındaki parçacıklar
  cmeVisualTransitSec: 7.0, // CME'nin Güneş'ten Dünya'ya görsel yolculuğu (hızlıysa daha kısa)
};

export const LAYER_DEFAULTS = {
  fieldLines: true,
  magnetopause: true,
  bowShock: true,
  solarWind: true,
  radiationBelts: true,
  aurora: true,
  cosmicRays: true,
  satellites: true,
  labels: true,
  stars: true,
  moon: false,
  sunEarthLine: false,
  axes: true,
};

export const COLORS = {
  fieldClosed: 0x59c8ff,
  fieldOpen: 0xff8a5c,
  magnetopause: 0x3fa9ff,
  bowShock: 0xffc04d,
  solarWindQuiet: 0xffe6a8,
  solarWindStorm: 0xff5a2e,
  cme: 0xff7a3d,
  innerBelt: 0xff5577,
  outerBelt: 0x7f6bff,
  auroraGreen: 0x4dff88,
  auroraRed: 0xff3a5c,
  cosmicProton: 0x9fd8ff,
  cosmicElectron: 0xb98cff,
  sep: 0xfff07a,
};
