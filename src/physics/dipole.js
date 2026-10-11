// Dünya'nın manyetik alan modeli (normalize birimler: yüzey ekvator dipol alanı = 1).
//
// Alan = dipol (moment ölçeği M, eksen a) + eksenel simetrik kuadrupol (Q) — kuadrupol yalnızca
// kutup tersinmesi sırasında belirgindir. Manyetopozun dışında alan IMF'ye düşer (çok küçük).

import { DIPOLE } from '../core/constants.js';
import { insideMagnetopause } from './magnetopause.js';
import { t } from '../i18n/index.js';

const NT_TO_NORMALIZED = 1 / (DIPOLE.surfaceEquatorTesla * 1e9); // 1 nT → normalize

/**
 * Dipol alanı. axis: [ax,ay,az] jeomanyetik kuzey kutbu (birim). M: işaretli moment (+1 bugünkü).
 * Dünya'nın dipol momenti coğrafi güneye bakar: m̂ = −axis. Ekvatorda B kuzeyi gösterir.
 */
export function dipoleField(out, x, y, z, axis, M = 1) {
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2) || 1e-9;
  const inv_r5 = 1 / (r2 * r2 * r);
  const mx = -axis[0] * M;
  const my = -axis[1] * M;
  const mz = -axis[2] * M;
  const mdotr = mx * x + my * y + mz * z;
  // B = (3 (m·r) r − m r²) / r^5
  out[0] = (3 * mdotr * x - mx * r2) * inv_r5;
  out[1] = (3 * mdotr * y - my * r2) * inv_r5;
  out[2] = (3 * mdotr * z - mz * r2) * inv_r5;
  return out;
}

/** Eksenel simetrik kuadrupol: V = Q·(3(a·r)² − r²)/(2 r^5), B = −∇V */
export function quadrupoleField(out, x, y, z, axis, Q) {
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2) || 1e-9;
  const r5 = r2 * r2 * r;
  const r7 = r5 * r2;
  const ar = axis[0] * x + axis[1] * y + axis[2] * z;
  const s = 3 * ar * ar - r2;
  const h = Q / 2;
  // ∇V = h[(6(a·r)a − 2r)/r^5 − 5 s r / r^7]
  out[0] = -h * ((6 * ar * axis[0] - 2 * x) / r5 - (5 * s * x) / r7);
  out[1] = -h * ((6 * ar * axis[1] - 2 * y) / r5 - (5 * s * y) / r7);
  out[2] = -h * ((6 * ar * axis[2] - 2 * z) / r5 - (5 * s * z) / r7);
  return out;
}

const _tmp = [0, 0, 0];

/**
 * Tam alan modeli. model: state'ten türetilen sade nesne (bkz. fieldModelFromState):
 *   { axis:[3], M, Q, r0, alpha, imf:[3] (normalize), clipToMagnetopause:boolean }
 */
export function magneticField(out, x, y, z, model) {
  if (model.clipToMagnetopause && !insideMagnetopause(x, y, z, model.r0, model.alpha)) {
    out[0] = model.imf[0];
    out[1] = model.imf[1];
    out[2] = model.imf[2];
    return out;
  }
  dipoleField(out, x, y, z, model.axis, model.M);
  if (model.Q) {
    quadrupoleField(_tmp, x, y, z, model.axis, model.Q);
    out[0] += _tmp[0];
    out[1] += _tmp[1];
    out[2] += _tmp[2];
  }
  return out;
}

/** SimState'ten alan modeli üretir (her karede bir kez çağrılabilir; nesneyi yeniden kullanır). */
export function fieldModelFromState(state, model = { axis: [0, 1, 0], M: 1, Q: 0, r0: 10, alpha: 0.58, imf: [0, 0, 0], clipToMagnetopause: true }) {
  const a = state.frame.dipoleAxis;
  model.axis[0] = a.x;
  model.axis[1] = a.y;
  model.axis[2] = a.z;
  model.M = state.derived.dipoleMoment;
  model.Q = state.derived.quadrupole;
  model.r0 = state.derived.r0;
  model.alpha = state.derived.alpha;
  // IMF: GSM By/Bz → sahne: By (dusk) sahne −Z, Bz sahne +Y. Bx'i ihmal ediyoruz.
  model.imf[0] = 0;
  model.imf[1] = state.sw.bz * NT_TO_NORMALIZED;
  model.imf[2] = -state.sw.by * NT_TO_NORMALIZED;
  return model;
}

