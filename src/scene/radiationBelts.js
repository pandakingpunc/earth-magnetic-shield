// Van Allen kuşakları: dipol L-kabukları (r = L cos²λ) boyunca hacimli nokta bulutu, yarı saydam
// kabuklar, tuzaklanmış parçacıklar (sıçrama + sürüklenme + jirasyon) ve etiketler.
// Tüm kuşak nesneleri manyetik çerçeveye bağlı tek bir grupta yaşar: grup +Y'yi dipol eksenine,
// +X'i manyetik öğleye çevirir ve |M|^(1/3) ile ölçeklenir.

import * as THREE from 'three';
import { COLORS } from '../core/constants.js';
import { magneticBasis, clamp, smoothstep } from '../core/geo.js';
import { insideMagnetopause } from '../physics/magnetopause.js';
import { makeLabel } from './labels.js';
import { t } from '../i18n/index.js';

const TAU = Math.PI * 2;

// Nokta bulutu bölüşümü
const N_INNER = 2600;
const N_OUTER = 5400;
const N_SLOT = 1000;
const N_POINTS = N_INNER + N_OUTER + N_SLOT; // 9000

const R_MIN = 1.08; // nokta/kabuk için alt yarıçap (atmosfer üstü)
const OUTER_L_MAX = 7;
const OUTER_L_FLOOR = 2.8;
const INNER_L = [1.2, 2.4, 1.6]; // min, max, tepe
const SLOT_L = [2.3, 3.0, 2.65];

// Parçacıklar
const N_PART = 60;
const N_PROTON = 28; // 0..21 iç kuşak, 22..27 halka akımı protonları
const TRAIL = 10; // iz örnek sayısı
const TRAIL_STEP = 1 / 72; // iz örnekleme aralığı (görsel sn)
// İz solma tablosu: yaş 0 (baş) en parlak, en eski uç sönük
const TRAIL_FADE = Array.from({ length: TRAIL }, (_, k) => Math.pow(1 - k / (TRAIL - 1), 1.6) * 0.7);

// Taban saydamlıklar (parlaklık çarpanlarıyla çarpılır)
const A_INNER = 0.13;
const A_OUTER = 0.06;
const A_SLOT = 0.08;

// Sprite boyutu çarpanları (iç, dış, yarık) ve dış kuşak enlem üssü
const SIZE_MUL = [0.7, 2.2, 1.7];
const LAT_POWER_OUTER = 10;

// ---------------------------------------------------------------- yardımcılar

/** Tohumlu rastgele sayı üreteci (mulberry32) — kuşak her açılışta aynı görünür */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// cos^n enlem yoğunluğu için normalize kümülatif ve ters tablo (n = 6: iç kuşak/yarık; dış kuşakta daha dar)
function makeLatTable(power) {
  const N = 1024;
  const M = 512;
  const cdf = new Float32Array(N + 1);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const lam = -Math.PI / 2 + ((i + 0.5) / N) * Math.PI;
    acc += Math.pow(Math.cos(lam), power);
    cdf[i + 1] = acc;
  }
  for (let i = 1; i <= N; i++) cdf[i] /= acc;
  const inv = new Float32Array(M + 1);
  let j = 0;
  for (let k = 0; k <= M; k++) {
    const p = k / M;
    while (j < N - 1 && cdf[j + 1] < p) j++;
    const a = cdf[j];
    const b = cdf[j + 1];
    const t = b > a ? clamp((p - a) / (b - a), 0, 1) : 0;
    inv[k] = -Math.PI / 2 + ((j + t) / N) * Math.PI;
  }
  return { cdf, inv, N, M };
}

function latCdf(tab, lam) {
  const x = clamp((lam + Math.PI / 2) / Math.PI, 0, 1) * tab.N;
  const i = Math.min(tab.N - 1, Math.floor(x));
  return tab.cdf[i] + (tab.cdf[i + 1] - tab.cdf[i]) * (x - i);
}

