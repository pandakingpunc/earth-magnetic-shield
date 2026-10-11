// Manyetosfer katmanı: manyetopoz (Shue 1998), yay şoku, manyetik alan çizgileri ve plazma tabakası.
//
// Koordinatlar: +X Güneş, +Y kuzey, +Z şafak. Alan çizgileri "şerit" (kameraya dönük ince dörtgen)
// olarak çizilir; her nokta için ark uzunluğu (aU) bulunur ve parlak darbeler B yönünde akar.
//  - Kapalı çizgiler: dipol çizgileri (L kabukları × manyetik boylamlar); gündüz tarafı manyetopoza
//    yumuşakça sıkıştırılır, gece tarafında yüksek L çizgileri kuyruğa doğru uzatılır.
//  - Açık çizgiler: kutup başlığından çıkıp kuyruk lobları boyunca x ≈ −80'e uzanır.
//  - Çoklu kutup (tersinme): traceFieldLine ile sayısal izlenen yakın-Dünya çizgileri.
//  - Kalkan çökünce: Venüs/Mars benzeri sarılmış (drape) IMF çizgileri.

import * as THREE from 'three';
import { COLORS } from '../core/constants.js';
import { magneticBasis, magneticToWorld, clamp, smoothstep, DEG } from '../core/geo.js';
import { magnetopauseRadius, bowShockRadius, BOW_SHOCK_ECCENTRICITY } from '../physics/magnetopause.js';
import { fieldModelFromState, traceFieldLine } from '../physics/dipole.js';
import { makeLabel, setLabelVariant } from './labels.js';
import { t } from '../i18n/index.js';
import { nf as fmtNum } from '../core/format.js';

// ---------------------------------------------------------------- sabitler
const TAIL_END_X = -80; // manyetopoz kuyruk kesimi
const BOW_END_X = -45; // yay şoku kesimi
const MP_ROWS = 110;
const MP_COLS = 64;
const BS_ROWS = 72;
const BS_COLS = 48;

const N_LON = 14; // kapalı çizgi manyetik boylam sayısı
const RING_T = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 1]; // log-L içindeki konumlar
const N_RING = RING_T.length;
const N_P = 54; // kapalı çizgi başına nokta

const OPEN_RINGS = [[0.96, 12, 0], [0.7, 10, 0.5], [0.45, 6, 0], [0.2, 3, 0.5]]; // [ξ, azimut sayısı, ofset]
const OPEN_X0 = 6; // Bezier → kuyruk geçiş noktası (−x)
const N_B = 30; // Bezier nokta sayısı (köşe görünmesin diye sık)
const N_T = 18; // kuyruk nokta sayısı
const OPEN_DX = (-TAIL_END_X - OPEN_X0) / N_T;
const OPEN_PTS = N_B + N_T;

const MULTI_MLT = [0, 4, 8, 12, 16, 20];
// başlangıç noktaları [manyetik enlem, yarıçap]: yüzeyde alan teğet olabildiği için biraz yukarıdan başlanır
const MULTI_START = [[-70, 3.2], [-48, 2.2], [-22, 1.5], [22, 1.5], [48, 2.2], [70, 3.2]];
const MULTI_N = MULTI_MLT.length * MULTI_START.length;
const MULTI_PTS = 80;
const MULTI_RMAX = 6;

const N_DRAPE = 8;
const DRAPE_PTS = 41;

const SHEET_X0 = -7;
const SHEET_X1 = -62;
const SHEET_NX = 32;
const SHEET_NY = 12;
const SHEET_LAYERS = 3;

const fin = (v, d) => (Number.isFinite(v) ? v : d);
const RIBBON_WIDTH = [1.8, 1.7, 2.0, 2.2]; // piksel: kapalı, açık, çoklu kutup, sarılmış

// ---------------------------------------------------------------- statik tablolar
const COS_P = new Float64Array(N_LON);
const SIN_P = new Float64Array(N_LON);
const NIGHT_W = new Float64Array(N_LON);
for (let i = 0; i < N_LON; i++) {
  const p = (i / N_LON) * Math.PI * 2;
  COS_P[i] = Math.cos(p);
  SIN_P[i] = Math.sin(p);
  NIGHT_W[i] = smoothstep(0.05, -0.75, COS_P[i]); // gece tarafı ağırlığı
}

const OPEN_N = OPEN_RINGS.reduce((a, r) => a + r[1], 0) * 2;
const OP_S = new Float64Array(OPEN_N);
const OP_XI = new Float64Array(OPEN_N);
const OP_COSP = new Float64Array(OPEN_N);
const OP_SINP = new Float64Array(OPEN_N);
const OP_DAYW = new Float64Array(OPEN_N);
{
  let n = 0;
  for (const s of [1, -1]) {
    for (const [xi, cnt, off] of OPEN_RINGS) {
      for (let i = 0; i < cnt; i++) {
        const p = ((i + off) / cnt) * Math.PI * 2;
        OP_S[n] = s;
        OP_XI[n] = xi;
        OP_COSP[n] = Math.cos(p);
        OP_SINP[n] = Math.sin(p);
        OP_DAYW[n] = smoothstep(-0.3, 0.9, Math.cos(p));
        n++;
      }
    }
  }
}

// Bezier ağırlıkları: yüzeyden çıkışta keskin dönüş olduğu için başlangıca yakın daha sık örneklenir
const BZ = new Float64Array(N_B * 4);
for (let bi = 0; bi < N_B; bi++) {
  const t = Math.pow(bi / (N_B - 1), 1.3);
  const u = 1 - t;
  BZ[bi * 4] = u * u * u;
  BZ[bi * 4 + 1] = 3 * u * u * t;
  BZ[bi * 4 + 2] = 3 * u * t * t;
  BZ[bi * 4 + 3] = t * t * t;
}

const hash1 = (n) => {
  const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------- GLSL
const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float g = hash13(i + vec3(1.0, 0.0, 1.0));
  float h = hash13(i + vec3(0.0, 1.0, 1.0));
  float k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
`;

const SHELL_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vWorld = wp.xyz;
  vViewPos = mv.xyz;
  vNormalV = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}
`;

const MP_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uCompress;
uniform float uRecon;
uniform float uFlash;
uniform float uFade;
varying vec3 vWorld;
varying vec3 vNormalV;
varying vec3 vViewPos;
${GLSL_NOISE}
void main() {
  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 4.0);

  // tersine akan çizgiler (güneş rüzgârı sürüklemesi)
  vec3 sp = vec3(vWorld.y * 1.15, vWorld.z * 1.15, (vWorld.x + uTime * 6.0) * 0.05);
  float n = vnoise(sp);
  float streak = smoothstep(0.55, 0.86, n);
  float tailW = 1.0 - smoothstep(-14.0, 6.0, vWorld.x);

  // burun ve gündüz yeniden birleşme noktası/bandı
  float rr = max(length(vWorld), 1e-4);
  float cosT = vWorld.x / rr;
  float noseW = smoothstep(0.62, 1.0, cosT);
  float band = exp(-(vWorld.y * vWorld.y) / 6.0);
  float spot = smoothstep(0.8, 1.0, cosT) * (0.45 + 0.55 * band);
  float pulse = 0.6 + 0.4 * sin(uTime * 4.5 + n * 7.0);
  float recon = uRecon * spot * pulse;

  vec3 base = mix(uColor, uHot, uCompress);
  float veil = (0.006 + 0.035 * streak * (0.25 + 0.75 * tailW) + 0.03 * noseW) * (1.0 - 0.55 * uCompress);
  float a = veil + 0.17 * fres;
  a = a * (1.0 + uFlash * 0.6) * uFade;
  vec3 col = base * (1.0 + 0.45 * uFlash);
  vec3 rcol = mix(vec3(1.0, 0.92, 0.8), uHot, 0.35);
  float endFade = smoothstep(-80.0, -56.0, vWorld.x);
  vec3 outc = col + rcol * recon * 1.1;
  float outa = clamp(a + recon * 0.45 * uFade, 0.0, 1.0) * endFade;
  gl_FragColor = vec4(outc, outa);
}
`;

const BS_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uFade;
uniform float uFlash;
varying vec3 vWorld;
varying vec3 vNormalV;
varying vec3 vViewPos;
${GLSL_NOISE}
void main() {
  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float n = vnoise(vWorld * 0.42 + vec3(uTime * 0.7, uTime * 0.35, -uTime * 0.5));
  float n2 = vnoise(vWorld * 1.3 + vec3(-uTime * 1.1, uTime * 0.6, 0.0));
  float shim = 0.7 + 0.55 * n + 0.25 * n2;
  float rr = max(length(vWorld), 1e-4);
  float noseW = smoothstep(0.3, 1.0, vWorld.x / rr);
  float a = (0.001 + 0.032 * fres) * shim + noseW * 0.012 * (0.6 + 0.8 * n);
  a = a * uFade * (1.0 + 0.5 * uFlash);
  vec3 col = uColor * (1.0 + 0.7 * noseW + 0.4 * uFlash);
  float endFade = smoothstep(-46.0, -26.0, vWorld.x);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * endFade);
}
`;

