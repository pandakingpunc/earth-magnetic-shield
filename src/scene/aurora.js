// Auroralar: manyetik koordinatlarda kuzey/güney oval, dikey perde (curtain) şeritleri, yüzeyde
// yaygın (diffüz) parıltı, kalkan yokken gündüz yarıküresinde sönük genel parıltı ve
// Türkiye şehir işaretleri (İstanbul / Ankara).

import * as THREE from 'three';
import { TURKISH_CITIES } from '../core/constants.js';
import {
  DEG, clamp, smoothstep, latLonToLocal, localToWorld, magneticBasis, magneticLatitudeDeg,
} from '../core/geo.js';
import { auroraVisibility } from '../physics/indices.js';
import { makeLabel, setLabelVariant } from './labels.js';
import { t } from '../i18n/index.js';

const TAU = Math.PI * 2;

const N_SEG = 256; // oval boyunca MLT dilimi
const COLS = N_SEG + 1; // dikiş için tekrarlanan son sütun
const N_BAND = 3; // eş merkezli perde sayısı
const GLOW_ROWS = 7; // yüzey parıltısı enlem satırı
const R_BOTTOM = 1.016; // perde tabanı (~100 km)
const R_TOP = 1.07; // perde tepesi (abartılı)
const R_GLOW = 1.012; // yüzey parıltısı
const R_GLOBAL = 1.025; // kalkan yokken genel parıltı kabuğu
const REBUILD_EVERY = 2; // halka köşelerini kaç karede bir yenile
const R_CITY = 1.003;