function latInv(tab, p) {
  const x = clamp(p, 0, 1) * tab.M;
  const i = Math.min(tab.M - 1, Math.floor(x));
  return tab.inv[i] + (tab.inv[i + 1] - tab.inv[i]) * (x - i);
}

const LAT_TAB_INNER = makeLatTable(6);
const LAT_TAB_OUTER = makeLatTable(LAT_POWER_OUTER);

// L yoğunluk profili: asimetrik Gauss; kümülatif tablo ve ters örnekleme
const L_TABLE_N = 128;

function buildLProfile(table, lMin, lMax, peak, sl, sr) {
  const dl = (lMax - lMin) / L_TABLE_N;
  let acc = 0;
  table[0] = 0;
  for (let i = 0; i < L_TABLE_N; i++) {
    const l = lMin + (i + 0.5) * dl;
    const z = (l - peak) / (l < peak ? sl : sr);
    acc += Math.exp(-0.5 * z * z) + 0.03;
    table[i + 1] = acc;
  }
  for (let i = 1; i <= L_TABLE_N; i++) table[i] /= acc;
}

function sampleL(table, lMin, lMax, q) {
  let lo = 0;
  let hi = L_TABLE_N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < q) lo = mid;
    else hi = mid;
  }
  const a = table[lo];
  const b = table[hi];
  const t = b > a ? (q - a) / (b - a) : 0;
  return lMin + ((lo + t) / L_TABLE_N) * (lMax - lMin);
}

/** L kabuğunun yüzeye yakın kesildiği en büyük enlem (radyan) */
function latLimit(L, rMin = R_MIN) {
  return Math.acos(Math.sqrt(Math.min(rMin / Math.max(L, rMin * 1.001), 1)));
}

/** Dipol tuzağında sin²α₀ = B_ekvator / B_ayna = cos⁶λ / √(1 + 3 sin²λ) (ayna enlemi λ'da) */
function pitchSqAtMirror(lam) {
  const sl = Math.sin(lam);
  return Math.pow(Math.cos(lam), 6) / Math.sqrt(1 + 3 * sl * sl);
}

/** Ekvatoral eğim açısının karesinden ayna enlemi (radyan) — ikili arama */
function mirrorLatFromPitchSq(s2) {
  let lo = 0;
  let hi = Math.PI / 2;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (pitchSqAtMirror(mid) > s2) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Dünya-uzayı noktası kameradan Dünya küresi (r = 1) tarafından örtülüyor mu? (kamera–nokta doğru parçası ile küre kesişimi) */
function hiddenByEarth(px, py, pz, cam) {
  const dx = px - cam.x;
  const dy = py - cam.y;
  const dz = pz - cam.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return false;
  const t = clamp(-(cam.x * dx + cam.y * dy + cam.z * dz) / len2, 0, 1);
  const qx = cam.x + t * dx;
  const qy = cam.y + t * dy;
  const qz = cam.z + t * dz;
  return qx * qx + qy * qy + qz * qz < 0.98;
}

/** Kabuk yüzeyi: alan çizgisi (ρ, y) eğrisinin Y ekseni etrafında döndürülmesi */
function makeShellGeometry(L) {
  const lamMax = latLimit(L);
  const pts = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const lam = -lamMax + (2 * lamMax * i) / n;
    const c = Math.cos(lam);
    pts.push(new THREE.Vector2(L * c * c * c, L * c * c * Math.sin(lam)));
  }
  return new THREE.LatheGeometry(pts, 72);
}

// ---------------------------------------------------------------- GLSL

// Manyetopoz gölgelemesi (Shue): dünya konumu wp, r0 ve alpha ile → 1 içeride, 0 dışarıda
const MP_SHADOW_GLSL = /* glsl */ `
float mpInside(vec3 wp, float r0, float mpAlpha) {
  float rw = length(wp);
  float cosT = wp.x / max(rw, 1e-4);
  float rmp = r0 * pow(2.0 / max(1.0 + cosT, 0.03), mpAlpha);
  return 1.0 - smoothstep(rmp * 0.9, rmp, rw);
}
`;

