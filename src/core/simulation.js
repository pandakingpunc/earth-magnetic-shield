// Uzay havası simülasyon motoru: zamanı ilerletir, güneş rüzgârını ve fırtınaları birleştirir,
// manyetopozu, indeksleri (Kp, Dst), auroraları, radyasyon kuşaklarını ve etkileri hesaplar.
// Görsel katmanlar yalnızca state'i okur; tetikleyiciler bu sınıfın metotlarıdır.

import * as THREE from 'three';
import { EARTH, QUIET_SOLAR_WIND, TURKISH_CITIES } from './constants.js';
import { HISTORY_HOURS, HISTORY_STEP_HOURS, simDate } from './state.js';
import { latLonToLocal, localToWorld, magneticLatitudeDeg, DEG, clamp } from './geo.js';
import { nf, nint } from './format.js';
import { t } from '../i18n/index.js';
import { dynamicPressure, shueParams, magnetosonicMach, bowShockStandoff } from '../physics/magnetopause.js';
import {
  newellCoupling, kpFromSolarWind, kpFloorFromDst, stepDstStar, dstFromStar, vbs,
  auroraEquatorwardLat, auroraOvalWidth, auroraVisibility, gScale, sScale, rScale, flareClassName,
  plasmapauseL, impactEstimates, SCALE_LABELS, DST_THRESHOLDS,
} from '../physics/indices.js';
import {
  createStorm, stormPhaseAt, stormSolarWindAt, stormSepAt, stormForbushAt, STORM_PRESETS,
} from '../physics/stormProfile.js';

const SUBSTEP_HOURS = 0.05;
const MAX_ACTIVE_STORMS = 6;
const KP_BIN_HOURS = 0.1; // son 24 saatin en büyük Kp'si için sim-saati kovası (kare hızından bağımsız)
const FLARE_HOLD_SEC = 4; // patlama tepesi rozet/HUD’da en az bu kadar gerçek saniye görünür (zaman hızlanmasına rağmen)
const FLARE_FADE_SEC = 1.5; // bekleme süresinin son kısmında yumuşak sönüm
const _Y = new THREE.Vector3(0, 1, 0);

/** Fırtına dışı senaryolar */
const scenario = (id) => ({
  get name() {
    return t(`scenario.${id}.name`);
  },
  get description() {
    return t(`scenario.${id}.description`);
  },
});

export const SCENARIOS = {
  quiet: scenario('quiet'),
  highSpeedStream: scenario('highSpeedStream'),
  noShield: scenario('noShield'),
  laschamp: scenario('laschamp'),
  reversal: scenario('reversal'),
};

export class SpaceWeatherSim {
  constructor(state, events) {
    this.state = state;
    this.events = events;
    this._dipoleLocal = latLonToLocal(EARTH.geomagNorthLatDeg, EARTH.geomagNorthLonDeg, 1);
    this._qTilt = new THREE.Quaternion();
    this._qSpin = new THREE.Quaternion();
    this._qRev = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
    this._nextSample = 0;
    this._flags = { g: 0, geo: false, turkey: false, dst100: false, dst250: false, dst600: false, dst850: false, sep: 0, shieldOff: false };
    this._tailEnergy = 0;
    this._substormAge = 99;
    this._outerTarget = 1;
    this._dstMinRecent = 0;
    this._kpRecent = []; // [kovaBaşlangıcıSimSaati, kovadaki en büyük kp], son 24 saat
    this._kp = state.derived.kp;
    this._kpTargetLast = this._kp;
    this._flarePeak = 0; // zaman hızlandırmada kısa süren patlamanın tutulan tepe akısı
    this._xrayPrev = 1e-7;
    this._flareHold = 0; // kalan bekleme (gerçek sn)
    this._istLocal = latLonToLocal(TURKISH_CITIES[0].lat, TURKISH_CITIES[0].lon, 1);
    this._istWorld = new THREE.Vector3();

    events.on('cosmic:impact', (e) => {
      const st = this.state.cosmic.stats;
      st.impacts++;
      if (Math.abs(e.magLatDeg) >= 55) st.polarImpacts++;
      else if (Math.abs(e.magLatDeg) < 30) st.equatorialImpacts++;
    });
    events.on('cosmic:escaped', () => {
      this.state.cosmic.stats.escaped++;
    });

    this._computeFrame();
    this._substep(0, true);
  }