// ---------------------------------------------------------------- GLSL

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`;

const CURTAIN_VERT = /* glsl */ `
attribute float aMlt;
attribute float aV;
attribute float aBand;
attribute float aHem;
varying float vMlt;
varying float vV;
varying float vBand;
varying float vHem;
void main() {
  vMlt = aMlt;
  vV = aV;
  vBand = aBand;
  vHem = aHem;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CURTAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform float uRed;
uniform float uPurple;
uniform float uFade;
uniform float uNight;
uniform float uSurge;
uniform float uSurgeMlt;
varying float vMlt;
varying float vV;
varying float vBand;
varying float vHem;
${NOISE_GLSL}
void main() {
  // MSAA'da parça gölgelendirici üçgen dışındaki örnek noktalarında da çalışabilir: ara değer [0,1] dışına
  // taşarsa exp(-vV·k) sonsuza gider ve bloom tüm ekranı karartır → sıkıştır.
  float v = clamp(vV, 0.0, 1.0);
  float mlt = mod(vMlt, 24.0);
  float ang = mlt / 24.0 * 6.2831853;
  vec2 cr = vec2(cos(ang), sin(ang));
  float seed = vBand * 7.13 + vHem * 3.71;

  // dikey ışınlar (oval boyunca yüksek frekanslı gürültü, zamanla kayar)
  float rA = vnoise(vec3(cr * 36.0 + seed, uTime * 0.30));
  float rB = vnoise(vec3(cr * 92.0 - seed, uTime * 0.85 + 4.0));
  float rayPat = mix(0.14, 1.0, smoothstep(0.25, 0.8, rA * 0.65 + rB * 0.35));

  // ışın yükseklikleri: bazı ışınlar kırmızı tepeye kadar uzanır
  float hRay = 0.35 + 0.65 * vnoise(vec3(cr * 15.0 + seed * 2.0, uTime * 0.18 + 9.0));
  float hMask = 1.0 - smoothstep(hRay * 0.55, hRay + 0.05, v);

  // yavaş kıvrımlar ve titreme
  float fold = 0.5 + 0.5 * sin(ang * 6.0 + uTime * 0.55 + seed + 5.0 * vnoise(vec3(cr * 3.0, uTime * 0.12)));
  fold = mix(0.45, 1.0, fold);
  float flick = 0.88 + 0.12 * sin(uTime * 9.0 + rA * 30.0);

  // düşey renk profili: alçakta yeşil (557.7 nm), yüksekte kırmızı (630 nm), alt saçak mor
  float edge = exp(-v * 15.0);
  float low = exp(-v * 3.0);
  float topFade = 1.0 - smoothstep(0.78, 1.0, v);
  vec3 green = vec3(0.30, 1.00, 0.50) * (0.45 * low + 0.7 * edge);
  vec3 red = vec3(1.00, 0.20, 0.30) * smoothstep(0.42, 0.95, v) * 0.85 * uRed;
  vec3 purple = vec3(0.80, 0.30, 1.00) * exp(-v * 22.0) * 1.2 * uPurple;
  vec3 col = (green + purple) * hMask + red * mix(0.35, 1.0, hMask);
  col *= topFade;

  // MLT ağırlığı: gece tarafı güçlü, gündüz tarafı sönük
  float nightF = 0.5 - 0.5 * cos((mlt - 12.0) / 24.0 * 6.2831853);
  float mlw = mix(0.16, 1.0, smoothstep(0.15, 0.7, nightF));

  // alt fırtına: gece yarısında parlama + batıya ilerleyen dalga
  float dm = abs(mod(mlt + 12.0, 24.0) - 12.0);
  float dSurge = abs(mod(mlt - uSurgeMlt + 12.0, 24.0) - 12.0);
  float boost = 1.0 + 0.7 * uNight * exp(-dm * dm / 18.0) + 1.0 * uSurge * exp(-dSurge * dSurge / 5.0);

  float bandW = 1.0 - 0.25 * abs(vBand - 1.0);
  float I = min(uGain * mlw * boost * bandW * fold * flick * uFade, 1.8);
  gl_FragColor = vec4(col * rayPat * I, 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
attribute float aMlt;
attribute float aF;
attribute float aHem;
varying float vMlt;
varying float vF;
varying float vHem;
void main() {
  vMlt = aMlt;
  vF = aF;
  vHem = aHem;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform float uFade;
uniform float uNight;
varying float vMlt;
varying float vF;
varying float vHem;
${NOISE_GLSL}
void main() {
  float mlt = mod(vMlt, 24.0);
  float ang = mlt / 24.0 * 6.2831853;
  vec2 cr = vec2(cos(ang), sin(ang));
  float bump = smoothstep(-0.25, 0.08, vF) * (1.0 - smoothstep(0.45, 1.25, vF));
  float blot = mix(0.55, 1.0, vnoise(vec3(cr * 7.0 + vHem * 5.0, uTime * 0.12)));
  float nightF = 0.5 - 0.5 * cos((mlt - 12.0) / 24.0 * 6.2831853);
  float mlw = mix(0.12, 1.0, smoothstep(0.15, 0.7, nightF));
  float dm = abs(mod(mlt + 12.0, 24.0) - 12.0);
  float boost = 1.0 + 0.8 * uNight * exp(-dm * dm / 18.0);
  float I = uGain * 0.16 * bump * blot * mlw * boost * uFade;
  gl_FragColor = vec4(vec3(0.12, 0.85, 0.42) * I, 1.0);
}
`;

const GLOBAL_VERT = /* glsl */ `
varying vec3 vNw;
varying vec3 vN;
varying vec3 vV;
void main() {
  vNw = normalize(mat3(modelMatrix) * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const GLOBAL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec3 vNw;
varying vec3 vN;
varying vec3 vV;
${NOISE_GLSL}
void main() {
  float day = smoothstep(-0.25, 0.85, vNw.x);
  float rim = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.5);
  float blot = mix(0.6, 1.0, vnoise(vNw * 4.0 + vec3(uTime * 0.08)));
  float a = uStrength * (0.15 + 0.85 * rim) * (0.12 + 0.88 * day) * blot;
  gl_FragColor = vec4(vec3(0.35, 0.85, 0.75) * a, 1.0);
}
`;

const CITY_VERT = /* glsl */ `
uniform float uScale;
uniform float uTime;
attribute float aGlow;
attribute float aId;
varying float vGlow;
varying float vFacing;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(wp.xyz);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vFacing = smoothstep(0.0, 0.12, dot(n, toCam));
  vGlow = aGlow;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  float pulse = 1.0 + 0.25 * aGlow * sin(uTime * 3.0 + aId * 2.0);
  float px = clamp(0.035 * uScale / max(-mv.z, 0.05), 4.0, 16.0);
  gl_PointSize = px * pulse * (1.0 + 0.5 * aGlow);
}
`;

const CITY_FRAG = /* glsl */ `
varying float vGlow;
varying float vFacing;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d2 = dot(c, c) * 4.0;
  float core = 1.0 - smoothstep(0.0, 0.35, d2);
  float halo = exp(-d2 * 3.0) * (1.0 - smoothstep(0.7, 1.0, d2));
  vec3 base = mix(vec3(1.0, 0.78, 0.35), vec3(0.3, 1.0, 0.5), vGlow);
  float a = (core + halo * 0.5) * vFacing;
  if (a < 0.003) discard;
  gl_FragColor = vec4(base * (1.0 + 0.4 * vGlow), a);
}
`;

// ---------------------------------------------------------------- katman

const GLOW_BY_STATUS = { none: 0, horizon: 0.45, visible: 0.85, overhead: 1 };

export class AuroraLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'AuroraLayer';
    ctx.scene.add(this.group);

    this._time = 0;
    this._frame = 0;
    this._scale = 1000;
    this._size = new THREE.Vector2(1600, 900);
    this._basis = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };

    // MLT sütunları: ψ = 0 öğle; sütun 0 öğlede (dikiş gündüz tarafında kalır)
    this._cosPsi = new Float32Array(COLS);
    this._sinPsi = new Float32Array(COLS);
    for (let c = 0; c < COLS; c++) {
      const psi = (TAU * (c % N_SEG)) / N_SEG;
      this._cosPsi[c] = Math.cos(psi);
      this._sinPsi[c] = Math.sin(psi);
    }

    // Perde ve yüzey parıltısı için ortak uniform nesneleri
    this._u = {
      uTime: { value: 0 },
      uGain: { value: 0.5 },
      uRed: { value: 0 },
      uPurple: { value: 0 },
      uFade: { value: 1 },
      uNight: { value: 0 },
      uSurge: { value: 0 },
      uSurgeMlt: { value: 0 },
    };

    this._buildCurtains();
    this._buildGlow();
    this._buildGlobalGlow();
    this._buildCities();

    this._lblOval = makeLabel(t('scene.aurora.oval'), 'small');
    this.group.add(this._lblOval);

    this._rebuild(ctx.state.derived, 1);
  }

  // ---- perde şeritleri
  _buildCurtains() {
    const rings = 2 * N_BAND;
    const nv = rings * COLS * 2;
    const aMlt = new Float32Array(nv);
    const aV = new Float32Array(nv);
    const aBand = new Float32Array(nv);
    const aHem = new Float32Array(nv);
    const idx = new Uint16Array(rings * N_SEG * 6);
    let ii = 0;
    for (let h = 0; h < 2; h++) {
      for (let b = 0; b < N_BAND; b++) {
        const ring = h * N_BAND + b;
        for (let c = 0; c < COLS; c++) {
          const v = (ring * COLS + c) * 2;
          const mlt = 12 + (24 * c) / N_SEG;
          for (let k = 0; k < 2; k++) {
            aMlt[v + k] = mlt;
            aV[v + k] = k;
            aBand[v + k] = b;
            aHem[v + k] = h;
          }
          if (c < N_SEG) {
            const a = v;
            const t = v + 1;
            const a2 = v + 2;
            const t2 = v + 3;
            idx[ii++] = a;
            idx[ii++] = t;
            idx[ii++] = a2;
            idx[ii++] = t;
            idx[ii++] = t2;
            idx[ii++] = a2;
          }
        }
      }
    }
    this._curPos = new Float32Array(nv * 3);
    const geo = new THREE.BufferGeometry();
    this._curAttr = new THREE.BufferAttribute(this._curPos, 3);
    this._curAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._curAttr);
    geo.setAttribute('aMlt', new THREE.BufferAttribute(aMlt, 1));
    geo.setAttribute('aV', new THREE.BufferAttribute(aV, 1));
    geo.setAttribute('aBand', new THREE.BufferAttribute(aBand, 1));
    geo.setAttribute('aHem', new THREE.BufferAttribute(aHem, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.curtains = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this._u,
        vertexShader: CURTAIN_VERT,
        fragmentShader: CURTAIN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.curtains.name = 'AuroraCurtains';
    this.curtains.frustumCulled = false;
    this.group.add(this.curtains);
  }

  // ---- yüzeydeki yaygın parıltı bandı
  _buildGlow() {
    const nv = 2 * COLS * GLOW_ROWS;
    const aMlt = new Float32Array(nv);
    const aF = new Float32Array(nv);
    const aHem = new Float32Array(nv);
    const idx = new Uint16Array(2 * N_SEG * (GLOW_ROWS - 1) * 6);
    let ii = 0;
    for (let h = 0; h < 2; h++) {
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < GLOW_ROWS; r++) {
          const v = (h * COLS + c) * GLOW_ROWS + r;
          aMlt[v] = 12 + (24 * c) / N_SEG;
          aF[v] = -0.3 + (1.6 * r) / (GLOW_ROWS - 1);
          aHem[v] = h;
          if (c < N_SEG && r < GLOW_ROWS - 1) {
            const a = v;
            const b = v + 1;
            const a2 = v + GLOW_ROWS;
            const b2 = b + GLOW_ROWS;
            idx[ii++] = a;
            idx[ii++] = b;
            idx[ii++] = a2;
            idx[ii++] = b;
            idx[ii++] = b2;
            idx[ii++] = a2;
          }
        }
      }
    }
    this._glowPos = new Float32Array(nv * 3);
    const geo = new THREE.BufferGeometry();
    this._glowAttr = new THREE.BufferAttribute(this._glowPos, 3);
    this._glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._glowAttr);
    geo.setAttribute('aMlt', new THREE.BufferAttribute(aMlt, 1));
    geo.setAttribute('aF', new THREE.BufferAttribute(aF, 1));
    geo.setAttribute('aHem', new THREE.BufferAttribute(aHem, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.glow = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this._u,
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.glow.name = 'AuroraGlow';
    this.glow.frustumCulled = false;
    this.group.add(this.glow);
  }

  // ---- kalkan yokken gündüz üst atmosferinde sönük genel parıltı
  _buildGlobalGlow() {
    this._gu = { uTime: { value: 0 }, uStrength: { value: 0 } };
    this.globalGlow = new THREE.Mesh(
      new THREE.SphereGeometry(R_GLOBAL, 48, 32),
      new THREE.ShaderMaterial({
        uniforms: this._gu,
        vertexShader: GLOBAL_VERT,
        fragmentShader: GLOBAL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.globalGlow.name = 'AuroraGlobalGlow';
    this.globalGlow.visible = false;
    this.globalGlow.frustumCulled = false;
    this.group.add(this.globalGlow);
  }

  // ---- şehir işaretleri (İstanbul, Ankara)
  _buildCities() {
    this._cities = [TURKISH_CITIES[0], TURKISH_CITIES[1]];
    this._cityLocal = this._cities.map((c) => latLonToLocal(c.lat, c.lon, R_CITY));
    this._cityWorld = this._cities.map(() => new THREE.Vector3());
    this._cityGlow = [0, 0];

    const geo = new THREE.BufferGeometry();
    this._cityPosAttr = new THREE.BufferAttribute(new Float32Array(6), 3);
    this._cityPosAttr.setUsage(THREE.DynamicDrawUsage);
    this._cityGlowAttr = new THREE.BufferAttribute(new Float32Array(2), 1);
    this._cityGlowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._cityPosAttr);
    geo.setAttribute('aGlow', this._cityGlowAttr);
    geo.setAttribute('aId', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
    this._cityU = { uScale: { value: this._scale }, uTime: { value: 0 } };
    this.cityPoints = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this._cityU,
        vertexShader: CITY_VERT,
        fragmentShader: CITY_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false, // arka yüzde olanlar köşe gölgelendiricisinde elenir (z-çakışması yok)
        blending: THREE.AdditiveBlending,
      }),
    );
    this.cityPoints.name = 'TurkeyCityMarkers';
    this.cityPoints.frustumCulled = false;
    this.cityPoints.renderOrder = 5;
    this.group.add(this.cityPoints);

    this._lblIst = makeLabel(t('scene.aurora.ist.none'), 'small');
    this._lblIstText = '';
    this.group.add(this._lblIst);
    // şehirler Dünya ile döner: ilk konumları hemen yerleştir
    this._updateCities(this.ctx.state, this.ctx.state.derived, 0, 0);
  }

  /** Oval köşelerini yeniden hesaplar (manyetik çerçeve, auroraLat/Width, alt fırtına) */
  _rebuild(d, hs) {
    const basis = magneticBasis(this.ctx.state.frame, this._basis);
    const bx = basis.x;
    const by = basis.y;
    const bz = basis.z;
    const baseLat = clamp(Number.isFinite(d.auroraLat) ? d.auroraLat : 63, 5, 85);
    const width = clamp(Number.isFinite(d.auroraWidth) ? d.auroraWidth : 5, 1, 20);
    const ns = clamp(Number.isFinite(d.reconnection.nightside) ? d.reconnection.nightside : 0, 0, 1);
    const rTop = R_BOTTOM + (R_TOP - R_BOTTOM) * hs;
    const cur = this._curPos;
    const glow = this._glowPos;

    for (let col = 0; col < COLS; col++) {
      const cP = this._cosPsi[col];
      const sP = this._sinPsi[col];
      const ex = cP * bx.x + sP * by.x;
      const ey = cP * bx.y + sP * by.y;
      const ez = cP * bx.z + sP * by.z;
      const nightF = 0.5 - 0.5 * cP;
      const dmid = Math.abs(col - N_SEG * 0.5) * (24 / N_SEG);
      // ekvator tarafı sınırı: gece yarısı daha alçak enlem; genişlik gece daha büyük
      const latEq = baseLat + 3.5 * (0.5 + 0.5 * cP);
      const w = width * (1 + 0.6 * nightF) * (1 + 0.5 * ns * Math.exp((-dmid * dmid) / 18));

      for (let b = 0; b < N_BAND; b++) {
        const lat = Math.min(latEq + (w * (b + 0.5)) / N_BAND, 88.5) * DEG;
        const cl = Math.cos(lat);
        const sl = Math.sin(lat);
        const ux = cl * ex;
        const uy = cl * ey;
        const uz = cl * ez;
        for (let h = 0; h < 2; h++) {
          const s = h === 0 ? sl : -sl;
          const nx = ux + s * bz.x;
          const ny = uy + s * bz.y;
          const nz = uz + s * bz.z;
          const o = (((h * N_BAND + b) * COLS + col) * 2) * 3;
          cur[o] = nx * R_BOTTOM;
          cur[o + 1] = ny * R_BOTTOM;
          cur[o + 2] = nz * R_BOTTOM;
          cur[o + 3] = nx * rTop;
          cur[o + 4] = ny * rTop;
          cur[o + 5] = nz * rTop;
        }
      }

      for (let r = 0; r < GLOW_ROWS; r++) {
        const f = -0.3 + (1.6 * r) / (GLOW_ROWS - 1);
        const lat = clamp(latEq + w * f, 3, 88.8) * DEG;
        const cl = Math.cos(lat);
        const sl = Math.sin(lat);
        for (let h = 0; h < 2; h++) {
          const s = h === 0 ? sl : -sl;
          const o = ((h * COLS + col) * GLOW_ROWS + r) * 3;
          glow[o] = (cl * ex + s * bz.x) * R_GLOW;
          glow[o + 1] = (cl * ey + s * bz.y) * R_GLOW;
          glow[o + 2] = (cl * ez + s * bz.z) * R_GLOW;
        }
      }
    }
    this._curAttr.needsUpdate = true;
    this._glowAttr.needsUpdate = true;

    // 'Aurora ovali' etiketi: kuzey oval, orta perde, şafak tarafı (MLT 6 → sütun 3N/4), tepe köşesi
    const ringIdx = 0 * N_BAND + 1;
    const o = (((ringIdx * COLS + Math.round(N_SEG * 0.75)) * 2) + 1) * 3;
    this._lblOval.position.set(cur[o], cur[o + 1], cur[o + 2]);
  }

  /** Şehir işaretlerini Dünya ile birlikte döndürür; İstanbul etiketini ve parıltısını günceller */
  _updateCities(state, d, realDt, camDist, ovalFade = 1) {
    const cam = this.ctx.camera.position;
    const pos = this._cityPosAttr.array;
    for (let i = 0; i < 2; i++) {
      const w = localToWorld(this._cityLocal[i], state.frame, this._cityWorld[i]);
      pos[i * 3] = w.x;
      pos[i * 3 + 1] = w.y;
      pos[i * 3 + 2] = w.z;

      // Aurora görünürlüğü: İstanbul için türetilmiş durum; Ankara kendi manyetik enleminden
      const status = i === 0
        ? d.turkeyAurora
        : auroraVisibility(magneticLatitudeDeg(w, state.frame), d.auroraLat);
      // Gündüz aurora görülemez: işaret parıltısı Güneş yüksekliğine göre söner (0° → soluk, −12° ve altı → tam)
      const sunElev = Math.asin(clamp(w.x / (w.length() || 1), -1, 1)) / DEG;
      const dark = smoothstep(0, -12, sunElev);
      const target = (GLOW_BY_STATUS[status] ?? 0) * ovalFade * (0.25 + 0.75 * dark);
      this._cityGlow[i] += (target - this._cityGlow[i]) * Math.min(1, realDt * 4 + (realDt === 0 ? 1 : 0));
      this._cityGlowAttr.array[i] = this._cityGlow[i];
    }
    this._cityPosAttr.needsUpdate = true;
    this._cityGlowAttr.needsUpdate = true;

    // İstanbul etiketi
    const status = d.turkeyAurora;
    let text;
    let variant;
    if (ovalFade < 0.5) {
      text = t('scene.aurora.ist.noOval');
      variant = 'small';
    } else if (status !== 'none' && !d.turkeyDark) {
      text = d.istanbulSunElevDeg > 0 ? t('scene.aurora.ist.day') : t('scene.aurora.ist.notDark');
      variant = 'small';
    } else if (status === 'overhead') {
      text = t('scene.aurora.ist.overhead');
      variant = 'danger';
    } else if (status === 'visible') {
      text = t('scene.aurora.ist.visible');
      variant = 'warn';
    } else if (status === 'horizon') {
      text = t('scene.aurora.ist.horizon');
      variant = 'warn';
    } else {
      text = t('scene.aurora.ist.none');
      variant = 'small';
    }
    if (text !== this._lblIstText) {
      this._lblIstText = text;
      this._lblIst.element.textContent = text;
      setLabelVariant(this._lblIst, variant);
    }
    const w0 = this._cityWorld[0];
    this._lblIst.position.copy(w0).multiplyScalar(1.004);
    // yalnızca kameraya bakan yarıkürede ve yeterince yakınken göster; aurora Türkiye'den görülebiliyorsa genel bakışta da görünsün
    const alerting = ovalFade >= 0.5 && status !== 'none' && d.turkeyDark;
    this._lblIst.visible = camDist < (alerting ? 75 : 22) && w0.dot(cam) > w0.lengthSq();
  }

  // ---- her kare
  update(visDt = 0, simDt = 0, realDt = 0) {
    const ctx = this.ctx;
    const st = ctx.state;
    const d = st.derived;
    const on = !!st.params.layers.aurora;
    this.group.visible = on;
    if (!on) return;

    this._time += realDt;
    this._frame++;

    const cam = ctx.camera;
    const camDist = cam.position.length();

    // Nokta/şehir boyutu için piksel ölçeği
    ctx.renderer.getSize(this._size);
    const pr = ctx.renderer.getPixelRatio ? ctx.renderer.getPixelRatio() : 1;
    this._scale = (pr * Math.max(this._size.y, 1)) / (2 * Math.tan((cam.fov * Math.PI) / 360));

    // Kalkan yoksa oval söner; yerine sönük gündüz parıltısı gelir
    const fade = smoothstep(0.04, 0.06, d.shieldStrength);
    const ovalOn = fade > 0.005;
    this.curtains.visible = ovalOn;
    this.glow.visible = ovalOn;
    const gStrength = 0.09 * (1 - fade);
    this.globalGlow.visible = gStrength > 0.004;
    this._gu.uStrength.value = gStrength;
    this._gu.uTime.value = this._time;

    // Uzaktan bakınca perde yüksekliğini hafifçe büyüt (okunabilirlik)
    const hs = clamp(0.8 + camDist * 0.03, 1, 1.6);

    if (ovalOn && (this._frame % REBUILD_EVERY === 0)) this._rebuild(d, hs);

    // Shader uniformları
    const I = clamp(Number.isFinite(d.auroraIntensity) ? d.auroraIntensity : 0, 0, 1.5);
    const ns = clamp(d.reconnection.nightside, 0, 1);
    const u = this._u;
    u.uTime.value = this._time;
    u.uGain.value = 0.55 + 0.75 * I; // bloom eşiği 0.6 → biraz daha parlak
    u.uRed.value = smoothstep(0.3, 1.1, I);
    u.uPurple.value = smoothstep(4.5, 8.0, d.kp);
    u.uFade.value = fade;
    u.uNight.value = ns;
    // batıya (azalan MLT) ilerleyen dalga: gece yarısından akşam tarafına
    u.uSurge.value = ns > 0.03 ? ns : 0;
    u.uSurgeMlt.value = (24 - 5 * Math.pow(1 - ns, 0.7) + 24) % 24;

    // Etiket ve şehirler
    this._cityU.uScale.value = this._scale;
    this._cityU.uTime.value = this._time;
    this._updateCities(st, d, realDt, camDist, fade);

    const lp = this._lblOval.position;
    this._lblOval.visible = ovalOn && fade > 0.3 && camDist < 35 && lp.dot(cam.position) > lp.lengthSq();
  }

  dispose() {
    for (const lbl of [this._lblOval, this._lblIst]) {
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