const POINTS_VERT = /* glsl */ `
uniform float uScale;
uniform float uSize;
uniform float uTime;
uniform float uR0;
uniform float uMpAlpha;
uniform vec3 uColInner;
uniform vec3 uColOuter;
uniform vec3 uColSlot;
uniform vec3 uBr;
uniform vec3 uSizeMul;
attribute float aType;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
${MP_SHADOW_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float inside = mpInside(wp.xyz, uR0, uMpAlpha);

  vec3 col = uColSlot;
  float br = uBr.z;
  float sm = uSizeMul.z;
  if (aType < 0.5) {
    col = uColInner;
    br = uBr.x;
    sm = uSizeMul.x;
  } else if (aType < 1.5) {
    col = uColOuter;
    br = uBr.y;
    sm = uSizeMul.y;
  }

  float tw = 0.82 + 0.18 * sin(uTime * (0.6 + aSeed * 1.4) + aSeed * 40.0);
  vColor = col * (0.7 + 0.6 * aSeed);

  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.05);
  vAlpha = br * tw * inside * smoothstep(0.25, 1.4, depth); // kameraya çok yakın noktalar solar
  gl_PointSize = clamp(uSize * sm * (0.65 + 0.7 * aSeed) * uScale / depth, 1.5, 14.0);
}
`;

const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d2 = dot(c, c) * 4.0;
  float a = exp(-d2 * 4.0) * (1.0 - smoothstep(0.6, 1.0, d2));
  float al = a * vAlpha;
  if (al < 0.002) discard;
  gl_FragColor = vec4(vColor, al);
}
`;

const SHELL_VERT = /* glsl */ `
uniform float uR0;
uniform float uMpAlpha;
varying vec3 vN;
varying vec3 vV;
varying float vInside;
${MP_SHADOW_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vInside = mpInside(wp.xyz, uR0, uMpAlpha);
  vec4 mv = viewMatrix * wp;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
varying float vInside;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(clamp(f, 0.0, 1.0), 2.2);
  float a = (0.05 + 0.95 * rim) * uOpacity * vInside;
  gl_FragColor = vec4(uColor, a);
}
`;

const PART_VERT = /* glsl */ `
uniform float uScale;
uniform float uSize;
attribute vec3 aCol;
varying vec3 vCol;
void main() {
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale / max(-mv.z, 0.05), 2.5, 11.0);
}
`;

const PART_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d2 = dot(c, c) * 4.0;
  float core = exp(-d2 * 7.0);
  float halo = exp(-d2 * 2.5) * (1.0 - smoothstep(0.6, 1.0, d2));
  gl_FragColor = vec4(vCol, core + 0.35 * halo);
}
`;

// ---------------------------------------------------------------- katman