  // ------------------------------------------------------------------ tetikleyiciler

  /** Güneş fırtınası: patlama (anında) → SEP (dakikalar-saatler) → CME (1–3 gün) */
  triggerSolarStorm({ strength = this.state.params.stormStrength, presetId = this.state.params.stormPresetId } = {}) {
    const s = this.state;
    if (s.storms.length >= MAX_ACTIVE_STORMS) {
      this.alert('warn', t('alert.maxStorms', { max: MAX_ACTIVE_STORMS }));
      return null;
    }
    const storm = createStorm({ strength, presetId: presetId || null, launchSim: s.time.simHours });
    s.storms.push(storm);
    this.events.emit('flare', { storm, flareClass: storm.flareClass, rScale: storm.rScale });
    this.events.emit('storm:launched', { storm });
    const radio = storm.rScale > 0 ? t('alert.flare.radio', { n: storm.rScale, label: SCALE_LABELS.R[storm.rScale] }) : '';
    this.alert(storm.rScale >= 3 ? 'danger' : 'warn', t('alert.flare', { cls: storm.flareClass, radio }));
    this.alert(
      'info',
      t('alert.cme', {
        v: nint(storm.vPeak),
        h: nf(storm.transitHours, 0),
        warp: t(s.params.autoTimeWarp ? 'alert.cme.warpOn' : 'alert.cme.warpOff'),
        g: storm.predicted.g,
        dst: nint(storm.predicted.dstMin),
      }),
    );
    return storm;
  }

  /** Kozmik ışın patlaması: katman bu olayı dinleyip parçacık üretir */
  triggerCosmicBurst({
    intensity = this.state.params.cosmic.burstIntensity,
    rigidityGV = this.state.params.cosmic.rigidityGV,
    particle = this.state.params.cosmic.particle,
    direction = null,
  } = {}) {
    const count = Math.round(20 + 380 * clamp(intensity, 0, 1));
    const charge = particle === 'electron' ? -1 : particle === 'alpha' ? 2 : 1;
    this.events.emit('cosmic:burst', { intensity, rigidityGV, charge, particle, count, direction });
    const pKey = particle === 'electron' || particle === 'alpha' ? particle : 'proton';
    this.alert('info', t('alert.cosmic', { count, particle: t(`particle.${pKey}.long`), rigidity: nf(rigidityGV, rigidityGV < 1 ? 2 : 1) }));
  }

  startPoleReversal() {
    const rv = this.state.reversal;
    if (rv.active) return;
    rv.active = true;
    rv.progress = 0;
    this.events.emit('reversal:start', {});
    this.alert('warn', t('alert.reversalStart'));
  }

  setFieldStrength(f) {
    this.state.params.fieldStrength = clamp(f, 0, 2);
  }