/** Dipol alan çizgisi noktası (dipol çerçevesinde): r = L cos²λ → [ρ, z] */
export function dipoleLinePoint(L, latRad) {
  const c = Math.cos(latRad);
  const r = L * c * c;
  return [r * c, r * Math.sin(latRad)];
}

/** L kabuğunun yüzeye değdiği değişmez enlem (radyan): cos²Λ = 1/L */
export function invariantLatitude(L) {
  return Math.acos(Math.sqrt(1 / Math.max(L, 1)));
}

/** Dikey Störmer kesme sertliği [GV] (manyetik enlem derece, yarıçap Re, moment ölçeği) */
export function stormerCutoffGV(magLatDeg, rRe = 1, M = 1) {
  const c = Math.cos((magLatDeg * Math.PI) / 180);
  return (DIPOLE.stormerVerticalGV * Math.abs(M) * c ** 4) / (rRe * rRe);
}

/** Bir sertliğin dikey olarak ulaşabildiği en düşük manyetik enlem (derece) */
export function minLatitudeForRigidity(rigidityGV, M = 1) {
  const ratio = rigidityGV / (DIPOLE.stormerVerticalGV * Math.max(Math.abs(M), 1e-6));
  if (ratio >= 1) return 0;
  return (Math.acos(Math.pow(ratio, 0.25)) * 180) / Math.PI;
}

const PROTON_REST_GEV = 0.938272;
const ELECTRON_REST_GEV = 0.000511;

/** Sertlik (GV) → kinetik enerji (GeV). A/Z: kütle numarası/yük (proton 1, alfa 2), restGeV parçacık başına */
export function rigidityToKineticGeV(R, { charge = 1, restGeV = PROTON_REST_GEV } = {}) {
  const pc = R * Math.abs(charge); // GeV
  return Math.sqrt(pc * pc + restGeV * restGeV) - restGeV;
}

export function kineticGeVToRigidity(E, { charge = 1, restGeV = PROTON_REST_GEV } = {}) {
  const pc = Math.sqrt(E * (E + 2 * restGeV));
  return pc / Math.abs(charge);
}

// label tembel özelliktir: etkin dile göre her okumada t() ile çözülür
export const PARTICLES = {
  proton: {
    charge: 1, restGeV: PROTON_REST_GEV,
    get label() {
      return t('particle.proton');
    },
  },
  electron: {
    charge: -1, restGeV: ELECTRON_REST_GEV,
    get label() {
      return t('particle.electron');
    },
  },
  alpha: {
    charge: 2, restGeV: 3.727379,
    get label() {
      return t('particle.alpha');
    },
  },
};

/**
 * Genel alan çizgisi izleyici (RK4, B yönünde birim adım). Başlangıç noktasından hem ileri hem geri
 * izlemek için dir = ±1. Durma: r < rMin, r > rMax, maxSteps, veya model manyetopoz dışında (clip açıksa).
 * Dönen: düz sayı dizisi [x0,y0,z0,x1,...]
 */
export function traceFieldLine(start, model, { dir = 1, step = 0.05, maxSteps = 600, rMin = 1, rMax = 60 } = {}) {
  const pts = [start[0], start[1], start[2]];
  let x = start[0], y = start[1], z = start[2];
  const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];
  const unit = (v) => {
    const m = Math.hypot(v[0], v[1], v[2]) || 1e-12;
    v[0] /= m; v[1] /= m; v[2] /= m;
    return v;
  };
  for (let i = 0; i < maxSteps; i++) {
    const r = Math.hypot(x, y, z);
    // Yakın bölgede küçük, uzakta büyük adımlar
    const h = dir * step * Math.max(0.5, Math.min(r, 6));
    unit(magneticField(k1, x, y, z, model));
    unit(magneticField(k2, x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], z + 0.5 * h * k1[2], model));
    unit(magneticField(k3, x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], z + 0.5 * h * k2[2], model));
    unit(magneticField(k4, x + h * k3[0], y + h * k3[1], z + h * k3[2], model));
    x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    z += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    pts.push(x, y, z);
    const rn = Math.hypot(x, y, z);
    if (rn < rMin || rn > rMax) break;
    if (model.clipToMagnetopause && !insideMagnetopause(x, y, z, model.r0, model.alpha)) break;
  }
  return pts;
}
