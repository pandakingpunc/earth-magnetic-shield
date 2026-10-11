// Merkezî simülasyon durumu. Tek doğruluk kaynağı: arayüz parametreleri yazar,
// simulation.js türetilmiş değerleri hesaplar, sahne katmanları ve arayüz okur.

import * as THREE from 'three';
import { QUIET_SOLAR_WIND, LAYER_DEFAULTS } from './constants.js';

export const HISTORY_HOURS = 96;
export const HISTORY_STEP_HOURS = 0.25;

export function createState() {
  return {
    time: {
      simHours: 0,
      // Simülasyon başlangıç anı (UTC, ms). Varsayılan: 11 Ekim 2026 12:00 UT
      startEpochMs: Date.UTC(2026, 9, 11, 12, 0, 0),
      timeScale: 0.25, // sim saati / gerçek saniye
      visualSpeed: 1, // parçacık animasyon hızı çarpanı
      paused: false,
      fastForward: false, // CME yolculuğu sırasında zaman otomatik hızlanır
      effectiveRate: 0.25,
    },

    // Kullanıcı tarafından ayarlanan parametreler
    params: {
      solarWind: { ...QUIET_SOLAR_WIND }, // arka plan rüzgârı
      fieldStrength: 1, // dipol momenti çarpanı (0..2)
      polarity: 1, // +1 bugünkü, −1 ters
      realisticTilt: true, // dipol ekseni dönme ekseninden ~9.4° eğik
      stormStrength: 0.5, // sonraki fırtına gücü (0..1)
      stormPresetId: null, // null → özel güç
      autoTimeWarp: true, // CME yolculuğunda zamanı hızlandır
      cosmic: {
        backgroundIntensity: 0.35, // galaktik kozmik ışın (GKI) arka plan akısı (0..1)
        burstIntensity: 0.6, // patlama büyüklüğü (0..1)
        rigidityGV: 5, // parçacık sertliği (GV), 0.05..100
        particle: 'proton', // 'proton' | 'electron' | 'alpha'
      },
      layers: { ...LAYER_DEFAULTS },
    },

    // Etkin (fırtına katkıları eklenmiş) güneş rüzgârı
    sw: {
      speed: QUIET_SOLAR_WIND.speed,
      density: QUIET_SOLAR_WIND.density,
      by: QUIET_SOLAR_WIND.by,
      bz: QUIET_SOLAR_WIND.bz,
      bt: Math.hypot(QUIET_SOLAR_WIND.by, QUIET_SOLAR_WIND.bz),
      temperature: QUIET_SOLAR_WIND.temperature,
      pdyn: 1.34,
      mach: 6,
    },

    // Türetilmiş fiziksel büyüklükler (simulation.js her karede günceller)
    derived: {
      r0: 10.5, // manyetopoz burnu (Re)
      alpha: 0.58, // Shue kuyruk açılması
      rbs: 13.5, // yay şoku burnu (Re)
      dipoleMoment: 1, // işaretli dipol momenti çarpanı
      quadrupole: 0, // kuadrupol ağırlığı (tersinme sırasında)
      shieldStrength: 1, // etkin kalkan gücü (0..~2)
      dipoleTiltDeg: 0, // dipolün Güneş'e doğru eğimi
      coupling: 0, // Newell dΦ/dt
      kp: 1.7,
      kpMax24: 1.7,
      dst: -5,
      dstStar: 0,
      dstMinStorm: 0,
      g: 0, s: 0, r: 0,
      xrayFlux: 1e-7,
      flareClass: 'B1.0',
      sepPfu: 0.1,
      gcrRelative: 1, // GKI akısı (1 = normal; Forbush azalmasında < 1)
      auroraLat: 63, // ovalin ekvator sınırı (manyetik enlem)
      auroraWidth: 5.4,
      auroraIntensity: 0.15, // 0..~1.3
      turkeyAurora: 'none', // 'none' | 'horizon' | 'visible' | 'overhead'; jeomanyetik erişilebilirlik (yalnızca enlem); gece/gündüz için turkeyDark'a bak
      istanbulMagLat: 38, // |manyetik enlem|, canlı dipol ekseninden (tersinme dahil)
      istanbulSunElevDeg: 30, // İstanbul'da Güneş yüksekliği (derece)
      turkeyDark: false, // Güneş ufkun 12° altında: aurora gözlemi mümkün
      plasmapauseL: 4.8,
      belts: { inner: 1, outer: 1, slot: 0 },
      reconnection: { dayside: 0, nightside: 0 },
      substormCount: 0,
      atmosphericEscape: 1.5, // kg/s (tahmini)
      impacts: { issDose: 20, flightDose: 6, groundDose: 0.03, gpsError: 2, dragFactor: 1, gridRisk: 0, geoExposed: false },
    },

    // Yönelim çerçevesi (sahne koordinatlarında)
    frame: {
      earthQuaternion: new THREE.Quaternion(),
      spinAxis: new THREE.Vector3(0, 1, 0),
      dipoleAxis: new THREE.Vector3(0, 1, 0), // kuzey jeomanyetik kutup yönü (birim)
      earthRotationRad: 0,
      dayOfYear: 284,
      utHours: 12,
    },

    storms: [], // aktif fırtınalar (bkz. physics/stormProfile.js createStorm)

    reversal: { active: false, progress: 0, durationSec: 24 },

    cosmic: {
      stats: { spawned: 0, impacts: 0, escaped: 0, polarImpacts: 0, equatorialImpacts: 0 },
    },

    history: {
      t: [], kp: [], dst: [], bz: [], speed: [], density: [], r0: [], sep: [], gcr: [],
    },

    log: [], // { simHours, level, text }
  };
}

/** Sim saatini UTC tarihe çevirir */
export function simDate(state) {
  return new Date(state.time.startEpochMs + state.time.simHours * 3600e3);
}