  /** Mevsimi değiştir: yılın günü (1..365) */
  setDayOfYear(doy) {
    const s = this.state;
    const now = simDate(s);
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);
    const target = yearStart + (clamp(doy, 1, 365) - 1) * 86400e3 + (now.getTime() - yearStart) % 86400e3;
    s.time.startEpochMs += target - now.getTime();
    this._computeFrame();
  }

  applyPreset(id) {
    const s = this.state;
    if (STORM_PRESETS[id]) {
      this.events.emit('preset:applied', { id, name: STORM_PRESETS[id].name });
      this.alert('info', t('alert.preset', { name: STORM_PRESETS[id].name, description: STORM_PRESETS[id].description }));
      return this.triggerSolarStorm({ presetId: id });
    }
    const sc = SCENARIOS[id];
    if (!sc) return null;
    const sw = s.params.solarWind;
    switch (id) {
      case 'quiet':
        Object.assign(sw, QUIET_SOLAR_WIND);
        s.params.fieldStrength = 1;
        s.storms.length = 0;
        break;
      case 'highSpeedStream':
        Object.assign(sw, { speed: 750, density: 3, by: 5, bz: -3 });
        break;
      case 'noShield':
        s.params.fieldStrength = 0;
        break;
      case 'laschamp':
        s.params.fieldStrength = 0.06;
        break;
      case 'reversal':
        this.startPoleReversal();
        break;
    }
    this.events.emit('preset:applied', { id, name: sc.name });
    this.alert('info', t('alert.scenario', { name: sc.name, description: sc.description }));
    return null;
  }

  reset() {
    const s = this.state;
    s.storms.length = 0;
    Object.assign(s.params.solarWind, QUIET_SOLAR_WIND);
    s.params.fieldStrength = 1;
    s.params.polarity = 1;
    s.reversal.active = false;
    s.reversal.progress = 0;
    s.derived.dstStar = 0;
    s.derived.dstMinStorm = 0;
    this._dstMinRecent = 0;
    this._outerTarget = 1;
    s.derived.belts.outer = 1;
    s.derived.belts.slot = 0;
    this._kp = 1.7;
    this._kpRecent.length = 0;
    this._tailEnergy = 0;
    s.derived.substormCount = 0;
    this._substormAge = 99;
    s.derived.reconnection.nightside = 0;
    this._flarePeak = 0;
    this._flareHold = 0;
    this._xrayPrev = 1e-7;
    Object.assign(s.cosmic.stats, { spawned: 0, impacts: 0, escaped: 0, polarImpacts: 0, equatorialImpacts: 0 });
    for (const k of Object.keys(s.history)) s.history[k].length = 0;
    this._nextSample = s.time.simHours;
    this._flags = { g: 0, geo: false, turkey: false, dst100: false, dst250: false, dst600: false, dst850: false, sep: 0, shieldOff: false };
    // Duraklatılmış olsa bile türetilmiş değerler ve bir geçmiş örneği hemen tazelensin
    this._substep(0, true);
    this.events.emit('sim:reset', {});
    this.alert('info', t('alert.reset'));
  }

  /** group: aynı kategorideki art arda yükselmeler (S3→S4→S5, G2→G3…) arayüzde tek bildirimde birleşsin diye (günlük hepsini tutar) */
  alert(level, text, group = null) {
    const entry = { simHours: this.state.time.simHours, level, text };
    if (group) entry.group = group;
    this.state.log.push(entry);
    if (this.state.log.length > 200) this.state.log.shift();
    this.events.emit('alert', entry);
  }

  // ------------------------------------------------------------------ ana döngü

  /** Her karede çağrılır. realDt: gerçek saniye. Dönen: { simDt (saat), visDt (görsel saniye) } */
  update(realDt) {
    const s = this.state;
    const tm = s.time;
    realDt = Math.min(realDt, 0.1);
    if (tm.paused) {
      // Zaman durur ama kaydırıcılar, önayarlar ve sıfırlama etkisini göstermeli: h = 0 ile yeniden hesapla
      this._substep(0);
      this._computeFrame();
      return { simDt: 0, visDt: 0 };
    }

    // Kutup tersinmesi gerçek zamanla (sıkıştırılmış) ilerler
    if (s.reversal.active) {
      s.reversal.progress += (realDt * tm.visualSpeed) / s.reversal.durationSec;
      if (s.reversal.progress >= 1) {
        s.reversal.active = false;
        s.reversal.progress = 0;
        s.params.polarity *= -1;
        this.events.emit('reversal:end', {});
        this.alert('info', t('alert.reversalDone', { polarity: t(s.params.polarity > 0 ? 'alert.polarity.normal' : 'alert.polarity.reversed') }));
      }
    }

    // Etkin zaman hızı: yolda olan CME varsa zamanı hızlandır
    let rate = tm.timeScale;
    tm.fastForward = false;
    if (s.params.autoTimeWarp) {
      for (const st of s.storms) {
        if (!st.arrived) {
          const r = st.transitHours / st.visualTransitSec;
          if (r > rate) {
            rate = r;
            tm.fastForward = true;
          }
        }
      }
    }
    tm.effectiveRate = rate;
    const simDt = realDt * rate;

    // Patlama tepesi bekleme süresi gerçek zamanla azalır; bitince tutulan tepe bırakılır
    this._flareHold = Math.max(0, this._flareHold - realDt);
    if (this._flareHold <= 0) this._flarePeak = 0;

    const n = Math.max(1, Math.ceil(simDt / SUBSTEP_HOURS));
    const h = simDt / n;
    for (let i = 0; i < n; i++) {
      tm.simHours += h;
      this._substep(h);
    }
    this._computeFrame();
    return { simDt, visDt: realDt * tm.visualSpeed };
  }

  // ------------------------------------------------------------------ iç hesaplar

  _effectiveWind(now) {
    const s = this.state;
    const base = s.params.solarWind;
    const sw = { speed: base.speed, density: base.density, by: base.by, bz: base.bz };
    let bestW = 0;
    for (const st of s.storms) {
      const c = stormSolarWindAt(st, now - st.arrivalSim, base);
      if (!c) continue;
      sw.speed = Math.max(sw.speed, c.speed);
      sw.density = Math.max(sw.density, c.density);
      if (c.weight > bestW) {
        bestW = c.weight;
        sw.by = base.by * (1 - c.weight) + c.by * c.weight;
        sw.bz = base.bz * (1 - c.weight) + c.bz * c.weight;
      }
    }
    return sw;
  }

  /** h: alt adım (sim saati); h = 0 yalnızca türetilmiş değerleri yeniden hesaplar (zaman ilerlemez, tekrarlanabilir).
   *  snap: h = 0 iken Kp'yi hedefe oturt (başlangıç/sıfırlama). */
  _substep(h, snap = false) {
    const s = this.state;
    const d = s.derived;
    const now = s.time.simHours;

    // --- Fırtına evreleri
    for (const st of s.storms) {
      const tArr = now - st.arrivalSim;
      st.transitProgress = clamp((now - st.launchSim) / st.transitHours, 0, 1);
      const phase = stormPhaseAt(st, tArr);
      if (!st.arrived && tArr >= 0) {
        st.arrived = true;
        st._arrivePending = true;
      }
      if (phase !== st.phase) {
        st.phase = phase;
        if (phase === 'ended') {
          this.events.emit('storm:ended', { storm: st });
          this.alert('info', t('alert.stormEnded', { name: st.name }));
        }
      }
    }
    s.storms = s.storms.filter((st) => st.phase !== 'ended');

    // --- Güneş rüzgârı
    const sw = this._effectiveWind(now);
    s.sw.speed = sw.speed;
    s.sw.density = sw.density;
    s.sw.by = sw.by;
    s.sw.bz = sw.bz;
    s.sw.bt = Math.hypot(sw.by, sw.bz);
    s.sw.temperature = 1e5 * Math.pow(sw.speed / 400, 2);
    s.sw.pdyn = dynamicPressure(sw.density, sw.speed);
    s.sw.mach = magnetosonicMach(sw.speed, sw.density, s.sw.bt, s.sw.temperature);

    // --- Manyetik alan gücü (tersinme dahil)
    const f = s.params.fieldStrength;
    let M = f * s.params.polarity;
    let Q = 0;
    if (s.reversal.active) {
      const p = s.reversal.progress;
      const mag = 0.12 + 0.88 * Math.abs(Math.cos(Math.PI * p));
      M = f * s.params.polarity * mag * (p < 0.5 ? 1 : -1);
      Q = f * 0.32 * Math.sin(Math.PI * p);
    }
    d.dipoleMoment = M;
    d.quadrupole = Q;
    d.shieldStrength = Math.sqrt(M * M + 0.5 * Q * Q);

    // --- Manyetopoz ve yay şoku
    const mp = shueParams(s.sw.pdyn, s.sw.bz, d.shieldStrength);
    d.r0 = mp.r0;
    d.alpha = mp.alpha;
    d.rbs = bowShockStandoff(mp.r0, s.sw.mach);

    // --- Bağlaşım, Dst, Kp
    d.coupling = newellCoupling(s.sw.speed, s.sw.by, s.sw.bz);
    const shieldCoupling = Math.min(1, d.shieldStrength); // alan yoksa halka akımı da yok
    if (h > 0) {
      d.dstStar = stepDstStar(d.dstStar, s.sw.speed, s.sw.bz * shieldCoupling, h);
    }
    d.dst = dstFromStar(d.dstStar, s.sw.pdyn) * (0.3 + 0.7 * shieldCoupling);
    // Alan yoksa halka akımı (Dst) gibi Kp/aurora/şebeke etkisi de sönük kalır
    const kpShield = 0.3 + 0.7 * shieldCoupling;
    const kpTarget = Math.max(kpFromSolarWind(s.sw.speed, s.sw.density, s.sw.by, s.sw.bz), kpFloorFromDst(d.dst)) * kpShield;
    if (h > 0) {
      const tau = kpTarget > this._kp ? 0.4 : 2.0; // hızlı yükselme, yavaş düşüş
      this._kp += (kpTarget - this._kp) * (1 - Math.exp(-h / tau));
    } else if (snap || Math.abs(kpTarget - this._kpTargetLast) > 1e-4) {
      // Zaman ilerlemeden hedef değiştiyse (duraklatılmışken kaydırıcı/önayar) anında yansıt;
      // değişmediyse gecikmeli Kp'yi yerinde bırak (duraklatınca sıçramasın)
      this._kp = kpTarget;
    }
    this._kpTargetLast = kpTarget;
    d.kp = clamp(this._kp, 0, 9);

    // son 24 saatin en büyük Kp'si (plazmapoz için): sim-saati kovaları, kare hızından bağımsız
    if (h > 0) {
      const last = this._kpRecent[this._kpRecent.length - 1];
      if (last && now - last[0] < KP_BIN_HOURS) last[1] = Math.max(last[1], d.kp);
      else this._kpRecent.push([now, d.kp]);
      while (this._kpRecent.length > 1 && this._kpRecent[0][0] < now - 24) this._kpRecent.shift();
    }
    let kpMax = d.kp; // h = 0 anlık değeri pencereye yazmaz (olmamış bir tepe kalıcı olmasın)
    for (const e of this._kpRecent) if (e[1] > kpMax) kpMax = e[1];
    d.kpMax24 = kpMax;

    // fırtına minimum Dst takibi
    this._dstMinRecent = Math.min(this._dstMinRecent, d.dst);
    if (h > 0) this._dstMinRecent *= Math.exp(-h / 72); // ~3 günde unutulur
    d.dstMinStorm = Math.min(d.dstMinStorm, d.dst);
    if (!s.storms.length && h > 0) d.dstMinStorm *= Math.exp(-h / 24);

    // --- X-ışını (patlama) ve SEP
    let xray = 1e-7;
    let sep = 0.1;
    let forbush = 0;
    for (const st of s.storms) {
      const tl = now - st.launchSim;
      if (tl >= 0) {
        const rise = clamp(tl / 0.12, 0, 1);
        xray += st.flareFlux * rise * Math.exp(-Math.max(0, tl - 0.12) / 0.6);
      }
      sep += stormSepAt(st, tl);
      forbush += stormForbushAt(st, now - st.arrivalSim);
    }
    // CME yolculuğunda zaman hızlandığı için patlama <1 sn sürebilir: rozet/HUD için tepeyi gerçek zamanda kısa süre tut
    // (yalnızca yükselen kenarda kurulur; sönen zarf kendini yeniden tutmaz)
    const rising = xray > this._xrayPrev;
    this._xrayPrev = xray;
    if (rising && xray >= this._flarePeak) {
      this._flarePeak = xray;
      this._flareHold = FLARE_HOLD_SEC;
    }
    const held = this._flarePeak * clamp(this._flareHold / FLARE_FADE_SEC, 0, 1);
    if (held > xray) xray = held;
    d.xrayFlux = xray;
    d.flareClass = flareClassName(xray);
    d.sepPfu = sep;
    d.gcrRelative = clamp(1 - forbush, 0.4, 1);

    d.g = gScale(d.kp);
    d.s = sScale(sep);
    d.r = rScale(xray);

    // --- Yeniden birleşme ve alt fırtınalar (yükleme-boşalma)
    const e = vbs(s.sw.speed, s.sw.bz) * shieldCoupling;
    d.reconnection.dayside = clamp(e / 15, 0, 1);
    if (h > 0) {
      this._tailEnergy += e * h;
      this._substormAge += h;
      const threshold = 6 + 4 * Math.exp(-e / 5);
      if (this._tailEnergy > threshold && this._substormAge > 1.2 && shieldCoupling > 0.15) {
        this._tailEnergy = 0;
        this._substormAge = 0;
        d.substormCount++;
        this.alert('info', t('alert.substorm'));
      }
      this._tailEnergy *= Math.exp(-h / 8);
    }
    d.reconnection.nightside = Math.exp(-this._substormAge / 0.5);

    // --- Aurora
    // Zayıf alanda oval düşük enlemlere kayar (kesme enlemi ∝ M^(1/... ) yaklaşık)
    const fieldShift = d.shieldStrength < 1 ? (1 - Math.sqrt(Math.max(d.shieldStrength, 0))) * 30 : -(Math.sqrt(d.shieldStrength) - 1) * 6;
    d.auroraLat = clamp(auroraEquatorwardLat(d.kp, d.dst) - fieldShift, 12, 72);
    d.auroraWidth = auroraOvalWidth(d.kp);
    d.auroraIntensity = clamp(0.12 + Math.pow(d.kp / 9, 1.4) * 0.9 + d.reconnection.nightside * 0.35, 0, 1.4) * (d.shieldStrength > 0.02 ? 1 : 0.15);
    // Küresel dipol yoksa oval oluşmaz (Mars benzeri yalnızca sönük, dağınık parıltı)
    d.turkeyAurora = d.shieldStrength < 0.05 ? 'none' : auroraVisibility(d.istanbulMagLat, d.auroraLat);

    // --- Radyasyon kuşakları
    d.plasmapauseL = plasmapauseL(d.kpMax24);
    if (h > 0) {
      const falling = d.dst < -50 && s.storms.some((st) => st.phase === 'sheath' || st.phase === 'cloud');
      this._outerTarget = falling ? 0.35 : 1 + 2.5 * clamp(-this._dstMinRecent / 300, 0, 2);
      const tau = falling ? 3 : 14;
      d.belts.outer += (this._outerTarget - d.belts.outer) * (1 - Math.exp(-h / tau));
      const slotTarget = clamp((-this._dstMinRecent - 280) / 300, 0, 1);
      d.belts.slot += (slotTarget - d.belts.slot) * (1 - Math.exp(-h / (slotTarget > d.belts.slot ? 4 : 100)));
      d.belts.inner = 1 + 0.25 * clamp(Math.log10(Math.max(sep, 1)) / 5, 0, 1);
    }

    // --- Etkiler
    d.impacts = impactEstimates({
      kp: d.kp, dst: d.dst, sepPfu: sep, gcrRelative: d.gcrRelative,
      fieldStrength: Math.min(d.shieldStrength, 1), r0: d.r0,
    });
    const loss = 1 - Math.min(1, d.shieldStrength);
    d.atmosphericEscape = 1.5 * (1 + 0.2 * s.sw.pdyn) * (1 + 6 * loss * loss);

    // --- Olaylar ve uyarılar
    this._checkAlerts();

    // --- Geçmiş örnekleme
    if (now >= this._nextSample) {
      const H = s.history;
      H.t.push(now);
      H.kp.push(d.kp);
      H.dst.push(d.dst);
      H.bz.push(s.sw.bz);
      H.speed.push(s.sw.speed);
      H.density.push(s.sw.density);
      H.r0.push(d.r0);
      H.sep.push(sep);
      H.gcr.push(d.gcrRelative);
      const max = Math.ceil(HISTORY_HOURS / HISTORY_STEP_HOURS);
      if (H.t.length > max) for (const k of Object.keys(H)) H[k].splice(0, H[k].length - max);
      this._nextSample = now + HISTORY_STEP_HOURS;
    }
  }

  _checkAlerts() {
    const s = this.state;
    const d = s.derived;
    const F = this._flags;

    for (const st of s.storms) {
      if (st._arrivePending) {
        st._arrivePending = false;
        this.events.emit('storm:arrived', { storm: st });
        // Şok varış anında rüzgâr henüz yükselmedi (0,3 sa'lık rampa): metni anlık değil, rampa sonrası kılıf değerlerinden kur
        const w = stormSolarWindAt(st, 0.3, s.params.solarWind);
        const r0Sheath = shueParams(dynamicPressure(w.density, w.speed), w.bz, d.shieldStrength).r0;
        this.alert('danger', t('alert.shock', { v: nint(w.speed), r0: nf(r0Sheath, 1) }));
      }
      if (!st.sepOnsetEmitted && stormSepAt(st, s.time.simHours - st.launchSim) >= 10) {
        st.sepOnsetEmitted = true;
        this.events.emit('sep:onset', { storm: st, sScale: st.sScale });
      }
    }

    if (d.s > F.sep) {
      this.alert(d.s >= 3 ? 'danger' : 'warn', t('alert.sep', { n: d.s, label: SCALE_LABELS.S[d.s] }), 'sep');
      F.sep = d.s;
    } else if (d.s < F.sep) {
      F.sep = d.s;
    }

    if (d.g > F.g) {
      this.alert(d.g >= 4 ? 'danger' : 'warn', t('alert.g', { n: d.g, label: SCALE_LABELS.G[d.g], kp: nf(d.kp, 1) }), 'g');
      F.g = d.g;
    } else if (d.g < F.g - 1 || (d.g === 0 && F.g > 0)) {
      F.g = d.g;
    }

    if (d.impacts.geoExposed && !F.geo) {
      F.geo = true;
      this.alert('danger', t('alert.geo', { r0: nf(d.r0, 1) }));
    } else if (!d.impacts.geoExposed && d.r0 > 7.2) {
      F.geo = false;
    }

    // Oval İstanbul'a ulaşsa da gündüzse görülemez: uyarı yalnızca Güneş ufkun 12° altındayken verilir
    const visible = d.turkeyAurora !== 'none';
    if (visible && d.turkeyDark && !F.turkey) {
      F.turkey = true;
      this.alert('warn', t('alert.turkeyAurora', { lat: nf(d.auroraLat, 1), status: t(`aurora.status.${d.turkeyAurora}`) }));
    } else if (!visible && d.auroraLat > d.istanbulMagLat + 12) {
      F.turkey = false;
    }

    // Eşikler ve sınıf adları indices.js DST_THRESHOLDS ile ortaktır (HUD ve bilgi tablosuyla aynı)
    const dstLevels = [
      ['dst100', DST_THRESHOLDS.intense, 'warn'],
      ['dst250', DST_THRESHOLDS.superstorm, 'danger'],
      ['dst600', -600, 'danger'],
      ['dst850', DST_THRESHOLDS.carrington, 'danger'],
    ];
    for (const [key, thr, level] of dstLevels) {
      if (d.dst < thr && !F[key]) {
        F[key] = true;
        this.alert(level, t(`alert.${key}`), 'dst');
      } else if (d.dst > thr * 0.5) {
        F[key] = false;
      }
    }

    if (d.shieldStrength < 0.05 && !F.shieldOff) {
      F.shieldOff = true;
      this.alert('danger', t('alert.shieldOff'));
    } else if (d.shieldStrength > 0.2) {
      F.shieldOff = false;
    }
  }

  _computeFrame() {
    const s = this.state;
    const fr = s.frame;
    const date = simDate(s);
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    const doy = (date.getTime() - yearStart) / 86400e3 + 1;
    const ut = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    fr.dayOfYear = doy;
    fr.utHours = ut;

    // Dönme ekseni: Haziran gündönümünde (gün ~172) kuzey kutbu Güneş'e (+X) eğik
    const eps = EARTH.axialTiltDeg * DEG;
    const phi = (2 * Math.PI * (doy - 172)) / 365.25;
    fr.spinAxis.set(Math.sin(eps) * Math.cos(phi), Math.cos(eps), Math.sin(eps) * Math.sin(phi)).normalize();
    this._qTilt.setFromUnitVectors(_Y, fr.spinAxis);
    // UT 12'de Greenwich (+X yerel) öğle → Güneş'e bakar
    fr.earthRotationRad = (2 * Math.PI * (ut - 12)) / 24;
    this._qSpin.setFromAxisAngle(_Y, fr.earthRotationRad);
    fr.earthQuaternion.copy(this._qTilt).multiply(this._qSpin);

    // Dipol ekseni
    const local = this._tmp.copy(s.params.realisticTilt ? this._dipoleLocal : _Y);
    if (s.reversal.active) {
      // Sanal jeomanyetik kutup bir meridyen boyunca güneye gezinir
      const p = s.reversal.progress;
      const swing = Math.PI * p;
      const tiltAxis = new THREE.Vector3(0, 0, 1).cross(local).lengthSq() > 1e-6
        ? new THREE.Vector3().crossVectors(local, new THREE.Vector3(0, 0, 1)).normalize()
        : new THREE.Vector3(1, 0, 0);
      this._qRev.setFromAxisAngle(tiltAxis, swing + 0.35 * Math.sin(p * 9.0) * Math.sin(Math.PI * p));
      local.applyQuaternion(this._qRev);
      // p > 0.5'te eksen güney yarımküreye geçer: eksen ters çevrilip moment işareti değişir (bkz. _substep)
      if (p >= 0.5) local.negate();
    }
    fr.dipoleAxis.copy(local).applyQuaternion(fr.earthQuaternion).normalize();
    s.derived.dipoleTiltDeg = Math.asin(clamp(fr.dipoleAxis.x, -1, 1)) / DEG;

    // İstanbul'un anlık manyetik enlemi (aurora görünürlüğü): ovaller gibi canlı dipol ekseninden (tersinme dahil);
    // mutlak değer: tersinmede eksen güneye geçince işaret anlamsız. _substep bir önceki karenin değerini okur.
    localToWorld(this._istLocal, fr, this._istWorld);
    s.derived.istanbulMagLat = Math.abs(magneticLatitudeDeg(this._istWorld, fr));
    // Aurora yalnızca karanlıkta görülür: Güneş yönü +X, yerel "yukarı" = konum vektörü
    const elev = Math.asin(clamp(this._istWorld.x / (this._istWorld.length() || 1), -1, 1)) / DEG;
    s.derived.istanbulSunElevDeg = elev;
    s.derived.turkeyDark = elev < -12;
  }
}
