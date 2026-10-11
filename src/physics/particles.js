// Yüklü parçacık yörüngeleri: yol uzunluğuna göre parametrize Boris itici.
//
// Statik manyetik alanda parçacığın hız büyüklüğü sabittir; yalnızca yönü döner:
//   dv̂/ds = (charge / (K·R)) · v̂ × b(r)
// burada s yol uzunluğu [Re], R sertlik [GV], b normalize alan, K = DIPOLE.gyroRePerGV.
// Bu sayede 1 GV'luk bir proton yüzey ekvatorunda ~0.017 Re yarıçaplı sarmal çizer.

import { DIPOLE } from '../core/constants.js';
import { magneticField } from './dipole.js';

const _b = [0, 0, 0];
// advanceParticle sonucu her çağrıda yeniden kullanılır (çağıran hemen okumalı, saklamamalı)
const _result = { hit: false, escaped: false, travelled: 0 };
function result(hit, escaped, travelled) {
  _result.hit = hit;
  _result.escaped = escaped;
  _result.travelled = travelled;
  return _result;
}

/**
 * Tek Boris adımı (yerinde günceller). pos, dir: [x,y,z] dizileri (dir birim vektör).
 * ds: adım uzunluğu [Re]. Dönen değer: yerel |b| (adaptif adım için).
 */
export function borisStep(pos, dir, ds, rigidityGV, chargeSign, model) {
  // Yarım adım konum (leapfrog)
  const hx = pos[0] + 0.5 * ds * dir[0];
  const hy = pos[1] + 0.5 * ds * dir[1];
  const hz = pos[2] + 0.5 * ds * dir[2];
  magneticField(_b, hx, hy, hz, model);
  const bmag = Math.hypot(_b[0], _b[1], _b[2]);
  const f = (chargeSign * ds) / (2 * DIPOLE.gyroRePerGV * Math.max(rigidityGV, 1e-4));
  const tx = _b[0] * f, ty = _b[1] * f, tz = _b[2] * f;
  const t2 = tx * tx + ty * ty + tz * tz;
  // v' = v + v × t
  const vpx = dir[0] + (dir[1] * tz - dir[2] * ty);
  const vpy = dir[1] + (dir[2] * tx - dir[0] * tz);
  const vpz = dir[2] + (dir[0] * ty - dir[1] * tx);
  const s = 2 / (1 + t2);
  // v+ = v + v' × s·t
  dir[0] += s * (vpy * tz - vpz * ty);
  dir[1] += s * (vpz * tx - vpx * tz);
  dir[2] += s * (vpx * ty - vpy * tx);
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  dir[0] /= n; dir[1] /= n; dir[2] /= n;
  pos[0] = hx + 0.5 * ds * dir[0];
  pos[1] = hy + 0.5 * ds * dir[1];
  pos[2] = hz + 0.5 * ds * dir[2];
  return bmag;
}

/** Yerel jirasyon yarıçapına göre güvenli adım uzunluğu [Re] */
export function adaptiveStep(rigidityGV, bmag, { maxStep = 0.25, minStep = 0.002, fraction = 0.15 } = {}) {
  if (bmag < 1e-9) return maxStep;
  const rg = (DIPOLE.gyroRePerGV * rigidityGV) / bmag;
  return Math.max(minStep, Math.min(maxStep, rg * fraction));
}

/**
 * Bir parçacığı toplam `distance` yol uzunluğu kadar ilerletir (çoklu alt adım).
 * Dünya'ya çarparsa ({hit:true}) ya da dışarı kaçarsa ({escaped:true}) erken durur.
 * Dönen nesne paylaşılır: bir sonraki çağrıda üzerine yazılır.
 * state: { pos:[3], dir:[3], rigidity, charge, lastB? } — yerinde güncellenir.
 */
export function advanceParticle(p, distance, model, { rHit = 1.02, rEscape = 70, maxSubsteps = 400 } = {}) {
  let travelled = 0;
  let bmag = p.lastB ?? 0;
  for (let i = 0; i < maxSubsteps && travelled < distance; i++) {
    const ds = Math.min(distance - travelled, adaptiveStep(p.rigidity, bmag));
    bmag = borisStep(p.pos, p.dir, ds, p.rigidity, p.charge, model);
    travelled += ds;
    const r = Math.hypot(p.pos[0], p.pos[1], p.pos[2]);
    if (r < rHit) {
      p.lastB = bmag;
      return result(true, false, travelled);
    }
    if (r > rEscape) {
      p.lastB = bmag;
      return result(false, true, travelled);
    }
  }
  p.lastB = bmag;
  return result(false, false, travelled);
}
