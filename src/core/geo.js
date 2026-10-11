// Koordinat yardımcıları. Tüm modüller aynı dönüşümleri kullanmalı.
//
// "Yerel" (Dünya gövdesine sabit) koordinatlar Three.js SphereGeometry + eşdikdörtgen doku
// yerleşimiyle uyumludur: boylam 0 → +X, boylam -90 (Amerika) → +Z, boylam +90 → -Z,
// kuzey kutbu → +Y. Dünya mesh'i state.frame.earthQuaternion ile döndürülünce dünya
// koordinatlarına geçilir.

import * as THREE from 'three';

export const DEG = Math.PI / 180;

/** Coğrafi enlem/boylamı (derece) Dünya-yerel birim vektöre çevirir (r ile ölçekler). */
export function latLonToLocal(latDeg, lonDeg, r = 1, out = new THREE.Vector3()) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return out.set(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
}

/** Yerel vektörü coğrafi enlem/boylama çevirir. */
export function localToLatLon(v) {
  const r = v.length() || 1;
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)) / DEG;
  const lon = Math.atan2(-v.z, v.x) / DEG;
  return { lat, lon };
}

/** Dünya-yerel noktayı sahne (dünya) koordinatlarına dönüştürür. */
export function localToWorld(local, frame, out = new THREE.Vector3()) {
  return out.copy(local).applyQuaternion(frame.earthQuaternion);
}

/** Sahne koordinatındaki bir noktanın manyetik enlemi (derece). frame.dipoleAxis kuzey jeomanyetik kutbu gösterir. */
export function magneticLatitudeDeg(worldPos, frame) {
  const r = worldPos.length() || 1;
  return Math.asin(THREE.MathUtils.clamp(worldPos.dot(frame.dipoleAxis) / r, -1, 1)) / DEG;
}

/**
 * Manyetik çerçeve tabanı: zM = dipol ekseni (kuzey), xM = Güneş yönünün dipole dik izdüşümü
 * (manyetik öğle), yM = zM × xM (akşam/dusk tarafı yaklaşık).
 * Aurora ovalleri, kuşaklar vb. için kullanılır.
 */
export function magneticBasis(frame, out = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() }) {
  out.z.copy(frame.dipoleAxis).normalize();
  out.x.set(1, 0, 0).addScaledVector(out.z, -out.z.x);
  if (out.x.lengthSq() < 1e-8) out.x.set(0, 0, 1);
  out.x.normalize();
  out.y.crossVectors(out.z, out.x).normalize();
  return out;
}

/**
 * Manyetik koordinatlardan sahne konumuna: mlatDeg manyetik enlem, mltHours manyetik yerel saat
 * (12 = öğle/Güneş tarafı, 0/24 = gece yarısı), r yarıçap (Re).
 */
export function magneticToWorld(mlatDeg, mltHours, r, basis, out = new THREE.Vector3()) {
  const lat = mlatDeg * DEG;
  const psi = ((mltHours - 12) / 24) * Math.PI * 2; // 0 → öğle (+xM)
  const c = Math.cos(lat);
  return out
    .copy(basis.x)
    .multiplyScalar(c * Math.cos(psi) * r)
    .addScaledVector(basis.y, c * Math.sin(psi) * r)
    .addScaledVector(basis.z, Math.sin(lat) * r);
}

/** Basit doğrusal enterpolasyon ve yardımcılar */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