const RIBBON_VERT = /* glsl */ `
uniform vec2 uRes;
uniform float uWidth;
uniform float uNearFade;
attribute vec3 aTan;
attribute float aU;
attribute float aSide;
attribute vec3 aInfo;
attribute float aA;
varying float vSide;
varying float vU;
varying float vSeed;
varying float vDir;
varying float vBright;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 tv = mat3(modelViewMatrix) * aTan;
  float zq = max(-mv.z, 0.05);
  vec2 dn = vec2(
    projectionMatrix[0][0] * (tv.x / zq + mv.x * tv.z / (zq * zq)),
    projectionMatrix[1][1] * (tv.y / zq + mv.y * tv.z / (zq * zq))
  );
  vec2 dp = dn * uRes * 0.5;
  float len = length(dp);
  vec2 dir = len > 1e-6 ? dp / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec4 clip = projectionMatrix * mv;
  clip.xy += perp * (uWidth * aSide) / uRes * clip.w;
  gl_Position = clip;
  float rr = length(position);
  float nf = 0.08 + 0.92 * smoothstep(1.0, 2.8, rr);
  vSide = aSide;
  vU = aU;
  vSeed = aInfo.x;
  vDir = aInfo.y;
  vBright = aInfo.z;
  vA = aA * mix(1.0, nf, uNearFade);
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uGlow;
uniform float uBase;
uniform float uPulseFreq;
uniform float uPulseSpeed;
uniform float uDirSign;
varying float vSide;
varying float vU;
varying float vSeed;
varying float vDir;
varying float vBright;
varying float vA;
void main() {
  float e = 1.0 - abs(vSide);
  float edge = e * e * (3.0 - 2.0 * e);
  float ph = vU * uPulseFreq - uTime * uPulseSpeed * vDir * uDirSign + vSeed;
  float saw = fract(ph);
  float p2 = saw * saw;
  float pulse = p2 * p2 * p2;
  float inten = (uBase + 0.85 * pulse) * uGlow * vBright;
  float a = edge * vA * uOpacity;
  gl_FragColor = vec4(uColor * inten, a);
}
`;

const SHEET_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uZT;
attribute vec2 aGrid;
attribute float aLayer;
varying vec3 vWorld;
varying vec2 vGrid;
varying float vLayer;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float flap = 0.55 * sin(wp.x * 0.13 - uTime * 0.8 + aGrid.y * 1.5);
  wp.xyz += uZT * flap * (1.0 - smoothstep(-30.0, -8.0, wp.x));
  vWorld = wp.xyz;
  vGrid = aGrid;
  vLayer = aLayer;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SHEET_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uBase;
