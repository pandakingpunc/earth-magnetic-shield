// Manyetopoz (Shue ve ark. 1998) ve yay şoku modelleri ile manyetokılıf akışı.
// Tüm uzunluklar Re cinsindendir. θ: Güneş-Dünya hattından (+X) ölçülen açı.

const PROTON_MASS_KG = 1.6726e-27;
const MU0 = 4e-7 * Math.PI;
const KB = 1.380649e-23;

/** Güneş rüzgârı dinamik basıncı [nPa]. n [cm^-3], v [km/s] */
export function dynamicPressure(n, v) {
  // 1.6726e-6 * n * v^2 (protonlar için, Shue'nun kullandığı tanım)
  return 1.6726e-6 * n * v * v;
}

/**
 * Shue ve ark. (1998) manyetopoz parametreleri.
 * fieldStrength: Dünya dipol momentinin bugünküne oranı (0..2). Basınç dengesinden r0 ∝ M^(1/3).
 * Alan çok zayıfsa iyonosfer engel olur (Venüs/Mars benzeri indüklenmiş manyetosfer) → r0 tabanı.
 */
export function shueParams(pdyn, bz, fieldStrength = 1) {
  const p = Math.max(pdyn, 0.01);
  let r0 = (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * Math.pow(p, -1 / 6.6);
  const alpha = (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(p));
  const f = Math.max(0, fieldStrength);
  r0 *= Math.cbrt(f);
  const IONOSPHERE_OBSTACLE = 1.08;
  r0 = Math.max(IONOSPHERE_OBSTACLE, r0);
  return { r0, alpha: Math.max(0.35, Math.min(0.95, alpha)) };
}

/** Manyetopoz yarıçapı r(θ) = r0 (2/(1+cosθ))^α. θ π'ye yaklaştığında maxR ile kırpılır. */
export function magnetopauseRadius(theta, r0, alpha, maxR = 400) {
  const c = 1 + Math.cos(theta);
  if (c <= 1e-6) return maxR;
  return Math.min(maxR, r0 * Math.pow(2 / c, alpha));
}

/** Nokta (x,y,z) manyetopozun içinde mi? (eksenel simetrik Shue yüzeyi, +X Güneş) */
export function insideMagnetopause(x, y, z, r0, alpha) {
  const r = Math.hypot(x, y, z);
  if (r < 1e-9) return true;
  const theta = Math.acos(Math.max(-1, Math.min(1, x / r)));
  return r < magnetopauseRadius(theta, r0, alpha);
}

/** Hızlı manyetosonik Mach sayısı. v km/s, n cm^-3, bt nT, T K */
export function magnetosonicMach(v, n, bt, temperature = 1e5) {
  const rho = Math.max(n, 0.05) * 1e6 * PROTON_MASS_KG;
  const vA = (Math.max(bt, 0.1) * 1e-9) / Math.sqrt(MU0 * rho) / 1000; // km/s
  const cs = Math.sqrt((5 / 3) * 2 * KB * temperature / PROTON_MASS_KG) / 1000; // elektron+iyon basıncı
  const vms = Math.sqrt(vA * vA + cs * cs);
  return v / vms;
}

/**
 * Yay şoku burnu uzaklığı (Spreiter 1966 / Farris & Russell 1994 yaklaşımı):
 * Δ = 1.1 · r0 · ρ1/ρ2,  ρ2/ρ1 = (γ+1)M² / ((γ-1)M² + 2)
 */
export function bowShockStandoff(r0, mach) {
  const g = 5 / 3;
  const M2 = Math.max(mach, 1.05) ** 2;
  const compression = ((g + 1) * M2) / ((g - 1) * M2 + 2);
  return r0 * (1 + 1.1 / compression);
}

/**
 * Yay şoku yüzeyi: konik kesit r(θ) = L/(1+ε cosθ), L = Rbs(1+ε). ε > 1 → hiperbol (Farris ve ark. 1991
 * tipik ε ≈ 1.02–1.1): kuyrukta açılır ve en aşırı fırtınada bile Shue manyetopozunu içine alır.
 */
export const BOW_SHOCK_ECCENTRICITY = 1.05;
export function bowShockRadius(theta, rbs, eps = BOW_SHOCK_ECCENTRICITY, maxR = 400) {
  const L = rbs * (1 + eps);
  const d = 1 + eps * Math.cos(theta);
  if (d <= L / maxR) return maxR;
  return Math.min(maxR, L / d);
}

export function insideBowShock(x, y, z, rbs, eps = BOW_SHOCK_ECCENTRICITY) {
  const r = Math.hypot(x, y, z);
  if (r < 1e-9) return true;
  const theta = Math.acos(Math.max(-1, Math.min(1, x / r)));
  return r < bowShockRadius(theta, rbs, eps);
}

/**
 * Manyetokılıf akışı: üniform akış (−X yönünde, hız U) + orijinde kaynak = 3B Rankine yarı-cismi.
 * Cismin yüzeyi r = d·sqrt(2/(1+cosθ)), yani α = 0.5 olan bir Shue yüzeyidir; d = durma noktası.
 * Böylece şoktan geçen parçacıklar manyetopozun etrafından doğal biçimde akar.
 * out: [vx,vy,vz] dizisi (Re/s, U ile aynı birimde)
 */
export function sheathVelocity(out, x, y, z, d, U) {
  const r2 = x * x + y * y + z * z;
  const r = Math.sqrt(r2) || 1e-6;
  const k = (U * d * d) / (r2 * r);
  out[0] = -U + k * x;
  out[1] = k * y;
  out[2] = k * z;
  return out;
}