export class RadiationBeltLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'RadiationBeltLayer';
    ctx.scene.add(this.group);

    this._rnd = makeRng(20031029); // Halloween 2003
    this._time = 0;
    this._scale = 1000;
    this._size = new THREE.Vector2(1600, 900);
    this._basis = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
    this._negY = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._Lin = -1; // dış kuşak iç kenarı (son kurulum)
    this._Lpeak = 4.6;
    this._outerTable = new Float32Array(L_TABLE_N + 1);
    this._innerTable = new Float32Array(L_TABLE_N + 1);
    this._slotTable = new Float32Array(L_TABLE_N + 1);

    // Ortak uniform nesneleri (nokta + kabuk malzemeleri paylaşır)
    this._mp = { uR0: { value: 10.5 }, uMpAlpha: { value: 0.58 } };

    this._buildPoints();
    this._buildShells();
    this._buildParticles();
    this._buildLabels();
    this._rebuildOuter(Math.max(OUTER_L_FLOOR, ctx.state.derived.plasmapauseL - 0.3));
  }

  // ---- nokta bulutu
  _buildPoints() {
    const rnd = this._rnd;
    const n = N_POINTS;
    this._q = new Float32Array(n);
    this._w = new Float32Array(n);
    this._cphi = new Float32Array(n);
    this._sphi = new Float32Array(n);
    this._L = new Float32Array(n);
    const pos = new Float32Array(n * 3);
    const type = new Float32Array(n);
    const seed = new Float32Array(n);

    buildLProfile(this._innerTable, INNER_L[0], INNER_L[1], INNER_L[2], 0.22, 0.5);
    buildLProfile(this._slotTable, SLOT_L[0], SLOT_L[1], SLOT_L[2], 0.22, 0.22);

    for (let i = 0; i < n; i++) {
      this._q[i] = rnd();
      this._w[i] = rnd();
      const phi = rnd() * TAU;
      this._cphi[i] = Math.cos(phi);
      this._sphi[i] = Math.sin(phi);
      seed[i] = rnd();
      type[i] = i < N_INNER ? 0 : i < N_INNER + N_OUTER ? 1 : 2;
      if (i < N_INNER) this._L[i] = sampleL(this._innerTable, INNER_L[0], INNER_L[1], this._q[i]);
      else if (i >= N_INNER + N_OUTER) this._L[i] = sampleL(this._slotTable, SLOT_L[0], SLOT_L[1], this._q[i]);
      else this._L[i] = 4.5;
      if (i < N_INNER || i >= N_INNER + N_OUTER) this._placePoint(pos, i);
    }
    this._pos = pos;

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aType', new THREE.BufferAttribute(type, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this._posAttr = posAttr;

    const cIn = new THREE.Color(COLORS.innerBelt);
    const cOut = new THREE.Color(COLORS.outerBelt);
    const cSlot = new THREE.Color(COLORS.outerBelt).lerp(new THREE.Color(COLORS.innerBelt), 0.45);
    this._pointUniforms = {
      uScale: { value: this._scale },
      uSize: { value: 0.1 },
      uTime: { value: 0 },
      uR0: this._mp.uR0,
      uMpAlpha: this._mp.uMpAlpha,
      uColInner: { value: new THREE.Vector3(cIn.r, cIn.g, cIn.b) },
      uColOuter: { value: new THREE.Vector3(cOut.r, cOut.g, cOut.b) },
      uColSlot: { value: new THREE.Vector3(cSlot.r, cSlot.g, cSlot.b) },
      uBr: { value: new THREE.Vector3(A_INNER, A_OUTER, 0) },
      uSizeMul: { value: new THREE.Vector3(SIZE_MUL[0], SIZE_MUL[1], SIZE_MUL[2]) },
    };
    this._pointMat = new THREE.ShaderMaterial({
      uniforms: this._pointUniforms,
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this._pointMat);
    this.points.name = 'BeltPoints';
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** i. noktayı kendi L, enlem kuantili ve boylamıyla yerleştirir */
  _placePoint(pos, i) {
    const L = this._L[i];
    const lamMax = latLimit(L);
    const tab = i >= N_INNER && i < N_INNER + N_OUTER ? LAT_TAB_OUTER : LAT_TAB_INNER;
    const p0 = latCdf(tab, -lamMax);
    const p1 = latCdf(tab, lamMax);
    const lam = latInv(tab, p0 + (p1 - p0) * this._w[i]);
    const c = Math.cos(lam);
    const r = L * c * c;
    const rho = r * c;
    const k = i * 3;
    pos[k] = rho * this._cphi[i];
    pos[k + 1] = r * Math.sin(lam);
    pos[k + 2] = rho * this._sphi[i];
  }

  /** Plazmapoz değişince dış kuşağı yeniden örnekler (iç kenar Lin) */
  _rebuildOuter(Lin) {
    Lin = clamp(Lin, OUTER_L_FLOOR, OUTER_L_MAX - 0.8);
    this._Lin = Lin;
    const peak = Math.max(4.5, Lin + 0.4);
    this._Lpeak = peak;
    buildLProfile(this._outerTable, Lin, OUTER_L_MAX, peak, Math.max(0.45, (peak - Lin) * 0.55), 1.0);
    const a = N_INNER;
    const b = N_INNER + N_OUTER;
    for (let i = a; i < b; i++) {
      this._L[i] = sampleL(this._outerTable, Lin, OUTER_L_MAX, this._q[i]);
      this._placePoint(this._pos, i);
    }
    this._posAttr.needsUpdate = true;
    if (this._lblOuter) this._lblOuter.position.set(0, 0, peak);
  }

  // ---- yarı saydam kabuklar
  _buildShells() {
    const mk = (L, color, name) => {
      const c = new THREE.Color(color);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uR0: this._mp.uR0,
          uMpAlpha: this._mp.uMpAlpha,
          uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
          uOpacity: { value: 0.1 },
        },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(makeShellGeometry(L), mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.shellInner = mk(1.6, COLORS.innerBelt, 'BeltShellInner');
    this.shellOuter = mk(4.5, COLORS.outerBelt, 'BeltShellOuter');
  }

  // ---- tuzaklanmış parçacıklar
  _buildParticles() {
    const rnd = this._rnd;
    const n = N_PART;
    this._pL = new Float32Array(n);
    this._pLamM = new Float32Array(n);
    this._pBPh = new Float32Array(n);
    this._pBOm = new Float32Array(n);
    this._pPhi = new Float32Array(n);
    this._pDOm = new Float32Array(n);
    this._pGPh = new Float32Array(n);
    this._pGOm = new Float32Array(n);
    this._pRg = new Float32Array(n);
    this._pVis = new Float32Array(n).fill(1);
    this._pCur = new Float32Array(n * 3); // anlık konum (grup-yerel)
    this._pProton = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const proton = i < N_PROTON;
      let L;
      if (proton) L = i < 22 ? 1.4 + 1.1 * rnd() : 3.5 + 2.0 * rnd();
      else L = i < N_PROTON + 28 ? 3.3 + 2.7 * rnd() : 1.6 + 0.7 * rnd();
      // Ekvatoral eğim açısı yitim konisinin (ayna yüzeyin üstünde kalacak) dışında seçilir → ayna enlemi λm
      const lamLim = latLimit(L, 1.12) * 0.95;
      const s2lo = pitchSqAtMirror(lamLim);
      const s2hi = pitchSqAtMirror(0.15);
      this._pL[i] = L;
      this._pLamM[i] = mirrorLatFromPitchSq(s2lo + (s2hi - s2lo) * rnd());
      this._pBPh[i] = rnd() * TAU;
      this._pBOm[i] = TAU / (1.0 + rnd()); // sıçrama periyodu 1–2 sn
      this._pPhi[i] = rnd() * TAU;
      const Td = (40 - (20 * (L - 1.4)) / 4.6) * (0.85 + 0.3 * rnd()); // sürüklenme periyodu 20–40 sn
      // Protonlar batıya (artan φ), elektronlar doğuya sürüklenir
      this._pDOm[i] = (proton ? 1 : -1) * (TAU / Td);
      this._pGPh[i] = rnd() * TAU;
      this._pGOm[i] = (proton ? -1 : 1) * (11 + 5 * rnd());
      this._pRg[i] = (0.03 + 0.012 * L) * (0.8 + 0.4 * rnd());
      this._pProton[i] = proton ? 1 : 0;
    }

    // Parçacık baş noktaları
    const hp = new Float32Array(n * 3);
    const hc = new Float32Array(n * 3);
    const hgeo = new THREE.BufferGeometry();
    const hpa = new THREE.BufferAttribute(hp, 3);
    hpa.setUsage(THREE.DynamicDrawUsage);
    const hca = new THREE.BufferAttribute(hc, 3);
    hca.setUsage(THREE.DynamicDrawUsage);
    hgeo.setAttribute('position', hpa);
    hgeo.setAttribute('aCol', hca);
    this._headPos = hpa;
    this._headCol = hca;
    this._partUniforms = { uScale: { value: this._scale }, uSize: { value: 0.16 } };
    this.partPoints = new THREE.Points(
      hgeo,
      new THREE.ShaderMaterial({
        uniforms: this._partUniforms,
        vertexShader: PART_VERT,
        fragmentShader: PART_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.partPoints.name = 'TrappedParticles';
    this.partPoints.frustumCulled = false;
    this.group.add(this.partPoints);

    // İzler (tek LineSegments)
    this._trailRing = new Float32Array(n * TRAIL * 3);
    this._thead = 0;
    this._trailAcc = 0;
    const segVerts = n * (TRAIL - 1) * 2;
    const tp = new Float32Array(segVerts * 3);
    const tc = new Float32Array(segVerts * 3);
    const tgeo = new THREE.BufferGeometry();
    const tpa = new THREE.BufferAttribute(tp, 3);
    tpa.setUsage(THREE.DynamicDrawUsage);
    const tca = new THREE.BufferAttribute(tc, 3);
    tca.setUsage(THREE.DynamicDrawUsage);
    tgeo.setAttribute('position', tpa);
    tgeo.setAttribute('color', tca);
    this._trailPos = tpa;
    this._trailCol = tca;
    this.trails = new THREE.LineSegments(
      tgeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.trails.name = 'TrappedTrails';
    this.trails.frustumCulled = false;
    this.group.add(this.trails);

    this._protonRGB = new THREE.Color(0xff6a2e);
    this._electronRGB = new THREE.Color(0x9a86ff);

    // İlk konumları hesapla ve izleri doldur
    this._stepParticles(0, 1);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < TRAIL; k++) {
        const o = (i * TRAIL + k) * 3;
        this._trailRing[o] = this._pCur[i * 3];
        this._trailRing[o + 1] = this._pCur[i * 3 + 1];
        this._trailRing[o + 2] = this._pCur[i * 3 + 2];
      }
    }
  }

  /** Kılavuz merkez hareketi + jirasyon; sonuç this._pCur (grup-yerel) */
  _stepParticles(dt, polarity) {
    const n = N_PART;
    for (let i = 0; i < n; i++) {
      this._pBPh[i] = (this._pBPh[i] + this._pBOm[i] * dt) % TAU;
      this._pPhi[i] = (this._pPhi[i] + this._pDOm[i] * polarity * dt) % TAU;
      this._pGPh[i] = (this._pGPh[i] + this._pGOm[i] * dt) % TAU;

      const L = this._pL[i];
      const lam = this._pLamM[i] * Math.sin(this._pBPh[i]);
      const c = Math.cos(lam);
      const sl = Math.sin(lam);
      const cp = Math.cos(this._pPhi[i]);
      const sp = Math.sin(this._pPhi[i]);
      const r = L * c * c;
      const rho = r * c;

      // B yönüne dik iki birim vektör: n1 = e_φ, n2 = b̂ × n1
      const bn = 1 / Math.sqrt(1 + 3 * sl * sl);
      const by = 1 + sl * sl;
      const rg = this._pRg[i] * (0.6 + 0.4 * bn);
      const cg = Math.cos(this._pGPh[i]) * rg;
      const sg = Math.sin(this._pGPh[i]) * rg * bn;

      const k = i * 3;
      this._pCur[k] = rho * cp - cg * sp + sg * by * cp;
      this._pCur[k + 1] = r * sl - sg * sl * c;
      this._pCur[k + 2] = rho * sp + cg * cp + sg * by * sp;
    }
  }

  // ---- etiketler
  _buildLabels() {
    this._lblInner = makeLabel(t('scene.belts.inner'), 'small');
    this._lblInner.position.set(0, 0, 1.6);
    this._lblOuter = makeLabel(t('scene.belts.outer'), 'small');
    this._lblOuter.position.set(0, 0, this._Lpeak);
    this._lblSlot = makeLabel(t('scene.belts.slot'), 'warn');
    this._lblSlot.position.set(0, 0, -SLOT_L[2]);
    this._lblSlot.visible = false;
    this.group.add(this._lblInner, this._lblOuter, this._lblSlot);
  }

  // ---- her kare
  update(visDt = 0, simDt = 0, realDt = 0) {
    const ctx = this.ctx;
    const st = ctx.state;
    const d = st.derived;

    const M = Math.abs(d.dipoleMoment);
    const fade = smoothstep(0.03, 0.2, M); // alan ~0 iken kuşaklar yok olur
    const show = !!st.params.layers.radiationBelts && fade > 0.01;
    this.group.visible = show;
    if (!show) return;

    this._time += realDt;

    // Grup yönelimi: +Y → dipol ekseni, +X → manyetik öğle; ölçek ∝ M^(1/3)
    magneticBasis(st.frame, this._basis);
    this._negY.copy(this._basis.y).negate();
    this._m4.makeBasis(this._basis.x, this._basis.z, this._negY);
    this.group.quaternion.setFromRotationMatrix(this._m4);
    this.group.scale.setScalar(clamp(Math.cbrt(M), 0.05, 2));
    this.group.updateMatrixWorld(true);

    // Plazmapoz dış kuşağın iç kenarını belirler (kenetlenmiş değerle karşılaştır: sınırda her karede yeniden örnekleme olmasın)
    const Lin = clamp(Math.max(OUTER_L_FLOOR, d.plasmapauseL - 0.3), OUTER_L_FLOOR, OUTER_L_MAX - 0.8);
    if (Math.abs(Lin - this._Lin) > 0.04) this._rebuildOuter(Lin);

    // Nokta boyutu için piksel ölçeği
    const renderer = ctx.renderer;
    renderer.getSize(this._size);
    const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    this._scale = (pr * Math.max(this._size.y, 1)) / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));

    // Parlaklık düzeyleri
    const lvIn = clamp(d.belts.inner, 0, 2) * fade;
    const lvOut = clamp(d.belts.outer, 0, 3.2) * fade;
    const lvSlot = clamp(d.belts.slot, 0, 1) * fade;

    const pu = this._pointUniforms;
    pu.uScale.value = this._scale;
    pu.uTime.value = this._time;
    pu.uBr.value.set(A_INNER * lvIn, A_OUTER * lvOut, A_SLOT * lvSlot);
    this._mp.uR0.value = Math.max(d.r0, 1.0);
    this._mp.uMpAlpha.value = d.alpha;

    this.shellInner.material.uniforms.uOpacity.value = 0.045 * Math.min(lvIn, 1.5);
    this.shellOuter.material.uniforms.uOpacity.value = 0.03 * Math.min(lvOut, 1.8);

    // Etiketler: kuşak sönükse veya Dünya'nın arkasında kalıyorsa gizle (CSS2D derinlik denemez)
    const cam = ctx.camera.position;
    const me = this._lblInner.matrixWorld.elements;
    const oe = this._lblOuter.matrixWorld.elements;
    const se = this._lblSlot.matrixWorld.elements;
    this._lblInner.visible = lvIn > 0.1 && !hiddenByEarth(me[12], me[13], me[14], cam);
    this._lblOuter.visible = lvOut > 0.1 && !hiddenByEarth(oe[12], oe[13], oe[14], cam);
    this._lblSlot.visible = d.belts.slot > 0.3 && !hiddenByEarth(se[12], se[13], se[14], cam);

    this._updateParticles(visDt, realDt, d, lvIn, lvOut);
  }

  _updateParticles(visDt, realDt, d, lvIn, lvOut) {
    const n = N_PART;
    const pol = d.dipoleMoment >= 0 ? 1 : -1;
    this._stepParticles(visDt, pol);

    // İz örnekleme: yeni yuva açılır, anlık konum her kare en yeni yuvaya yazılır
    this._trailAcc += visDt;
    if (this._trailAcc >= TRAIL_STEP) {
      this._trailAcc = visDt > 0 ? this._trailAcc % TRAIL_STEP : 0;
      this._thead = (this._thead + 1) % TRAIL;
    }

    const ring = this._trailRing;
    const hp = this._headPos.array;
    const hc = this._headCol.array;
    const tp = this._trailPos.array;
    const tc = this._trailCol.array;
    const mw = this.group.matrixWorld;
    const v = this._v;
    const follow = Math.min(1, realDt * 6);
    const pc = this._protonRGB;
    const ec = this._electronRGB;
    const th = this._thead;

    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const x = this._pCur[k];
      const y = this._pCur[k + 1];
      const z = this._pCur[k + 2];

      // Manyetopoz dışına çıkan parçacık sönümlenir
      v.set(x, y, z).applyMatrix4(mw);
      const inside = insideMagnetopause(v.x, v.y, v.z, d.r0, d.alpha) ? 1 : 0;
      this._pVis[i] += (inside - this._pVis[i]) * follow;
      const proton = this._pProton[i] === 1;
      const level = proton ? Math.min(lvIn, 1.3) : Math.min(lvOut, 1.6);
      const b = this._pVis[i] * level;
      const base = proton ? pc : ec;
      const cr = base.r * b * 1.5;
      const cg = base.g * b * 1.5;
      const cb = base.b * b * 1.5;

      hp[k] = x;
      hp[k + 1] = y;
      hp[k + 2] = z;
      hc[k] = cr;
      hc[k + 1] = cg;
      hc[k + 2] = cb;

      // en yeni yuva = anlık konum
      const ro = (i * TRAIL + th) * 3;
      ring[ro] = x;
      ring[ro + 1] = y;
      ring[ro + 2] = z;

      // iz doğruları: yaş s (yeni) → s+1 (eski)
      for (let s = 0; s < TRAIL - 1; s++) {
        const a0 = (i * TRAIL + ((th - s + TRAIL) % TRAIL)) * 3;
        const a1 = (i * TRAIL + ((th - s - 1 + TRAIL) % TRAIL)) * 3;
        const o = ((i * (TRAIL - 1) + s) * 2) * 3;
        tp[o] = ring[a0];
        tp[o + 1] = ring[a0 + 1];
        tp[o + 2] = ring[a0 + 2];
        tp[o + 3] = ring[a1];
        tp[o + 4] = ring[a1 + 1];
        tp[o + 5] = ring[a1 + 2];
        const f0 = TRAIL_FADE[s];
        const f1 = TRAIL_FADE[s + 1];
        tc[o] = cr * f0;
        tc[o + 1] = cg * f0;
        tc[o + 2] = cb * f0;
        tc[o + 3] = cr * f1;
        tc[o + 4] = cg * f1;
        tc[o + 5] = cb * f1;
      }
    }
    this._headPos.needsUpdate = true;
    this._headCol.needsUpdate = true;
    this._trailPos.needsUpdate = true;
    this._trailCol.needsUpdate = true;
    this._partUniforms.uScale.value = this._scale;
  }

  dispose() {
    for (const lbl of [this._lblInner, this._lblOuter, this._lblSlot]) {
      this.group.remove(lbl);
      lbl.element.remove();
    }
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.ctx.scene.remove(this.group);
  }
}