uniform float uNight;
uniform float uFlash;
uniform float uXLine;
uniform float uOpacity;
varying vec3 vWorld;
varying vec2 vGrid;
varying float vLayer;
${GLSL_NOISE}
void main() {
  float x = vWorld.x;
  float across = 1.0 - smoothstep(0.5, 1.0, abs(vGrid.y));
  float nearF = 1.0 - smoothstep(-16.0, -8.0, x);
  float farF = smoothstep(-62.0, -34.0, x);
  float swirl = vnoise(vec3(x * 0.11 + uTime * 0.7, vGrid.y * 3.0, uTime * 0.2 + vLayer * 3.0));
  float lw = 1.0 - 0.45 * abs(vLayer);
  float a = (uBase + 0.04 * uNight) * across * nearF * farF * (0.4 + 0.9 * swirl) * lw;
  float dx = (x - uXLine) / 3.2;
  float dy = vGrid.y * 2.4;
  float fl = uFlash * exp(-dx * dx - dy * dy) * (0.7 + 0.6 * swirl);
  vec3 col = mix(uColor, uHot, clamp(uNight * 0.5 + fl, 0.0, 1.0));
  col *= 1.0 + fl * 0.7;
  gl_FragColor = vec4(col, clamp(a + fl * 0.07, 0.0, 1.0) * uOpacity);
}
`;

// ---------------------------------------------------------------- yardımcılar

/** x = xEnd'e ulaşılan en büyük θ (Shue yüzeyi). */
function thetaMaxShue(r0, alpha, xEnd) {
  let lo = Math.PI * 0.5;
  let hi = Math.PI - 0.002;
  if (magnetopauseRadius(hi, r0, alpha) * Math.cos(hi) > xEnd) return hi;
  for (let i = 0; i < 22; i++) {
    const mid = 0.5 * (lo + hi);
    if (magnetopauseRadius(mid, r0, alpha) * Math.cos(mid) > xEnd) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Yay şoku için aynısı. */
function thetaMaxBow(rbs, xEnd) {
  let lo = Math.PI * 0.5;
  let hi = Math.PI - 0.002;
  if (bowShockRadius(hi, rbs) * Math.cos(hi) > xEnd) return hi;
  for (let i = 0; i < 22; i++) {
    const mid = 0.5 * (lo + hi);
    if (bowShockRadius(mid, rbs) * Math.cos(mid) > xEnd) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Noktayı manyetopozun içinde yumuşakça tutar (≤ 0.95·r_mp), yüzeye yakın noktaları etkilemez. */
function softClip(a, o, r0, alpha) {
  const x = a[o];
  const y = a[o + 1];
  const z = a[o + 2];
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r < 0.5 * r0 || r < 1.08) return;
  const rmp = Math.min(400, r0 * Math.pow(2 / (1.0000001 + x / r), alpha));
  const s = r / (0.95 * rmp);
  if (s <= 0.55) return;
  const s2 = 0.55 + 0.45 * Math.tanh((s - 0.55) / 0.45);
  // yüzeye yakın noktalar korunur; manyetopoz çok küçükken (r0 < 3) geçiş bölgesi de küçülür
  const k = 1 + (s2 / s - 1) * smoothstep(1.02, Math.max(1.3, Math.min(3.0, 0.6 * r0)), r);
  a[o] = x * k;
  a[o + 1] = y * k;
  a[o + 2] = z * k;
}

/** Değişim denetimi: store.v ile vals karşılaştırır, farklıysa günceller ve true döner. */
function sigDiff(store, vals, n, eps) {
  let diff = !store.init;
  for (let i = 0; i < n; i++) {
    if (!(Math.abs(vals[i] - store.v[i]) <= eps)) diff = true;
  }
  if (diff) {
    for (let i = 0; i < n; i++) store.v[i] = vals[i];
    store.init = true;
  }
  return diff;
}
const makeSig = (n) => ({ init: false, v: new Float64Array(n) });

/** Şerit (ribbon) kümesi: sabit nokta sayılı çok sayıda çizgi, tek BufferGeometry. */
class RibbonSet {
  constructor(nLines, nPts, material, renderOrder, name) {
    this.nLines = nLines;
    this.nPts = nPts;
    const nV = nLines * nPts * 2;
    this.pos = new Float32Array(nV * 3);
    this.tan = new Float32Array(nV * 3);
    this.u = new Float32Array(nV);
    this.side = new Float32Array(nV);
    this.info = new Float32Array(nV * 3);
    this.alpha = new Float32Array(nV);
    this.scr = new Float32Array(nPts * 3);
    const nI = nLines * (nPts - 1) * 6;
    const index = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
    let q = 0;
    for (let l = 0; l < nLines; l++) {
      const b = l * nPts * 2;
      for (let i = 0; i < nPts - 1; i++) {
        const a = b + i * 2;
        index[q++] = a;
        index[q++] = a + 1;
        index[q++] = a + 2;
        index[q++] = a + 1;
        index[q++] = a + 3;
        index[q++] = a + 2;
      }
    }
    for (let v = 0; v < nV; v++) {
      this.side[v] = v & 1 ? 1 : -1;
      this.alpha[v] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const dyn = (arr, n) => {
      const at = new THREE.BufferAttribute(arr, n);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.aPos = dyn(this.pos, 3);
    this.aTan = dyn(this.tan, 3);
    this.aU = dyn(this.u, 1);
    this.aA = dyn(this.alpha, 1);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aTan', this.aTan);
    g.setAttribute('aU', this.aU);
    g.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 3));
    g.setAttribute('aA', this.aA);
    this.geometry = g;
    this.material = material;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = name;
  }

  /** Çizgi başına sabit: tohum, akış yönü (±1), parlaklık */
  setInfo(l, seed, dir, bright) {
    const b = l * this.nPts * 2;
    for (let v = b; v < b + this.nPts * 2; v++) {
      this.info[v * 3] = seed;
      this.info[v * 3 + 1] = dir;
      this.info[v * 3 + 2] = bright;
    }
    this.infoDirty = true;
  }

  setAlpha(l, i, a) {
    const v = (l * this.nPts + i) * 2;
    this.alpha[v] = a;
    this.alpha[v + 1] = a;
  }

  /**
   * scr içindeki ilk `count` noktayı çizgi l'ye yazar (teğet + ark uzunluğu); kalanı son noktayla doldurur.
   * centerIdx ≥ 0 ise aU, o noktadan olan uzaklık olur (burundan kuyruğa akış).
   */
  commit(l, count, centerIdx = -1) {
    const n = this.nPts;
    const s = this.scr;
    if (count < 2) count = 2;
    if (count > n) count = n;
    // NaN/Infinity temizliği
    for (let k = 0; k < count; k++) {
      const j = k * 3;
      const sum = s[j] + s[j + 1] + s[j + 2];
      if (sum - sum !== 0) {
        s[j] = k > 0 ? s[j - 3] : 0;
        s[j + 1] = k > 0 ? s[j - 2] : 0;
        s[j + 2] = k > 0 ? s[j - 1] : 0;
      }
    }
    const base = l * n * 2;
    let cum = 0;
    for (let i = 0; i < n; i++) {
      const k = i < count ? i : count - 1;
      const k0 = k > 0 ? k - 1 : 0;
      const k1 = k < count - 1 ? k + 1 : count - 1;
      let tx = s[k1 * 3] - s[k0 * 3];
      let ty = s[k1 * 3 + 1] - s[k0 * 3 + 1];
      let tz = s[k1 * 3 + 2] - s[k0 * 3 + 2];
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-9) {
        tx /= tl;
        ty /= tl;
        tz /= tl;
      } else {
        tx = 1;
        ty = 0;
        tz = 0;
      }
      if (i > 0 && i < count) {
        const dx = s[k * 3] - s[(k - 1) * 3];
        const dy = s[k * 3 + 1] - s[(k - 1) * 3 + 1];
        const dz = s[k * 3 + 2] - s[(k - 1) * 3 + 2];
        cum += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const v0 = base + i * 2;
      const o0 = v0 * 3;
      const o1 = o0 + 3;
      const px = s[k * 3];
      const py = s[k * 3 + 1];
      const pz = s[k * 3 + 2];
      this.pos[o0] = px;
      this.pos[o0 + 1] = py;
      this.pos[o0 + 2] = pz;
      this.pos[o1] = px;
      this.pos[o1 + 1] = py;
      this.pos[o1 + 2] = pz;
      this.tan[o0] = tx;
      this.tan[o0 + 1] = ty;
      this.tan[o0 + 2] = tz;
      this.tan[o1] = tx;
      this.tan[o1 + 1] = ty;
      this.tan[o1 + 2] = tz;
      this.u[v0] = cum;
      this.u[v0 + 1] = cum;
    }
    if (centerIdx >= 0) {
      const mid = this.u[base + Math.min(centerIdx, n - 1) * 2];
      for (let i = 0; i < n; i++) {
        const v0 = base + i * 2;
        const uu = Math.abs(this.u[v0] - mid);
        this.u[v0] = uu;
        this.u[v0 + 1] = uu;
      }
    }
  }

  touch(alphaToo = false) {
    this.aPos.needsUpdate = true;
    this.aTan.needsUpdate = true;
    this.aU.needsUpdate = true;
    if (alphaToo) this.aA.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function makeRibbonMaterial({ color, width, base, freq, speed, dirSign = 1, nearFade = 1 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2(1600, 900) },
      uWidth: { value: width },
      uNearFade: { value: nearFade },
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uGlow: { value: 1 },
      uBase: { value: base },
      uPulseFreq: { value: freq },
      uPulseSpeed: { value: speed },
      uDirSign: { value: dirSign },
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- katman

export class MagnetosphereLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'MagnetosphereLayer';
    ctx.scene.add(this.group);

    this._frame = 0;
    this._flowT = 0;
    this._pulseT = 0;
    this._shimT = 0;
    this._flash = 0;
    this._labelT = 1;
    this._multiVis = 0;
    this._xmaxS = null; // yumuşatılmış kuyruk uzunluğu
    this._traceFrame = 0;
    this._sizeV = new THREE.Vector2(1600, 900);
    this._basis = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) };
    this._vtmp = new THREE.Vector3();
    this._start = [0, 0, 0];
    this._model = fieldModelFromState(ctx.state);
    this._optF = { dir: 1, step: 0.12, maxSteps: 110, rMin: 1, rMax: MULTI_RMAX };
    this._optB = { dir: -1, step: 0.12, maxSteps: 110, rMin: 1, rMax: MULTI_RMAX };
    this._in = {
      r0: 10.5, alpha: 0.58, rbs: 13.5, M: 1, absM: 1, kp: 1, night: 0, day: 0, Lmax: 7, Lmin: 1.5, Xmax: 25, lamOc: 1.2,
      dipVis: 1, drapeVis: 0, shield: 1,
      zTy: 1, zTz: 0, yTy: 0, yTz: -1, mT: 1, cX: 0,
    };

    // eşik/imza depoları
    this._sig = {
      closed: makeSig(8), open: makeSig(6), sheet: makeSig(5), drape: makeSig(1), mp: makeSig(2), bs: makeSig(1),
    };
    this._sigVals = [0, 0, 0, 0, 0, 0, 0, 0];
    this._mpDirty = true;
    this._bsDirty = true;

    // manyetopoz/yay şoku satır tabloları
    this._mpX = new Float64Array(MP_ROWS + 1);
    this._mpRho = new Float64Array(MP_ROWS + 1);
    this._mpNx = new Float64Array(MP_ROWS + 1);
    this._mpNr = new Float64Array(MP_ROWS + 1);
    this._bsX = new Float64Array(BS_ROWS + 1);
    this._bsRho = new Float64Array(BS_ROWS + 1);
    this._bsNx = new Float64Array(BS_ROWS + 1);
    this._bsNr = new Float64Array(BS_ROWS + 1);
    this._rk = new Float64Array(N_T + 1);
    this._rd = new Float64Array(N_P);
    this._zd = new Float64Array(N_P);
    this._qw = new Float64Array(N_P);
    this._rh = new Float64Array(N_LON * 3);

    this._buildShells();
    this._buildRibbons();
    this._buildSheet();
    this._buildLabels();

    this._offs = [
      ctx.events.on('storm:arrived', () => {
        this._flash = 1;
      }),
      ctx.events.on('sim:reset', () => {
        this._flash = 0;
      }),
    ];
  }

  // ------------------------------------------------------------ kurulum

  _makeShell(rows, cols, material, order, name) {
    const nV = (rows + 1) * (cols + 1);
    const pos = new Float32Array(nV * 3);
    const nrm = new Float32Array(nV * 3);
    const idx = new Uint16Array(rows * cols * 6);
    let q = 0;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = i * (cols + 1) + j;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        idx[q++] = a;
        idx[q++] = c;
        idx[q++] = b;
        idx[q++] = b;
        idx[q++] = c;
        idx[q++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    const aP = new THREE.BufferAttribute(pos, 3);
    aP.setUsage(THREE.DynamicDrawUsage);
    const aN = new THREE.BufferAttribute(nrm, 3);
    aN.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', aP);
    g.setAttribute('normal', aN);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.name = name;
    return { mesh, pos, nrm, aP, aN, geometry: g, material };
  }

  _buildShells() {
    this._cosPhi = new Float64Array(Math.max(MP_COLS, BS_COLS) + 1);
    this._sinPhi = new Float64Array(Math.max(MP_COLS, BS_COLS) + 1);

    const mpMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(COLORS.magnetopause) },
        uHot: { value: new THREE.Color(0xd62f78) },
        uCompress: { value: 0 },
        uRecon: { value: 0 },
        uFlash: { value: 0 },
        uFade: { value: 1 },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: MP_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._mp = this._makeShell(MP_ROWS, MP_COLS, mpMat, 5, 'Manyetopoz');
    this.group.add(this._mp.mesh);

    const bsMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(COLORS.bowShock) },
        uFade: { value: 1 },
        uFlash: { value: 0 },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: BS_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._bs = this._makeShell(BS_ROWS, BS_COLS, bsMat, 4, 'Yay şoku');
    this.group.add(this._bs.mesh);
  }

  _buildRibbons() {
    // kapalı (turkuaz)
    this._closed = new RibbonSet(
      N_RING * N_LON,
      N_P,
      makeRibbonMaterial({ color: COLORS.fieldClosed, width: 1.8, base: 0.3, freq: 0.16, speed: 0.55 }),
      8,
      'Kapalı alan çizgileri',
    );
    for (let k = 0; k < N_RING; k++) {
      for (let i = 0; i < N_LON; i++) {
        const l = k * N_LON + i;
        this._closed.setInfo(l, hash1(l), 1, 1.15 - 0.45 * RING_T[k]);
      }
    }
    // açık (turuncu)
    this._open = new RibbonSet(
      OPEN_N,
      OPEN_PTS,
      makeRibbonMaterial({ color: COLORS.fieldOpen, width: 1.7, base: 0.2, freq: 0.07, speed: 0.9 }),
      8,
      'Açık alan çizgileri',
    );
    for (let l = 0; l < OPEN_N; l++) {
      this._open.setInfo(l, hash1(l + 77), -OP_S[l], 1.0);
      const endX = 62 + 18 * hash1(l + 5); // çizgi sonu (−x)
      for (let i = 0; i < OPEN_PTS; i++) {
        let a = 1;
        if (i >= N_B) {
          const xk = OPEN_X0 + (i - N_B + 1) * OPEN_DX;
          a = 1 - smoothstep(endX - 22, endX, xk);
        }
        this._open.setAlpha(l, i, a);
      }
    }
    // çoklu kutup (mor)
    this._multi = new RibbonSet(
      MULTI_N,
      MULTI_PTS,
      makeRibbonMaterial({ color: 0xb07cff, width: 2.2, base: 0.5, freq: 0.5, speed: 0.8 }),
      9,
      'Çoklu kutup alan çizgileri',
    );
    for (let l = 0; l < MULTI_N; l++) this._multi.setInfo(l, hash1(l + 31), 1, 1.0);
    // sarılmış IMF (sıcak sarı)
    this._drape = new RibbonSet(
      N_DRAPE,
      DRAPE_PTS,
      makeRibbonMaterial({ color: 0xffd27a, width: 2.2, base: 0.5, freq: 0.5, speed: 1.2, nearFade: 0 }),
      9,
      'Sarılmış IMF çizgileri',
    );
    for (let l = 0; l < N_DRAPE; l++) this._drape.setInfo(l, hash1(l + 13), 1, 1.0);

    this._sets = [this._closed, this._open, this._multi, this._drape];
    this._visArr = new Float64Array(4);
    for (const set of this._sets) {
      set.mesh.visible = false;
      this.group.add(set.mesh);
    }
  }

  _buildSheet() {
    const nx = SHEET_NX + 1;
    const ny = SHEET_NY + 1;
    const per = nx * ny;
    const nV = per * SHEET_LAYERS;
    this._sheetPos = new Float32Array(nV * 3);
    const grid = new Float32Array(nV * 2);
    const layer = new Float32Array(nV);
    const idx = new Uint16Array(SHEET_LAYERS * SHEET_NX * SHEET_NY * 6);
    let q = 0;
    for (let l = 0; l < SHEET_LAYERS; l++) {
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const v = l * per + i * ny + j;
          grid[v * 2] = i / SHEET_NX;
          grid[v * 2 + 1] = -1 + (2 * j) / SHEET_NY;
          layer[v] = l - 1;
        }
      }
      for (let i = 0; i < SHEET_NX; i++) {
        for (let j = 0; j < SHEET_NY; j++) {
          const a = l * per + i * ny + j;
          const b = a + 1;
          const c = a + ny;
          const d = c + 1;
          idx[q++] = a;
          idx[q++] = c;
          idx[q++] = b;
          idx[q++] = b;
          idx[q++] = c;
          idx[q++] = d;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    this._sheetAttr = new THREE.BufferAttribute(this._sheetPos, 3);
    this._sheetAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this._sheetAttr);
    g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
    g.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uZT: { value: new THREE.Vector3(0, 1, 0) },
        uColor: { value: new THREE.Color(0xff9a4a) },
        uHot: { value: new THREE.Color(0xffd9a0) },
        uBase: { value: 0.05 },
        uNight: { value: 0 },
        uFlash: { value: 0 },
        uXLine: { value: -20 },
        uOpacity: { value: 1 },
      },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._sheet = { mesh: new THREE.Mesh(g, mat), geometry: g, material: mat };
    this._sheet.mesh.frustumCulled = false;
    this._sheet.mesh.renderOrder = 7;
    this._sheet.mesh.name = 'Plazma tabakası';
    this._sheet.mesh.visible = false;
    this.group.add(this._sheet.mesh);
  }

  _buildLabels() {
    const L = {
      mp: makeLabel(t('scene.mag.magnetopause'), 'default'),
      bs: makeLabel(t('scene.mag.bowShock'), 'default'),
      sheet: makeLabel(t('scene.mag.plasmaSheet'), 'small'),
      tail: makeLabel(t('scene.mag.magnetotail'), 'small'),
      cusp: makeLabel(t('scene.mag.cusp'), 'small'),
      induced: makeLabel(t('scene.mag.induced'), 'warn'),
    };
    this._labels = L;
    this._labelArr = Object.values(L);
    this._labelVariant = { mp: 'default' };
    this._labelText = { mp: '' };
    for (const k of Object.keys(L)) {
      L[k].visible = false;
      this.group.add(L[k]);
    }
  }

  // ------------------------------------------------------------ girdiler

  _gather(st, realDt) {
    const d = st.derived;
    const I = this._in;
    I.r0 = clamp(fin(d.r0, 10.5), 1.05, 40);
    I.alpha = clamp(fin(d.alpha, 0.58), 0.3, 1);
    I.rbs = clamp(fin(d.rbs, 13.5), 1.1, 60);
    I.M = fin(d.dipoleMoment, 1);
    I.absM = Math.abs(I.M);
    I.shield = fin(d.shieldStrength, 1);
    I.kp = clamp(fin(d.kp, 1), 0, 9);
    I.night = clamp(fin(d.reconnection?.nightside, 0), 0, 1);
    I.day = clamp(fin(d.reconnection?.dayside, 0), 0, 1);

    // Açık/kapalı sınır: aurora ovalinin kutupsal sınırı. L üst sınırı manyetopoza (r0 ∝ |M|^(1/3))
    // bağlıdır: zayıf alan → küçük manyetosfer → daha az/kısa kapalı çizgi.
    const lamOcDeg = clamp(fin(d.auroraLat, 63) + fin(d.auroraWidth, 5), 40, 80);
    const cl = Math.cos(lamOcDeg * DEG);
    const Loc = 1 / (cl * cl);
    I.Lmax = clamp(Math.min(Loc, 1.15 * I.r0), 1.7, 14);
    I.Lmin = Math.min(1.5, 0.8 * I.Lmax);
    I.lamOc = Math.acos(1 / Math.sqrt(I.Lmax)); // rad
    // kuyruk uzunluğu: alt fırtınada (night → 1) ani değil, hızlı ama yumuşak toparlanır
    const xt = clamp(24 + 1.6 * I.kp - 7 * I.night, 14, 40);
    if (this._xmaxS === null) this._xmaxS = xt;
    this._xmaxS += (xt - this._xmaxS) * (1 - Math.exp(-realDt / (xt < this._xmaxS ? 0.18 : 0.6)));
    I.Xmax = this._xmaxS;

    // görünürlük ağırlıkları
    const reversing = st.reversal.active || Math.abs(fin(d.quadrupole, 0)) > 0.02;
    // kalkan çökünce (< ~0.04) dipol çizgileri söner, sarılmış IMF çizgileri gelir; Laschamp (0.06) gibi
    // zayıf ama sağlam bir kalkan hâlâ dipol olarak çizilir (r0 ≈ 4 Re)
    let dip = smoothstep(0.01, 0.07, I.shield);
    if (reversing) dip *= smoothstep(0.04, 0.55, I.absM);
    I.dipVis = dip;
    I.drapeVis = 1 - smoothstep(0.02, 0.07, I.shield);
    I.reversing = reversing;

    // manyetik taban ve kuyruk (menteşeli) çerçevesi
    const b = magneticBasis(st.frame, this._basis);
    const c = clamp(b.z.x, -1, 1);
    const m = Math.sqrt(Math.max(0, 1 - c * c));
    I.cX = c;
    I.mT = m;
    if (m > 0.02) {
      I.zTy = b.z.y / m;
      I.zTz = b.z.z / m;
    } else {
      I.zTy = 1;
      I.zTz = 0;
    }
    I.yTy = I.zTz; // yT = zT × x̂ = (0, zTz, −zTy)
    I.yTz = -I.zTy;
    return I;
  }

  /** x'teki manyetopoz kesit yarıçapı (kuyruk tablosundan doğrusal interpolasyon). */
  _rhoAtX(x) {
    const xs = this._mpX;
    const N = MP_ROWS;
    if (x >= xs[0]) return this._mpRho[0];
    if (x <= xs[N]) return this._mpRho[N];
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] >= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo] || -1);
    return this._mpRho[lo] + (this._mpRho[hi] - this._mpRho[lo]) * t;
  }

  // ------------------------------------------------------------ yüzeyler

  _computeMpRows(r0, alpha) {
    const T = thetaMaxShue(r0, alpha, TAIL_END_X);
    for (let i = 0; i <= MP_ROWS; i++) {
      const th = i === MP_ROWS ? T : T * Math.pow(i / MP_ROWS, 1.15);
      const c = Math.cos(th);
      const s = Math.sin(th);
      const r = magnetopauseRadius(th, r0, alpha);
      const dr = (alpha * r * s) / (1 + c + 1e-9);
      const dx = dr * c - r * s;
      const dp = dr * s + r * c;
      const len = Math.sqrt(dx * dx + dp * dp) || 1;
      this._mpX[i] = r * c;
      this._mpRho[i] = r * s;
      this._mpNx[i] = dp / len;
      this._mpNr[i] = -dx / len;
    }
    this._mpDirty = true;
  }

  _computeBsRows(rbs) {
    const eps = BOW_SHOCK_ECCENTRICITY;
    const T = thetaMaxBow(rbs, BOW_END_X);
    for (let i = 0; i <= BS_ROWS; i++) {
      const th = i === BS_ROWS ? T : T * Math.pow(i / BS_ROWS, 1.1);
      const c = Math.cos(th);
      const s = Math.sin(th);
      const r = bowShockRadius(th, rbs);
      const dr = (r * eps * s) / (1 + eps * c);
      const dx = dr * c - r * s;
      const dp = dr * s + r * c;
      const len = Math.sqrt(dx * dx + dp * dp) || 1;
      this._bsX[i] = r * c;
      this._bsRho[i] = r * s;
      this._bsNx[i] = dp / len;
      this._bsNr[i] = -dx / len;
    }
    this._bsDirty = true;
  }

  _writeShell(sh, rows, cols, X, RHO, NX, NR) {
    for (let j = 0; j <= cols; j++) {
      const p = (j / cols) * Math.PI * 2;
      this._cosPhi[j] = Math.cos(p);
      this._sinPhi[j] = Math.sin(p);
    }
    const pos = sh.pos;
    const nrm = sh.nrm;
    for (let i = 0; i <= rows; i++) {
      const x = X[i];
      const rho = RHO[i];
      const nx = NX[i];
      const nr = NR[i];
      let o = i * (cols + 1) * 3;
      for (let j = 0; j <= cols; j++) {
        const cp = this._cosPhi[j];
        const sp = this._sinPhi[j];
        pos[o] = x;
        pos[o + 1] = rho * cp;
        pos[o + 2] = rho * sp;
        nrm[o] = nx;
        nrm[o + 1] = nr * cp;
        nrm[o + 2] = nr * sp;
        o += 3;
      }
    }
    sh.aP.needsUpdate = true;
    sh.aN.needsUpdate = true;
  }

  // ------------------------------------------------------------ alan çizgileri

  _buildClosed(I) {
    const set = this._closed;
    const sc = set.scr;
    const b = this._basis;
    const zMx = b.z.x;
    const zMy = b.z.y;
    const zMz = b.z.z;
    const rh = this._rh;
    for (let i = 0; i < N_LON; i++) {
      rh[i * 3] = COS_P[i] * b.x.x + SIN_P[i] * b.y.x;
      rh[i * 3 + 1] = COS_P[i] * b.x.y + SIN_P[i] * b.y.y;
      rh[i * 3 + 2] = COS_P[i] * b.x.z + SIN_P[i] * b.y.z;
    }
    const c0 = I.cX;
    const m0 = I.mT;
    const { zTy, zTz, yTy, yTz } = I;
    const BETA = 0.9;
    const H = 0.85;
    const r0 = I.r0;
    const al = I.alpha;
    const Lratio = I.Lmax / I.Lmin;

    for (let k = 0; k < N_RING; k++) {
      const t = RING_T[k];
      const L = I.Lmin * Math.pow(Lratio, t);
      const lam0 = Math.acos(1 / Math.sqrt(L));
      const S = Math.pow(smoothstep(0.5, 1.0, t), 1.2);
      const Xeq = L + (I.Xmax - L) * S;
      for (let j = 0; j < N_P; j++) {
        const lam = -lam0 + (2 * lam0 * j) / (N_P - 1);
        const c = Math.cos(lam);
        const s = Math.sin(lam);
        const c2 = c * c;
        const c3 = c2 * c;
        this._rd[j] = L * c3;
        this._zd[j] = L * c2 * s;
        const un = (2 * j) / (N_P - 1) - 1; // normalize enlem −1..1
        this._qw[j] = 1 - un * un; // ekvatorda 1, taban noktalarında 0 (yuvarlak uç)
      }
      for (let i = 0; i < N_LON; i++) {
        const w0 = NIGHT_W[i] * S;
        const rhx = rh[i * 3];
        const rhy = rh[i * 3 + 1];
        const rhz = rh[i * 3 + 2];
        const sp = SIN_P[i];
        const cp = COS_P[i];
        for (let j = 0; j < N_P; j++) {
          const rd = this._rd[j];
          const zd = this._zd[j];
          let px = rd * rhx + zd * zMx;
          let py = rd * rhy + zd * zMy;
          let pz = rd * rhz + zd * zMz;
          const w = w0 * this._qw[j];
          if (w > 1e-4) {
            const lat = rd * sp;
            const pzT = -rd * c0 * cp + zd * m0;
            const dx = -Xeq - px;
            const dl = BETA * lat;
            const dz = zd * H - pzT;
            px += w * dx;
            py += w * (dl * yTy + dz * zTy);
            pz += w * (dl * yTz + dz * zTz);
          }
          const o = j * 3;
          sc[o] = px;
          sc[o + 1] = py;
          sc[o + 2] = pz;
          if (j === 0 || j === N_P - 1) {
            const rr = Math.sqrt(px * px + py * py + pz * pz) || 1;
            const f = 1.003 / rr;
            sc[o] = px * f;
            sc[o + 1] = py * f;
            sc[o + 2] = pz * f;
          } else {
            softClip(sc, o, r0, al);
          }
        }
        set.commit(k * N_LON + i, N_P);
      }
    }
    set.touch();
  }

  _buildOpen(I) {
    const set = this._open;
    const sc = set.scr;
    const b = this._basis;
    const xMx = b.x.x;
    const xMy = b.x.y;
    const xMz = b.x.z;
    const yMx = b.y.x;
    const yMy = b.y.y;
    const yMz = b.y.z;
    const zMx = b.z.x;
    const zMy = b.z.y;
    const zMz = b.z.z;
    const { zTy, zTz, yTy, yTz } = I;
    const lamPole = 86 * DEG;
    const rk = this._rk;
    for (let k = 0; k <= N_T; k++) rk[k] = this._rhoAtX(-OPEN_X0 - k * OPEN_DX);
    const R0 = rk[0];

    for (let l = 0; l < OPEN_N; l++) {
      const s = OP_S[l];
      const xi = OP_XI[l];
      const cp = OP_COSP[l];
      const sp = OP_SINP[l];
      const lam = lamPole - (lamPole - I.lamOc) * xi;
      const cl = Math.cos(lam);
      const sl = Math.sin(lam);
      const rhx = cp * xMx + sp * yMx;
      const rhy = cp * xMy + sp * yMy;
      const rhz = cp * xMz + sp * yMz;
      // taban noktası
      const fx = (cl * rhx + s * sl * zMx) * 1.003;
      const fy = (cl * rhy + s * sl * zMy) * 1.003;
      const fz = (cl * rhz + s * sl * zMz) * 1.003;
      // dipol çizgisinin yüzeyden çıkış yönü
      let dr = 3 * cl * cl * sl;
      let dz = cl * (2 * sl * sl - cl * cl);
      const dn = Math.sqrt(dr * dr + dz * dz) || 1;
      dr /= dn;
      dz /= dn;
      const s1 = 1.4 + 5.0 * OP_DAYW[l] * (0.35 + 0.65 * xi);
      const p1x = fx + (dr * rhx + s * dz * zMx) * s1;
      const p1y = fy + (dr * rhy + s * dz * zMy) * s1;
      const p1z = fz + (dr * rhz + s * dz * zMz) * s1;
      // kuyruk lobundaki konum (manyetopoz yarıçapına göre)
      const yf = 0.74 * xi * sp;
      const zf = 0.18 + 0.56 * (0.5 + 0.5 * xi * cp);
      const jx = -OPEN_X0;
      const jy = (yTy * yf + zTy * s * zf) * R0;
      const jz = (yTz * yf + zTz * s * zf) * R0;
      const s2 = 4.0 + 0.2 * R0;
      const p2x = jx + s2;
      for (let bi = 0; bi < N_B; bi++) {
        const w0 = BZ[bi * 4];
        const w1 = BZ[bi * 4 + 1];
        const w2 = BZ[bi * 4 + 2];
        const w3 = BZ[bi * 4 + 3];
        const o = bi * 3;
        sc[o] = w0 * fx + w1 * p1x + w2 * p2x + w3 * jx;
        sc[o + 1] = w0 * fy + w1 * p1y + w2 * jy + w3 * jy;
        sc[o + 2] = w0 * fz + w1 * p1z + w2 * jz + w3 * jz;
        if (bi > 0) softClip(sc, o, I.r0, I.alpha);
      }
      for (let k = 1; k <= N_T; k++) {
        const R = rk[k];
        const o = (N_B + k - 1) * 3;
        sc[o] = -OPEN_X0 - k * OPEN_DX;
        sc[o + 1] = (yTy * yf + zTy * s * zf) * R;
        sc[o + 2] = (yTz * yf + zTz * s * zf) * R;
        softClip(sc, o, I.r0, I.alpha);
      }
      set.commit(l, OPEN_PTS);
    }
    set.touch();
  }

  _buildDrape(I) {
    const set = this._drape;
    const sc = set.scr;
    const Ro = Math.max(I.r0, 1.12);
    const half = (DRAPE_PTS - 1) / 2;
    for (let l = 0; l < N_DRAPE; l++) {
      const psi = (Math.PI * l) / N_DRAPE + 0.3;
      const rk = Ro * (1.08 + 0.6 * (l / (N_DRAPE - 1)) * (0.6 + 0.4 * hash1(l)));
      const cps = Math.cos(psi);
      const sps = Math.sin(psi);
      for (let j = 0; j < DRAPE_PTS; j++) {
        const sgn = j < half ? -1 : 1;
        const a = Math.abs(j - half) / half; // 0 burun, 1 uç
        const th = Math.PI * 0.93 * Math.pow(a, 0.85);
        const c = Math.cos(th);
        const sn = Math.sin(th);
        const r = rk * Math.pow(2 / (1.0000001 + c), 0.5);
        const rho = r * sn;
        const o = j * 3;
        sc[o] = Math.min(r * c, 1e3);
        sc[o + 1] = sgn * rho * cps;
        sc[o + 2] = sgn * rho * sps;
      }
      set.commit(l, DRAPE_PTS, half);
    }
    set.touch();
  }

  /** Sayısal çoklu kutup alan çizgileri (kutup tersinmesi) */
  _traceMulti(st, I) {
    const set = this._multi;
    const sc = set.scr;
    const model = fieldModelFromState(st, this._model);
    const basis = this._basis;
    const v = this._vtmp;
    const start = this._start;
    let l = 0;
    for (const [lat, r0s] of MULTI_START) {
      for (const mlt of MULTI_MLT) {
        magneticToWorld(lat, mlt, r0s, basis, v);
        start[0] = v.x;
        start[1] = v.y;
        start[2] = v.z;
        const fwd = traceFieldLine(start, model, this._optF);
        const bwd = traceFieldLine(start, model, this._optB);
        const nf = fwd.length / 3;
        const nb = bwd.length / 3;
        const total = nb - 1 + nf;
        const count = Math.min(total, MULTI_PTS);
        for (let i = 0; i < count; i++) {
          // toplam diziden eşit aralıklı örnekle: önce geri (ters sıra), sonra ileri
          const g = count === total ? i : Math.round((i * (total - 1)) / (count - 1));
          let x;
          let y;
          let z;
          if (g < nb - 1) {
            const q = (nb - 1 - g) * 3;
            x = bwd[q];
            y = bwd[q + 1];
            z = bwd[q + 2];
          } else {
            const q = (g - (nb - 1)) * 3;
            x = fwd[q];
            y = fwd[q + 1];
            z = fwd[q + 2];
          }
          const r = Math.sqrt(x * x + y * y + z * z) || 1;
          if (r < 1.003) {
            const f = 1.003 / r;
            x *= f;
            y *= f;
            z *= f;
          }
          sc[i * 3] = x;
          sc[i * 3 + 1] = y;
          sc[i * 3 + 2] = z;
        }
        if (count < 4) {
          for (let i = 0; i < MULTI_PTS; i++) set.setAlpha(l, i, 0);
          sc[0] = sc[1] = sc[2] = 0;
          sc[3] = sc[4] = sc[5] = 0;
          set.commit(l, 2);
        } else {
          // kesilmiş uçlarda sönümle (r ≥ rMax)
          const r0e = Math.hypot(sc[0], sc[1], sc[2]);
          const r1e = Math.hypot(sc[(count - 1) * 3], sc[(count - 1) * 3 + 1], sc[(count - 1) * 3 + 2]);
          const cutS = r0e > MULTI_RMAX - 0.4;
          const cutE = r1e > MULTI_RMAX - 0.4;
          for (let i = 0; i < MULTI_PTS; i++) {
            let a = i < count ? 1 : 0;
            if (i < count) {
              if (cutS) a = Math.min(a, i / 10);
              if (cutE) a = Math.min(a, (count - 1 - i) / 10);
            }
            set.setAlpha(l, i, Math.min(1, a));
          }
          set.commit(l, count);
        }
        l++;
      }
    }
    set.touch(true);
  }

  _buildSheetGeometry(I) {
    const pos = this._sheetPos;
    const nx = SHEET_NX + 1;
    const ny = SHEET_NY + 1;
    const per = nx * ny;
    const { zTy, zTz, yTy, yTz } = I;
    for (let l = 0; l < SHEET_LAYERS; l++) {
      const zoff = (l - 1) * 0.9;
      for (let i = 0; i < nx; i++) {
        const x = SHEET_X0 + ((SHEET_X1 - SHEET_X0) * i) / SHEET_NX;
        const half = 0.9 * this._rhoAtX(x);
        for (let j = 0; j < ny; j++) {
          const y = (-1 + (2 * j) / SHEET_NY) * half;
          const o = (l * per + i * ny + j) * 3;
          pos[o] = x;
          pos[o + 1] = yTy * y + zTy * zoff;
          pos[o + 2] = yTz * y + zTz * zoff;
        }
      }
    }
    this._sheetAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------ güncelleme

  update(visDt, simDt, realDt) {
    const ctx = this.ctx;
    const st = ctx.state;
    const flags = st.params.layers;
    visDt = fin(visDt, 0);
    realDt = fin(realDt, 1 / 60);
    const wantMp = !!flags.magnetopause;
    const wantBs = !!flags.bowShock;
    const wantFl = !!flags.fieldLines;
    this._flash *= Math.exp(-realDt * 1.3);
    if (!wantMp && !wantBs && !wantFl) {
      this._hideAll();
      return;
    }

    this._frame++;
    this._flowT += visDt * (fin(st.sw.speed, 400) / 400);
    this._pulseT += visDt;
    this._shimT += realDt;

    const I = this._gather(st, realDt);
    const d = st.derived;
    const flash = this._flash;

    // çözünürlük (şerit genişliği için)
    const r = ctx.renderer;
    if (r && typeof r.getSize === 'function') {
      r.getSize(this._sizeV);
      const pr = typeof r.getPixelRatio === 'function' ? r.getPixelRatio() : 1;
      this._res = this._res || new THREE.Vector2();
      this._res.set(Math.max(1, this._sizeV.x * pr), Math.max(1, this._sizeV.y * pr));
      this._pr = pr;
    } else {
      this._res = this._res || new THREE.Vector2(1600, 900);
      this._pr = 1;
    }

    // --- tablolar
    const vals = this._sigVals;
    if (wantMp || wantFl) {
      vals[0] = I.r0;
      vals[1] = I.alpha;
      if (sigDiff(this._sig.mp, vals, 2, 1e-4)) this._computeMpRows(I.r0, I.alpha);
    }
    if (wantBs) {
      vals[0] = I.rbs;
      if (sigDiff(this._sig.bs, vals, 1, 1e-4)) this._computeBsRows(I.rbs);
    }

    // --- manyetopoz
    const mpFade = smoothstep(1.2, 2.6, I.r0);
    const mpVisible = wantMp && mpFade > 0.01;
    this._mp.mesh.visible = mpVisible;
    if (mpVisible) {
      if (this._mpDirty) {
        this._writeShell(this._mp, MP_ROWS, MP_COLS, this._mpX, this._mpRho, this._mpNx, this._mpNr);
        this._mpDirty = false;
      }
      const u = this._mp.material.uniforms;
      u.uTime.value = this._flowT;
      u.uCompress.value = clamp((9.5 - I.r0) / 4.5, 0, 1);
      u.uRecon.value = I.day;
      u.uFlash.value = flash;
      u.uFade.value = mpFade;
    }

    // --- yay şoku
    const bsFade = 0.45 + 0.55 * smoothstep(1.2, 3.0, I.rbs);
    this._bs.mesh.visible = wantBs;
    if (wantBs) {
      if (this._bsDirty) {
        this._writeShell(this._bs, BS_ROWS, BS_COLS, this._bsX, this._bsRho, this._bsNx, this._bsNr);
        this._bsDirty = false;
      }
      const u = this._bs.material.uniforms;
      u.uTime.value = this._shimT;
      u.uFade.value = bsFade;
      u.uFlash.value = flash;
    }

    // --- alan çizgileri + plazma tabakası
    this._updateLines(st, I, d, wantFl, flash, realDt);

    // --- etiketler
    this._updateLabels(I, realDt, wantMp && mpFade > 0.05, wantBs, wantFl);
  }

  _updateLines(st, I, d, wantFl, flash, realDt) {
    const sets = this._sets;
    const sheet = this._sheet;
    if (!wantFl) {
      for (let i = 0; i < 4; i++) sets[i].mesh.visible = false;
      sheet.mesh.visible = false;
      return;
    }

    const dipVis = I.dipVis;
    const drapeVis = I.drapeVis;
    const quad = Math.abs(fin(d.quadrupole, 0));
    // çoklu kutup ağırlığı (yumuşak geçiş)
    const multiTarget = I.reversing ? 1 : smoothstep(0.015, 0.06, quad);
    this._multiVis += (multiTarget - this._multiVis) * (1 - Math.exp(-realDt * 3));
    if (Math.abs(multiTarget - this._multiVis) < 0.01) this._multiVis = multiTarget;
    const multiVis = I.absM > 0.01 || quad > 0.01 ? this._multiVis : 0;

    const vals = this._sigVals;
    const ax = st.frame.dipoleAxis;
    const even = (this._frame & 1) === 0;

    // şerit malzemeleri: renk/parlaklık/görünürlük
    const glow = 0.95 + 0.035 * I.kp + 0.8 * flash;
    const dirSign = I.M >= 0 ? 1 : -1;
    const vis = this._visArr;
    vis[0] = dipVis;
    vis[1] = dipVis;
    vis[2] = multiVis;
    vis[3] = drapeVis;
    for (let i = 0; i < 4; i++) {
      const set = sets[i];
      const u = set.material.uniforms;
      u.uTime.value = this._pulseT;
      u.uGlow.value = glow;
      u.uOpacity.value = vis[i];
      u.uDirSign.value = i < 2 ? dirSign : 1;
      u.uRes.value.copy(this._res);
      u.uWidth.value = RIBBON_WIDTH[i] * this._pr;
      set.mesh.visible = vis[i] > 0.004;
    }

    // yeniden kurma: çift karelerde kapalı, tek karelerde açık + tabaka + sarılmış
    if (even) {
      if (dipVis > 0.004) {
        vals[0] = I.r0;
        vals[1] = I.alpha;
        vals[2] = I.absM;
        vals[3] = ax.x;
        vals[4] = ax.y;
        vals[5] = ax.z;
        vals[6] = I.Lmax;
        vals[7] = I.Xmax;
        if (sigDiff(this._sig.closed, vals, 8, 2e-4)) this._buildClosed(I);
      }
    } else {
      if (dipVis > 0.004) {
        vals[0] = I.r0;
        vals[1] = I.alpha;
        vals[2] = ax.x;
        vals[3] = ax.y;
        vals[4] = ax.z;
        vals[5] = I.Lmax;
        if (sigDiff(this._sig.open, vals, 6, 2e-4)) this._buildOpen(I);
      }
      if (drapeVis > 0.004) {
        vals[0] = Math.max(I.r0, 1.12);
        if (sigDiff(this._sig.drape, vals, 1, 1e-3)) this._buildDrape(I);
      }
    }

    // plazma tabakası
    const sheetVis = I.reversing ? dipVis * 0.5 : dipVis;
    sheet.mesh.visible = sheetVis > 0.01;
    if (sheet.mesh.visible) {
      if (!even) {
        vals[0] = I.r0;
        vals[1] = I.alpha;
        vals[2] = ax.x;
        vals[3] = ax.y;
        vals[4] = ax.z;
        if (sigDiff(this._sig.sheet, vals, 5, 2e-4)) this._buildSheetGeometry(I);
      }
      const u = sheet.material.uniforms;
      u.uTime.value = this._shimT;
      u.uZT.value.set(0, I.zTy, I.zTz);
      u.uBase.value = 0.008 + 0.0015 * I.kp;
      u.uNight.value = I.night;
      u.uFlash.value = Math.pow(I.night, 1.6) * (0.55 + 0.45 * Math.sin(this._shimT * 9));
      u.uOpacity.value = sheetVis;
    }

    // çoklu kutup izleme (8 karede bir)
    if (multiVis > 0.01) {
      this._traceFrame++;
      if (this._traceFrame % 8 === 1) this._traceMulti(st, I);
    }
  }

  _updateLabels(I, realDt, showMp, showBs, showFl) {
    const L = this._labels;
    const b = this._basis;

    // metinler ~4×/sn
    this._labelT += realDt;
    if (this._labelT >= 0.25) {
      this._labelT = 0;
      // GEO, manyetopoz burnu yörüngenin içine girince korumasız kalır: HUD ve uyarıyla aynı ölçüt
      const warn = !!this.ctx.state.derived.impacts?.geoExposed;
      let txt = t('scene.mag.mpLabel', { r: fmtNum(I.r0, 1) });
      if (warn) txt += t('scene.mag.geoOut');
      if (txt !== this._labelText.mp) {
        L.mp.element.textContent = txt;
        this._labelText.mp = txt;
      }
      const variant = warn ? 'warn' : 'default';
      if (variant !== this._labelVariant.mp) {
        setLabelVariant(L.mp, variant);
        this._labelVariant.mp = variant;
      }
    }

    L.mp.visible = showMp;
    L.mp.position.set(I.r0, 0.4, 0);

    L.bs.visible = showBs;
    {
      const th = 0.5;
      const rr = bowShockRadius(th, I.rbs);
      L.bs.position.set(rr * Math.cos(th), rr * Math.sin(th), 0);
    }

    const fl = showFl && I.dipVis > 0.3;
    L.sheet.visible = fl;
    L.sheet.position.set(-26, 0.5 * I.zTy, 0.5 * I.zTz);
    L.tail.visible = fl;
    {
      const R = this._rhoAtX(-42);
      L.tail.position.set(-42, 0.5 * R * I.zTy, 0.5 * R * I.zTz);
    }
    L.cusp.visible = fl;
    magneticToWorld(I.lamOc / DEG, 12, 1.5, b, L.cusp.position);

    L.induced.visible = showFl && I.drapeVis > 0.4;
    L.induced.position.set(Math.max(I.r0, 1.12) * 1.6, 1.9, 0);
  }

  _hideAll() {
    this._mp.mesh.visible = false;
    this._bs.mesh.visible = false;
    this._sheet.mesh.visible = false;
    for (const s of [this._closed, this._open, this._multi, this._drape]) s.mesh.visible = false;
    const arr = this._labelArr;
    for (let i = 0; i < arr.length; i++) arr[i].visible = false;
  }

  dispose() {
    for (const off of this._offs || []) off();
    this._offs = [];
    for (const k of Object.keys(this._labels)) {
      this.group.remove(this._labels[k]);
      this._labels[k].element?.remove?.();
    }
    for (const s of [this._closed, this._open, this._multi, this._drape]) {
      this.group.remove(s.mesh);
      s.dispose();
    }
    for (const sh of [this._mp, this._bs]) {
      this.group.remove(sh.mesh);
      sh.geometry.dispose();
      sh.material.dispose();
    }
    this.group.remove(this._sheet.mesh);
    this._sheet.geometry.dispose();
    this._sheet.material.dispose();
    this.ctx.scene.remove(this.group);
  }
}
