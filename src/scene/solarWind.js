// Güneş rüzgârı + CME katmanı.
//  1) Güneş rüzgârı parçacıkları: yay şokuna kadar düz (sapmadan) akar; şoktan sonra Rankine yarı-cismi
//     kılıf akışını izler (manyetopozun etrafından dolanır). Güneye yönelmiş IMF'de bir kısmı yeniden
//     birleşip kutup huzmelerine (cusp), alt fırtınada kuyruktan gece tarafı aurora ovaline akar.
//  2) CME: Güneş'ten Dünya'ya genişleyerek giden bükülmüş manyetik bulut (parçacık kabuğu + saydam kabuk).
//  3) Kalkan çökünce: atmosfere çarpma kıvılcımları ve atmosferik iyon kaçışı (plume).

import * as THREE from 'three';
import { COLORS, VISUAL, SUN_SCENE_DISTANCE, SUN_VISUAL_RADIUS } from '../core/constants.js';
import { DEG, clamp, magneticBasis, magneticToWorld } from '../core/geo.js';
import {
  BOW_SHOCK_ECCENTRICITY, insideBowShock, insideMagnetopause, magnetopauseRadius, sheathVelocity,
} from '../physics/magnetopause.js';
import { makeLabel } from './labels.js';
import { t } from '../i18n/index.js';
import { nint } from '../core/format.js';

const TAU = Math.PI * 2;
const rand = Math.random;

// ---- Güneş rüzgârı parçacıkları
const MAX_WIND = 5000;
const SPAWN_X = 44; // Güneş ile Dünya arasında doğuş düzlemi
const KILL_X = -70;
const KILL_R2 = 80 * 80;
const MAX_STEP = 0.08; // parçacık adımı üst sınırı (görsel saniye)
const SHEATH_LIFE = 26; // kılıfta durgun kalanları geri dönüştür (s)
const TURB_TAU = 0.6;

const MODE_UP = 0;
const MODE_SHEATH = 1;
const MODE_CUSP = 2;
const MODE_TAIL = 3;

// Yeniden birleşme rotaları: kutup huzmesi (cusp) ve gece tarafı aurora ovali
const N_CUSP = 12; // 6 kuzey + 6 güney
const N_TAIL = 12;
const CUSP_CAP = 220;
const TAIL_CAP = 140;

// ---- CME
const CME_POOL = 8;
const CME_POINTS = 2500;
const CME_THETA_MAX = 100 * DEG; // kabuğun burun ekseninden açılımı
const CME_COS_MAX = Math.cos(CME_THETA_MAX);
const PULSE_DUR = 3.2;

// ---- Kalkan çökmesi etkileri
const MAX_SPARKS = 60;
const MAX_PLUME = 800;
const PLUME_BODY_D = 1.145; // r0≈1.08 için d = r0·1.06

// Standart normal dağılıma yakın tablo (türbülans için, Math.random çağrısından kaçınır)
const GMASK = 8191;
const GAUSS = new Float32Array(GMASK + 1);
for (let i = 0; i <= GMASK; i++) GAUSS[i] = (rand() + rand() + rand() - 1.5) * 2;

/** Manyetopozun x ≥ KILL_X bölgesindeki en büyük yanal yarıçapı (Re). α büyükse kuyruk çok açılır. */
function magnetopauseLateralMax(r0, alpha) {
  let m = 0;
  for (let k = 0; k < 45; k++) {
    const th = (90 + 2 * k) * DEG;
    const rr = magnetopauseRadius(th, r0, alpha);
    if (rr * Math.cos(th) < KILL_X) break;
    const l = rr * Math.sin(th);
    if (l > m) m = l;
  }
  return m;
}

// ------------------------------------------------------------------ GLSL

const WIND_VERT = /* glsl */ `
uniform float uScale;
uniform float uSize;
uniform vec3 uQuiet;
uniform vec3 uStorm;
uniform vec3 uHot;
uniform vec3 uCusp;
uniform vec3 uTail;
uniform float uStormMix;
uniform float uOpacity;
attribute vec3 aColor;
attribute float aSize;
attribute vec3 aState; // x: kip, y: ısınma, z: solma
varying vec4 vColor;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.05);

  float mode = aState.x;
  float heat = aState.y;
  float life = aState.z;
  float isCusp = step(1.5, mode) * (1.0 - step(2.5, mode));
  float isTail = step(2.5, mode);
  float route = isCusp + isTail;

  vec3 col = mix(uQuiet, uStorm, uStormMix);
  col = mix(col, uHot, heat * 0.8);
  col = mix(col, uCusp, isCusp);
  col = mix(col, uTail, isTail);
  col *= aColor;
  col *= 1.0 + 0.9 * heat + 1.1 * route;

  // konuma bağlı solma: doğuş düzlemi, kuyruk ucu, yanal kenar, kameraya çok yakın
  float fade = 1.0 - smoothstep(39.0, 44.0, position.x);
  fade *= smoothstep(-72.0, -56.0, position.x);
  fade *= 1.0 - smoothstep(26.0, 36.0, length(position.yz));
  fade *= smoothstep(0.6, 3.0, depth);

  float size = uSize * aSize * (1.0 + 0.5 * heat) * (1.0 + 0.7 * route);
  gl_PointSize = clamp(size * uScale / depth, 1.6, 34.0);
  float alpha = uOpacity * fade * life * (0.55 + 0.45 * heat + 0.45 * route);
  vColor = vec4(col, alpha);
}
`;

const WIND_FRAG = /* glsl */ `
varying vec4 vColor;

void main() {
  vec2 q = gl_PointCoord - vec2(0.5);
  float r = length(q) * 2.0;
  if (r > 1.0) discard;
  float a = 1.0 - r;
  a = a * a * (0.6 + 0.8 * a);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}
`;

// Kıvılcım ve plume için genel parıltı sprite'ı (renk ve boyut CPU'dan, solma renge işlenmiş)
const GLOW_VERT = /* glsl */ `
uniform float uScale;
attribute vec3 aColor;
attribute float aSize;
varying vec3 vColor;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.05);
  float px = aSize * uScale / depth;
  gl_PointSize = aSize > 0.0 ? clamp(px, 1.5, 48.0) : 0.0;
  vColor = aColor;
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uCore;
varying vec3 vColor;

void main() {
  vec2 q = gl_PointCoord - vec2(0.5);
  float r = length(q) * 2.0;
  if (r > 1.0) discard;
  float a = 1.0 - r;
  float glow = a * a;
  float core = pow(a, 5.0) * uCore;
  gl_FragColor = vec4(vColor * (glow + core), 1.0);
}
`;

const CME_VERT = /* glsl */ `
uniform float uScale;
uniform float uTime;
uniform float uSize;
uniform float uTwist;
attribute vec4 aRand;
varying float vAlpha;
varying float vFront;

void main() {
  vec3 p = position; // birim yerel koordinat, kabuk ekseni −X
  float rr = max(length(p), 0.0001);
  float c = -p.x / rr; // 1: burun, kenara doğru azalır
  float ang = uTwist * (1.0 - c) + uTime * 0.05;
  float ca = cos(ang);
  float sa = sin(ang);
  p = vec3(p.x, ca * p.y - sa * p.z, sa * p.y + ca * p.z);
  p *= 1.0 + 0.015 * sin(uTime * 0.9 + aRand.z * 6.2831);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.05);
  gl_PointSize = clamp(uSize * (0.65 + 0.7 * aRand.x) * uScale / depth, 1.5, 70.0);
  float tw = 0.78 + 0.22 * sin(uTime * 1.6 + aRand.z * 6.2831);
  vFront = smoothstep(0.1, 1.0, c);
  vAlpha = tw * (0.55 + 0.9 * aRand.y) * (0.5 + 0.7 * vFront) * smoothstep(0.3, 2.0, depth);
}
`;

const CME_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vAlpha;
varying float vFront;

void main() {
  vec2 q = gl_PointCoord - vec2(0.5);
  float r = length(q) * 2.0;
  if (r > 1.0) discard;
  float a = 1.0 - r;
  a = a * a;
  vec3 col = uColor * (1.0 + 0.6 * vFront) + vec3(0.18, 0.10, 0.03) * vFront * a;
  gl_FragColor = vec4(col, a * vAlpha * uAlpha);
}
`;

const SHELL_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vView;

void main() {
  vObj = position;
  vNrm = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uCosMax;
uniform vec3 uColor;
varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vView;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(11.7, 3.1, 5.3);
    a *= 0.5;
  }
  return s;
}

void main() {
  float c = -vObj.x;
  float edge = smoothstep(uCosMax, uCosMax + 0.45, c);
  float fres = pow(1.0 - abs(dot(normalize(vNrm), normalize(vView))), 2.4);
  float n = fbm3(vObj * 3.2 + vec3(uTime * 0.07, uTime * 0.03, 0.0));
  float a = (0.06 + 0.4 * fres) * (0.3 + 1.1 * n) * edge * uAlpha;
  vec3 col = uColor * (0.7 + 0.9 * n) + vec3(0.25, 0.12, 0.04) * smoothstep(0.4, 1.0, c);
  gl_FragColor = vec4(col, a);
}
`;

// ------------------------------------------------------------------ katman

export class SolarWindLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'SolarWindLayer';
    ctx.scene.add(this.group);

    this._time = 0;
    this._tmp = [0, 0, 0];
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector2();
    this._basis = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
    this._uScale = { value: 1000 }; // piksel / birim @ 1 birim uzaklık
    this._uTime = { value: 0 };
    this._U = VISUAL.solarWindRePerSecAt400;
    this._stormMix = 0;
    this._activeF = -1;
    this._active = MAX_WIND; // başlangıçta tüm havuz ön dolgulu
    this._act = 0;
    this._spreadX0 = 15;
    this._pulse = 0;
    this._pulseAge = 0;
    this._labelCache = new WeakMap();

    this._buildWind();
    this._buildCme();
    this._buildImpact();
    this._buildLabels();

    this._unsub = [
      ctx.events.on('storm:arrived', () => {
        this._pulse = PULSE_DUR;
        this._pulseAge = 0;
      }),
      ctx.events.on('sim:reset', () => this._onReset()),
    ];
  }

  // ---------------------------------------------------------------- kurulum

  _buildWind() {
    const N = MAX_WIND;
    this._pos = new Float32Array(N * 3);
    this._vel = new Float32Array(N * 3);
    this._turb = new Float32Array(N * 3);
    this._st3 = new Float32Array(N * 3); // aState
    this._mode = new Uint8Array(N);
    this._slot = new Uint8Array(N);
    this._wpi = new Uint8Array(N);
    this._age = new Float32Array(N);
    this._cuspTally = 0;
    this._tailTally = 0;
    this._tailBudget = TAIL_CAP;
    this._pTail = 0;
    this._pNose = 0;
    this._noseX = 13;
    this._noseR = 8;

    // Rota köşe noktaları: yuva × 3 nokta × xyz
    this._wp = new Float32Array((N_CUSP + N_TAIL) * 9);
    this._cuspLat = new Float32Array(N_CUSP);
    this._cuspMlt = new Float32Array(N_CUSP);
    this._tailMlt = new Float32Array(N_TAIL);
    this._tailU = new Float32Array(N_TAIL);
    for (let k = 0; k < N_CUSP; k++) {
      this._cuspLat[k] = 76.5 + rand() * 3;
      this._cuspMlt[k] = 11 + ((k >> 1) + rand()) / 6 * 2;
    }
    for (let k = 0; k < N_TAIL; k++) {
      const mag = 0.3 + (((k >> 2) + rand()) / 3) * 2.4;
      this._tailMlt[k] = 24 + (((k >> 1) & 1) ? -mag : mag);
      this._tailU[k] = rand();
    }

    const color = new Float32Array(N * 3);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = 0.82 + 0.3 * rand();
      color[i * 3] = t;
      color[i * 3 + 1] = t * (0.94 + 0.1 * rand());
      color[i * 3 + 2] = t * (0.88 + 0.2 * rand());
      size[i] = 0.7 + 0.6 * rand() * rand() + 0.2 * rand();
    }

    const geo = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage);
    this._stAttr = new THREE.BufferAttribute(this._st3, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._posAttr);
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aState', this._stAttr);
    geo.setDrawRange(0, 0);

    const c = (hex) => new THREE.Color(hex);
    const u = {
      uScale: this._uScale,
      uSize: { value: 0.3 },
      uQuiet: { value: c(COLORS.solarWindQuiet) },
      uStorm: { value: c(COLORS.solarWindStorm) },
      uHot: { value: c(0xffe0b8) },
      uCusp: { value: c(0x3dffd0) },
      uTail: { value: c(COLORS.auroraGreen) },
      uStormMix: { value: 0 },
      uOpacity: { value: 0.5 },
    };
    this._windMat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: WIND_VERT,
      fragmentShader: WIND_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._windGeo = geo;
    this._windPoints = new THREE.Points(geo, this._windMat);
    this._windPoints.name = 'SolarWindParticles';
    this._windPoints.frustumCulled = false;
    this._windPoints.renderOrder = 3;
    this.group.add(this._windPoints);

    // Akışı baştan dolu başlat (sürekli akış izlenimi)
    const d = this.ctx.state.derived;
    this._spreadX0 = Math.min((d.rbs || 13.5) + 1.5, SPAWN_X - 3);
    for (let i = 0; i < N; i++) this._prefill(i);
  }

  _buildCme() {
    const N = CME_POINTS;
    const pos = new Float32Array(N * 3);
    const rnd = new Float32Array(N * 4);
    const nShell = Math.floor(N * 0.7);
    const STRANDS = 5;
    for (let i = 0; i < N; i++) {
      let c;
      let phi;
      let rho;
      if (i < nShell) {
        // kalın kabuk: burna doğru daha yoğun
        const u = Math.pow(rand(), 1.25);
        c = 1 - u * (1 - CME_COS_MAX);
        phi = rand() * TAU;
        rho = 1 - 0.3 * Math.pow(rand(), 1.4);
      } else {
        // sarmal akı ipi telleri
        const k = i % STRANDS;
        const t = rand();
        c = 1 - Math.pow(t, 0.9) * (1 - CME_COS_MAX);
        phi = (k / STRANDS) * TAU + 5.5 * t + (rand() - 0.5) * 0.14;
        rho = 0.86 + 0.05 * Math.sin(t * 17 + k) + (rand() - 0.5) * 0.05;
      }
      const s = Math.sqrt(Math.max(0, 1 - c * c));
      const j = i * 3;
      pos[j] = -c * rho + (rand() - 0.5) * 0.04;
      pos[j + 1] = s * Math.cos(phi) * rho + (rand() - 0.5) * 0.04;
      pos[j + 2] = s * Math.sin(phi) * rho + (rand() - 0.5) * 0.04;
      rnd[i * 4] = rand();
      rnd[i * 4 + 1] = rand();
      rnd[i * 4 + 2] = rand();
      rnd[i * 4 + 3] = rand();
    }
    this._cmeGeo = new THREE.BufferGeometry();
    this._cmeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._cmeGeo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));

    // Saydam gürültülü kabuk: kutbu −X olan küre kapağı
    this._shellGeo = new THREE.SphereGeometry(1, 40, 28, 0, TAU, 0, CME_THETA_MAX);
    this._shellGeo.rotateZ(Math.PI / 2);

    this._clouds = [];
    for (let k = 0; k < CME_POOL; k++) this._clouds.push(this._makeCloud());
  }

  _makeCloud() {
    const color = new THREE.Color(COLORS.cme);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uScale: this._uScale,
        uTime: this._uTime,
        uSize: { value: 1 },
        uTwist: { value: 2 },
        uAlpha: { value: 1 },
        uColor: { value: color.clone() },
      },
      vertexShader: CME_VERT,
      fragmentShader: CME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(this._cmeGeo, mat);
    pts.name = 'CmeCloud';
    pts.visible = false;
    pts.renderOrder = 4;
    this.group.add(pts);

    const shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this._uTime,
        uAlpha: { value: 0.3 },
        uCosMax: { value: CME_COS_MAX },
        uColor: { value: color.clone() },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const shell = new THREE.Mesh(this._shellGeo, shellMat);
    shell.name = 'CmeShell';
    shell.visible = false;
    shell.renderOrder = 2;
    this.group.add(shell);

    const label = makeLabel(t('scene.wind.cme'), 'warn');
    label.visible = false;
    this.group.add(label);

    return { storm: null, phase: 0, fade: 0, t: 0, dur: 1.5, pts, mat, shell, shellMat, label, text: '' };
  }

  _buildImpact() {
    const mkGlow = (count, core) => {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const size = new Float32Array(count);
      const geo = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
      const ca = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
      const sa = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pa);
      geo.setAttribute('aColor', ca);
      geo.setAttribute('aSize', sa);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uScale: this._uScale, uCore: { value: core } },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.group.add(pts);
      return { pos, col, size, geo, mat, pts, pa, ca, sa };
    };

    // Kıvılcımlar (atmosfere çarpma / kutup huzmesi varışı)
    this._sp = mkGlow(MAX_SPARKS, 2.2);
    this._sp.pts.name = 'SolarWindSparks';
    this._sp.pts.renderOrder = 5;
    this._sparkLife = new Float32Array(MAX_SPARKS);
    this._sparkMax = new Float32Array(MAX_SPARKS);
    this._sparkKind = new Uint8Array(MAX_SPARKS);
    this._sparkCursor = 0;
    this._sparkAcc = 0;
    this._sparkAlive = 0;

    // Atmosferik kaçış (plume)
    this._pl = mkGlow(MAX_PLUME, 0.4);
    this._pl.pts.name = 'AtmosphericEscape';
    this._pl.pts.renderOrder = 3;
    this._plVel = new Float32Array(MAX_PLUME * 3);
    this._plLife = new Float32Array(MAX_PLUME);
    this._plMax = new Float32Array(MAX_PLUME);
    this._plCursor = 0;
    this._plAcc = 0;
    this._plAlive = 0;

    this._sparkCol = [new THREE.Color(0xfff0c8), new THREE.Color(0x3dffd0), new THREE.Color(COLORS.auroraGreen)];
    this._plumeCol = new THREE.Color(0x7a63ff);
  }

  _buildLabels() {
    this._shockLabel = makeLabel(t('scene.wind.shockArrival'), 'danger');
    this._shockLabel.center.set(0.5, -0.5); // eksenin altında dursun: manyetopoz/yay şoku etiketleriyle çakışmasın
    this._shockLabel.visible = false;
    this.group.add(this._shockLabel);

    this._escapeLabel = makeLabel(t('scene.wind.escape'), 'accent');
    this._escapeLabel.visible = false;
    this._escapeLabel.position.set(-3, 1.7, 0);
    this.group.add(this._escapeLabel);
  }

  // ---------------------------------------------------------------- parçacık doğurma

  /** İlk dolgu: hacme yay (manyetopoz içi hariç); yay şoku içindekiler kılıf akışıyla başlar. */
  _prefill(i) {
    const d = this.ctx.state.derived;
    const j = i * 3;
    const pos = this._pos;
    let ok = false;
    for (let tries = 0; tries < 8 && !ok; tries++) {
      const rad = (rand() < 0.4 ? 16 : 32) * Math.sqrt(rand());
      const phi = rand() * TAU;
      pos[j] = KILL_X + 8 + rand() * (SPAWN_X - KILL_X - 8);
      pos[j + 1] = rad * Math.cos(phi);
      pos[j + 2] = rad * Math.sin(phi);
      ok = !insideMagnetopause(pos[j], pos[j + 1], pos[j + 2], d.r0, d.alpha);
    }
    if (!ok) {
      this._respawn(i, true);
      return;
    }
    this._vel[j] = -this._U;
    this._vel[j + 1] = 0;
    this._vel[j + 2] = 0;
    this._turb[j] = this._turb[j + 1] = this._turb[j + 2] = 0;
    this._wpi[i] = 0;
    this._st3[j + 2] = 1;
    if (insideBowShock(pos[j], pos[j + 1], pos[j + 2], d.rbs)) {
      this._mode[i] = MODE_SHEATH;
      this._age[i] = rand() * SHEATH_LIFE * 0.5;
      this._st3[j] = MODE_SHEATH;
      this._st3[j + 1] = 0.2;
      sheathVelocity(this._tmp, pos[j], pos[j + 1], pos[j + 2], d.r0 * 1.06, this._U);
      this._vel[j] = this._tmp[0];
      this._vel[j + 1] = this._tmp[1];
      this._vel[j + 2] = this._tmp[2];
    } else {
      this._mode[i] = MODE_UP;
      this._age[i] = 0.5;
      this._st3[j] = MODE_UP;
      this._st3[j + 1] = 0;
    }
  }

  /** Yukarı akışta yeniden doğur. spread: şok önündeki bölgeye dağıt ve yumuşak belirt. */
  _respawn(i, spread) {
    const j = i * 3;
    const pos = this._pos;
    const rad = (rand() < 0.4 ? 16 : 32) * Math.sqrt(rand());
    const phi = rand() * TAU;
    pos[j] = spread ? this._spreadX0 + rand() * (SPAWN_X - this._spreadX0) : SPAWN_X + (rand() - 0.5) * 1.6;
    pos[j + 1] = rad * Math.cos(phi);
    pos[j + 2] = rad * Math.sin(phi);
    this._vel[j] = -this._U;
    this._vel[j + 1] = 0;
    this._vel[j + 2] = 0;
    this._turb[j] = this._turb[j + 1] = this._turb[j + 2] = 0;
    this._mode[i] = MODE_UP;
    this._wpi[i] = 0;
    this._age[i] = spread ? 0 : 0.5;
    this._st3[j] = MODE_UP;
    this._st3[j + 1] = 0;
    this._st3[j + 2] = spread ? 0 : 1;
  }

  /** Kuyruktan gece tarafı aurora ovaline doğru bir rota parçacığı başlat. */
  _startTail(i) {
    const j = i * 3;
    const side = rand() < 0.5 ? 1 : -1; // +1: şafak (+Z)
    this._pos[j] = -15 - rand() * 10;
    this._pos[j + 1] = (rand() - 0.5) * 2.4;
    this._pos[j + 2] = side * (0.6 + rand() * 6);
    this._vel[j] = 2.5;
    this._vel[j + 1] = 0;
    this._vel[j + 2] = 0;
    this._mode[i] = MODE_TAIL;
    this._slot[i] = (rand() < 0.5 ? 0 : 1) + (side > 0 ? 0 : 2) + 4 * ((rand() * 3) | 0);
    this._wpi[i] = 0;
    this._age[i] = 0;
    this._st3[j] = MODE_TAIL;
    this._st3[j + 1] = 0;
    this._st3[j + 2] = 1;
  }

  /** Yeniden birleşme açıkken burun bölgesine (şokun hemen önüne) ek besleme: cusp akışı seyrek kalmasın. */
  _respawnNose(i) {
    const j = i * 3;
    const rad = this._noseR * Math.sqrt(rand());
    const phi = rand() * TAU;
    this._respawn(i, true);
    this._pos[j] = this._noseX + 0.4 + rand() * 2.5;
    this._pos[j + 1] = rad * Math.cos(phi);
    this._pos[j + 2] = rad * Math.sin(phi);
  }

  _recycle(i, spread) {
    if (this._pTail > 0 && this._tailBudget > 0 && rand() < this._pTail) {
      this._tailBudget--;
      this._startTail(i);
    } else if (this._pNose > 0 && rand() < this._pNose) {
      this._respawnNose(i);
    } else {
      this._respawn(i, spread);
    }
  }

  // ---------------------------------------------------------------- kıvılcım havuzu

  _spawnSpark(x, y, z, kind) {
    const k = this._sparkCursor;
    this._sparkCursor = (k + 1) % MAX_SPARKS;
    const j = k * 3;
    this._sp.pos[j] = x;
    this._sp.pos[j + 1] = y;
    this._sp.pos[j + 2] = z;
    this._sparkMax[k] = this._sparkLife[k] = kind === 0 ? 0.35 + rand() * 0.4 : 0.6 + rand() * 0.4;
    this._sparkKind[k] = kind;
    this._sparkAlive++; // güncelleme döngüsünü tetikle
  }

  // ---------------------------------------------------------------- güncelleme

  update(visDt, simDt, realDt) {
    const st = this.ctx.state;
    const show = !!st.params.layers.solarWind;
    this.group.visible = show;
    if (!show) return;

    const rdt = realDt > 0 ? Math.min(realDt, 0.1) : 0;
    const dt = Math.min(visDt > 0 ? visDt : 0, MAX_STEP);
    this._time += rdt;
    this._uTime.value = this._time;
    this._updateScale();
    this._updateRoutes();
    this._updateWind(dt, rdt);
    this._updateCme(rdt);
    this._updateImpact(dt, rdt);
    this._updateLabels(rdt);
  }

  _updateScale() {
    const { renderer, camera } = this.ctx;
    renderer.getSize(this._v2);
    const hpx = Math.max(1, this._v2.y * (renderer.getPixelRatio ? renderer.getPixelRatio() : 1));
    const fov = (camera.fov || 45) * DEG;
    this._uScale.value = hpx / (2 * Math.tan(fov * 0.5));
  }

  /** Cusp ve gece tarafı rotalarının köşe noktalarını (manyetik çerçeve dönerken) yeniden hesapla. */
  _updateRoutes() {
    const st = this.ctx.state;
    const d = st.derived;
    const b = magneticBasis(st.frame, this._basis);
    const wp = this._wp;
    const v = this._v;
    const rw = clamp(d.r0 * 0.45, 2.2, 6.5);
    const rm = (rw + 1.02) * 0.5;
    for (let k = 0; k < N_CUSP; k++) {
      const sgn = (k & 1) ? -1 : 1;
      magneticToWorld(sgn * this._cuspLat[k], this._cuspMlt[k], 1, b, v);
      const o = k * 9;
      wp[o] = v.x * rw;
      wp[o + 1] = v.y * rw;
      wp[o + 2] = v.z * rw;
      wp[o + 3] = v.x * rm;
      wp[o + 4] = v.y * rm;
      wp[o + 5] = v.z * rm;
      wp[o + 6] = v.x * 1.02;
      wp[o + 7] = v.y * 1.02;
      wp[o + 8] = v.z * 1.02;
    }
    const lat0 = Number.isFinite(d.auroraLat) ? d.auroraLat : 63;
    const wid = Number.isFinite(d.auroraWidth) ? d.auroraWidth : 5;
    for (let k = 0; k < N_TAIL; k++) {
      const sgn = (k & 1) ? -1 : 1;
      const lamO = clamp(lat0 + wid * (0.2 + 0.6 * this._tailU[k]), 35, 80);
      const c = Math.cos(lamO * DEG);
      const L = Math.min(14, 1.02 / (c * c));
      const mlt = this._tailMlt[k];
      const o = (N_CUSP + k) * 9;
      magneticToWorld(0, mlt, L, b, v); // ekvator geçişi (dipol alan çizgisi L kabuğu)
      wp[o] = v.x;
      wp[o + 1] = v.y;
      wp[o + 2] = v.z;
      const lam1 = lamO * 0.62;
      const c1 = Math.cos(lam1 * DEG);
      magneticToWorld(sgn * lam1, mlt, L * c1 * c1, b, v);
      wp[o + 3] = v.x;
      wp[o + 4] = v.y;
      wp[o + 5] = v.z;
      magneticToWorld(sgn * lamO, mlt, 1.02, b, v); // oval, r ≈ 1.02
      wp[o + 6] = v.x;
      wp[o + 7] = v.y;
      wp[o + 8] = v.z;
    }
  }

  _applyDraw(n) {
    this._active = n;
    this._windGeo.setDrawRange(0, n);
    this._posAttr.needsUpdate = true;
    this._stAttr.needsUpdate = true;
  }

  _updateWind(dt, rdt) {
    const st = this.ctx.state;
    const d = st.derived;
    const sw = st.sw;
    const U = Math.max(0.5, VISUAL.solarWindRePerSecAt400 * (sw.speed || 400) / 400);
    this._U = U;
    const invU = 1 / U;
    const r0 = d.r0 > 0.5 ? d.r0 : 10.5;
    const alpha = d.alpha > 0 ? d.alpha : 0.58;
    const rbs = d.rbs > r0 ? d.rbs : r0 * 1.3;
    const ECC = BOW_SHOCK_ECCENTRICITY;
    const Lbs = rbs * (1 + ECC);
    const dBody = r0 * 1.06;
    const mpLat = magnetopauseLateralMax(r0, alpha) * 1.08 + 1;
    const mpLat2 = mpLat * mpLat;
    const rLim = r0 * Math.pow(4, alpha) * 1.05;
    const rLim2 = rLim * rLim;
    this._spreadX0 = Math.min(rbs + 1.5, SPAWN_X - 3); // şok doğuş düzleminin ötesine taşarsa yine görünür bölgede doğsun

    // Etkin parçacık sayısı ∝ sqrt(yoğunluk); yumuşak geçiş
    const dens = sw.density > 0 ? sw.density : 5;
    const target = clamp(MAX_WIND * 0.7 * Math.sqrt(dens / 5), 900, MAX_WIND);
    if (this._activeF < 0) this._activeF = target;
    else this._activeF += (target - this._activeF) * Math.min(1, 2 * rdt);
    const n = Math.min(MAX_WIND, Math.round(this._activeF));
    if (n > this._active) for (let i = this._active; i < n; i++) this._respawn(i, true);

    // Renk: sakin (yavaş) → fırtına (hızlı veya CME kılıf/bulut evresinde)
    let tgt = clamp((sw.speed - 550) / 350, 0, 1);
    for (let k = 0; k < st.storms.length; k++) {
      const ph = st.storms[k].phase;
      if (ph === 'sheath' || ph === 'cloud') tgt = 1;
    }
    this._stormMix += (tgt - this._stormMix) * Math.min(1, 1.5 * rdt);
    const sm = this._stormMix;
    const u = this._windMat.uniforms;
    u.uStormMix.value = sm;
    u.uOpacity.value = 0.42 + 0.2 * sm;

    // Yeniden birleşme: güneye yönelmiş IMF → cusp; alt fırtına → kuyruk enjeksiyonu
    const shielded = d.shieldStrength > 0.2;
    const dayside = clamp(d.reconnection.dayside, 0, 1);
    const reconOn = sw.bz < -3 && shielded;
    const pCapture = reconOn ? (0.45 + 0.9 * dayside) * dt : 0;
    const capX0 = r0 * 0.5;
    const capLat2 = 0.81 * r0 * r0;
    this._pNose = reconOn ? 0.08 * (0.5 + dayside) : 0;
    this._noseX = Math.min(rbs, SPAWN_X - 6);
    this._noseR = 0.9 * r0;
    let cuspBudget = CUSP_CAP - this._cuspTally;
    const nightside = d.reconnection.nightside;
    this._pTail = nightside > 0.3 && shielded ? 0.1 * nightside : 0;
    this._tailBudget = TAIL_CAP - this._tailTally;
    this._cuspTally = 0;
    this._tailTally = 0;
    const ax = st.frame.dipoleAxis.x;
    const ay = st.frame.dipoleAxis.y;
    const az = st.frame.dipoleAxis.z;

    // Kalkan çöktüyse parçacıklar gezegenin hemen yanında kıvılcım üretir
    const collapsed = d.shieldStrength < 0.1;
    const impactP = collapsed ? 3 * dt : 0;

    // Kılıf türbülansı (Ornstein–Uhlenbeck)
    const sigmaV = U * 0.075 * (1 + 1.2 * sm);
    const kTurb = sigmaV * Math.sqrt((2 * dt) / TURB_TAU);
    const decay = Math.max(0, 1 - dt / TURB_TAU);
    const kv = Math.min(1, 9 * dt);
    const kh = Math.min(1, 3 * dt);
    const kRoute = Math.min(1, 12 * dt);
    const cuspSpeed = 2.5 + 0.55 * U;
    const tailSpeed = 3.0 + 0.6 * U;
    const dU = U * dt;

    const pos = this._pos;
    const vel = this._vel;
    const turb = this._turb;
    const st3 = this._st3;
    const mode = this._mode;
    const age = this._age;
    const slot = this._slot;
    const wpi = this._wpi;
    const wp = this._wp;
    const tmp = this._tmp;
    let gi = (this._time * 7919) & GMASK;

    for (let i = 0; i < n; i++) {
      const j = i * 3;
      let x = pos[j];
      let y = pos[j + 1];
      let z = pos[j + 2];
      const m = mode[i];

      if (m === MODE_UP) {
        // Süpersonik rüzgâr yay şokuna kadar sapmadan −X yönünde akar
        x -= dU;
        let a = age[i];
        if (a < 0.5) {
          a += dt;
          age[i] = a;
          st3[j + 2] = a < 0.5 ? a * 2 : 1;
        }
        if (x < rbs) {
          // insideBowShock ile eşdeğer koniğin trigonometrisiz hâli: r + ε·x < L
          const r2u = x * x + y * y + z * z;
          const r = Math.sqrt(r2u);
          let hit = r + ECC * x < Lbs;
          // α büyükse (güçlü güney IMF) manyetopoz uzak kuyrukta konik yay şokundan geniş kalır: içeride kalanları kılıfa al
          if (!hit && x < 0 && x * x > 0.25 * r2u && y * y + z * z < mpLat2) {
            hit = r < magnetopauseRadius(Math.acos(clamp(x / r, -1, 1)), r0, alpha);
          }
          if (hit) {
            mode[i] = MODE_SHEATH;
            age[i] = 0;
            st3[j] = MODE_SHEATH;
            st3[j + 1] = 0.5; // şokta ani ısınma
            st3[j + 2] = 1;
            vel[j] = -U;
            vel[j + 1] = 0;
            vel[j + 2] = 0;
          }
        }
        if (x < KILL_X || !(x === x)) {
          this._recycle(i, false);
          continue;
        }
        pos[j] = x;
      } else if (m === MODE_SHEATH) {
        // Rankine yarı-cismi kılıf akışı + türbülans
        sheathVelocity(tmp, x, y, z, dBody, U);
        const tx = turb[j] * decay + kTurb * GAUSS[(gi++) & GMASK];
        const ty = turb[j + 1] * decay + kTurb * GAUSS[(gi++) & GMASK];
        const tz = turb[j + 2] * decay + kTurb * GAUSS[(gi++) & GMASK];
        turb[j] = tx;
        turb[j + 1] = ty;
        turb[j + 2] = tz;
        const vx = vel[j] + (tmp[0] + tx - vel[j]) * kv;
        const vy = vel[j + 1] + (tmp[1] + ty - vel[j + 1]) * kv;
        const vz = vel[j + 2] + (tmp[2] + tz - vel[j + 2]) * kv;
        vel[j] = vx;
        vel[j + 1] = vy;
        vel[j + 2] = vz;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;

        // Isınma: akış sapması ne kadar büyükse (burun bölgesi) plazma o kadar sıkışık/sıcak
        const ddx = tmp[0] + U;
        const dev = Math.sqrt(ddx * ddx + tmp[1] * tmp[1] + tmp[2] * tmp[2]) * invU;
        const ht = dev * 1.7 - 0.12;
        const h = st3[j + 1];
        st3[j + 1] = h + ((ht < 0 ? 0 : ht > 1 ? 1 : ht) - h) * kh;
        const ag = age[i] + dt;
        age[i] = ag;
        st3[j + 2] = ag > SHEATH_LIFE - 1.2 ? Math.max(0, (SHEATH_LIFE - ag) / 1.2) : 1;

        let lat2 = y * y + z * z;
        // Manyetopozun içine girdiyse radyal olarak hemen dışına it (çok derindeyse geri dönüştür).
        // θ ≤ 120° için r(θ) ≤ 4^α·r0: ön yarıda bunun ötesindekiler kesinlikle dışarıdadır, testi atla.
        const r2 = x * x + lat2;
        if (lat2 < mpLat2 && (r2 < rLim2 || (x < 0 && x * x > 0.25 * r2))) {
          const r = Math.sqrt(r2);
          if (r > 1e-3) {
            const rmp = magnetopauseRadius(Math.acos(clamp(x / r, -1, 1)), r0, alpha);
            if (r < rmp) {
              const out = rmp * 1.02 + 0.03;
              if (out < r * 1.6 + 1) {
                const s = out / r;
                x *= s;
                y *= s;
                z *= s;
                lat2 = y * y + z * z;
              } else {
                this._recycle(i, true);
                continue;
              }
            }
          } else {
            this._recycle(i, true);
            continue;
          }
        }

        // Kalkan çöktüyse gezegen yüzeyine çarpma
        if (impactP > 0 && x > 0.2 && x * x + lat2 < 2.25 && rand() < impactP) {
          const r = Math.sqrt(x * x + lat2);
          const s = 1.025 / r;
          this._spawnSpark(x * s, y * s, z * s, 0);
          this._recycle(i, true);
          continue;
        }

        // Güneye yönelmiş IMF: burun bölgesindeki kılıf parçacıklarının bir kısmı yeniden birleşir
        if (pCapture > 0 && cuspBudget > 0 && x > capX0 && lat2 < capLat2 && rand() < pCapture) {
          cuspBudget--;
          const north = (ax * x + ay * y + az * z >= 0) === (rand() < 0.8); // %80 aynı yarımküre
          mode[i] = MODE_CUSP;
          slot[i] = (north ? 0 : 1) + 2 * ((rand() * 6) | 0);
          wpi[i] = 0;
          age[i] = 0;
          st3[j] = MODE_CUSP;
          st3[j + 1] = 0;
          st3[j + 2] = 1;
        }

        if (x < KILL_X || x * x + lat2 > KILL_R2 || ag > SHEATH_LIFE) {
          this._recycle(i, false);
          continue;
        }
        if (x - x + y - y + z - z !== 0) {
          this._respawn(i, true);
          continue;
        }
        pos[j] = x;
        pos[j + 1] = y;
        pos[j + 2] = z;
      } else {
        // Yönlendirilmiş rota: cusp (kutup huzmesi) veya kuyruk → gece tarafı aurora ovali
        const isCusp = m === MODE_CUSP;
        if (isCusp) this._cuspTally++;
        else this._tailTally++;
        const w = ((isCusp ? 0 : N_CUSP) + slot[i]) * 9 + wpi[i] * 3;
        const dx = wp[w] - x;
        const dy = wp[w + 1] - y;
        const dz = wp[w + 2] - z;
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
        const last = wpi[i] === 2;
        const rr = Math.sqrt(x * x + y * y + z * z);
        const ag = age[i] + dt;
        age[i] = ag;
        if (last ? dd < 0.3 || rr < 1.04 : dd < 1.2) {
          if (last) {
            // atmosfere ulaştı: kıvılcım ve yeniden doğuş
            const s = 1.02 / (rr + 1e-6);
            this._spawnSpark(x * s, y * s, z * s, isCusp ? 1 : 2);
            if (isCusp) this._cuspTally--;
            else this._tailTally--;
            this._respawn(i, false);
            continue;
          }
          wpi[i]++;
        }
        const sp = isCusp ? cuspSpeed : tailSpeed;
        const vx = vel[j] + (((dx / dd) * sp) - vel[j]) * kRoute;
        const vy = vel[j + 1] + (((dy / dd) * sp) - vel[j + 1]) * kRoute;
        const vz = vel[j + 2] + (((dz / dd) * sp) - vel[j + 2]) * kRoute;
        vel[j] = vx;
        vel[j + 1] = vy;
        vel[j + 2] = vz;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        if (ag > 9 || x - x + y - y + z - z !== 0) {
          this._respawn(i, false);
          continue;
        }
        if (last) {
          // büyük adımda gezegenin içine dalmasın: yüzeye değdiği anda kıvılcım
          const rn = Math.sqrt(x * x + y * y + z * z);
          if (rn < 1.02) {
            const s = 1.02 / (rn + 1e-6);
            this._spawnSpark(x * s, y * s, z * s, isCusp ? 1 : 2);
            if (isCusp) this._cuspTally--;
            else this._tailTally--;
            this._respawn(i, false);
            continue;
          }
        }
        pos[j] = x;
        pos[j + 1] = y;
        pos[j + 2] = z;
      }
    }

    this._applyDraw(n);
  }

  // ---------------------------------------------------------------- CME

  _updateCme(rdt) {
    const st = this.ctx.state;
    const d = st.derived;
    const storms = st.storms;
    const clouds = this._clouds;

    // Yolculuktaki her fırtınaya bir bulut ata
    for (let s = 0; s < storms.length; s++) {
      const storm = storms[s];
      if (storm.arrived) continue;
      let found = false;
      let free = null;
      for (let k = 0; k < clouds.length; k++) {
        if (clouds[k].storm === storm && clouds[k].phase !== 0) found = true;
        else if (clouds[k].phase === 0 && !free) free = clouds[k];
      }
      if (!found && free) {
        free.storm = storm;
        free.phase = 1;
        free.fade = 0;
        free.t = 0;
        free.pts.visible = true;
        free.shell.visible = true;
        free.label.visible = true;
        const text = t('scene.wind.cmeSpeed', { v: nint(storm.vPeak) });
        if (free.text !== text) {
          free.label.element.textContent = text;
          free.text = text;
        }
      }
    }

    const sunSurface = SUN_SCENE_DISTANCE - SUN_VISUAL_RADIUS;
    for (let k = 0; k < clouds.length; k++) {
      const c = clouds[k];
      if (c.phase === 0) continue;
      const storm = c.storm;

      if (c.phase === 1) {
        // Varınca (veya fırtına silinince) bulut dağılmaya başlar
        let alive = false;
        for (let s = 0; s < storms.length; s++) if (storms[s] === storm && !storm.arrived) alive = true;
        if (!alive) {
          c.phase = 2;
          c.t = 0;
          c.dur = storm.arrived ? 1.5 : 0.4;
        } else {
          c.fade = Math.min(1, c.fade + rdt * 2.5);
        }
      }
      let dissolve = 0;
      if (c.phase === 2) {
        c.t += rdt;
        dissolve = Math.min(1, c.t / c.dur);
        if (dissolve >= 1) {
          c.phase = 0;
          c.storm = null;
          c.pts.visible = false;
          c.shell.visible = false;
          c.label.visible = false;
          continue;
        }
      }

      const p = clamp(storm.transitProgress, 0, 1);
      const xFront = sunSurface - (sunSurface - d.rbs) * p; // bulutun burnu
      const R = 3 + 27 * p;
      const grow = 1 + 0.22 * (1 - (1 - dissolve) * (1 - dissolve));
      const Rs = R * grow;
      const fade = c.phase === 2 ? 1 - dissolve : c.fade;
      const strength = clamp(storm.strength, 0, 1);
      const cx = xFront + R;

      c.pts.position.set(cx, 0, 0);
      c.pts.scale.setScalar(Rs);
      const size = 0.26 + 0.028 * R;
      const overlap = (287 * size * size) / (R * R);
      const dens = Math.max(0.08, Math.min(1, 1.5 / overlap));
      const mu = c.mat.uniforms;
      mu.uSize.value = size * grow;
      mu.uTwist.value = 1.8 + 0.8 * strength;
      mu.uAlpha.value = (0.4 + 0.5 * strength) * dens * fade;

      c.shell.position.set(cx, 0, 0);
      c.shell.scale.setScalar(Rs * 0.93);
      c.shellMat.uniforms.uAlpha.value = (0.2 + 0.25 * strength) * (0.4 + 0.6 * p) * fade;

      c.label.position.set(xFront + 0.13 * R, 0.5 * R, 0);
      this._setOpacity(c.label, fade);
    }
  }

  // ---------------------------------------------------------------- kalkan çöküşü etkileri

  _updateImpact(dt, rdt) {
    const st = this.ctx.state;
    const d = st.derived;
    const act = clamp((0.13 - d.shieldStrength) / 0.06, 0, 1);
    this._act = act;

    // --- dayside çarpma kıvılcımları
    if (act > 0 && dt > 0) {
      this._sparkAcc = Math.min(8, this._sparkAcc + act * (18 + 14 * Math.sqrt(Math.max(st.sw.pdyn, 0.1))) * dt);
      while (this._sparkAcc >= 1) {
        this._sparkAcc -= 1;
        const s = Math.sqrt(rand()) * 0.96; // sinθ: Lambert (akıya dik düzlemde düzgün)
        const c = Math.sqrt(1 - s * s);
        const phi = rand() * TAU;
        this._spawnSpark(c * 1.025, s * Math.cos(phi) * 1.025, s * Math.sin(phi) * 1.025, 0);
      }
    } else {
      this._sparkAcc = 0;
    }

    const sp = this._sp;
    if (this._sparkAlive > 0 || act > 0) {
      let alive = 0;
      for (let k = 0; k < MAX_SPARKS; k++) {
        const j = k * 3;
        const life = this._sparkLife[k];
        if (life <= 0) {
          sp.col[j] = sp.col[j + 1] = sp.col[j + 2] = 0;
          sp.size[k] = 0;
          continue;
        }
        const nl = life - dt;
        this._sparkLife[k] = nl;
        if (nl <= 0) {
          sp.col[j] = sp.col[j + 1] = sp.col[j + 2] = 0;
          sp.size[k] = 0;
          continue;
        }
        alive++;
        const t = 1 - nl / this._sparkMax[k];
        const f = (1 - t) * (1 - t);
        const c = this._sparkCol[this._sparkKind[k]];
        const gain = f * 2.4;
        sp.col[j] = c.r * gain;
        sp.col[j + 1] = c.g * gain;
        sp.col[j + 2] = c.b * gain;
        sp.size[k] = (this._sparkKind[k] === 0 ? 0.22 : 0.3) * (0.6 + 0.9 * t);
      }
      this._sparkAlive = alive;
      sp.pa.needsUpdate = true;
      sp.ca.needsUpdate = true;
      sp.sa.needsUpdate = true;
    }

    // --- atmosferik kaçış plume'ı
    const pl = this._pl;
    const Up = Math.min(this._U, 14);
    if (act > 0 && dt > 0) {
      this._plAcc = Math.min(40, this._plAcc + act * (60 + 7 * Math.max(0, d.atmosphericEscape)) * dt);
      while (this._plAcc >= 1) {
        this._plAcc -= 1;
        const k = this._plCursor;
        this._plCursor = (k + 1) % MAX_PLUME;
        const j = k * 3;
        const nx = -0.25 + 1.25 * rand(); // gündüz yarısı ve terminatör ağırlıklı
        const s = Math.sqrt(Math.max(0, 1 - nx * nx));
        const phi = rand() * TAU;
        const ny = s * Math.cos(phi);
        const nz = s * Math.sin(phi);
        pl.pos[j] = nx * 1.05;
        pl.pos[j + 1] = ny * 1.05;
        pl.pos[j + 2] = nz * 1.05;
        const kick = 0.35 + 0.5 * rand();
        this._plVel[j] = nx * kick + (rand() - 0.5) * 0.3;
        this._plVel[j + 1] = ny * kick + (rand() - 0.5) * 0.3;
        this._plVel[j + 2] = nz * kick + (rand() - 0.5) * 0.3;
        this._plMax[k] = this._plLife[k] = 2.5 + 2 * rand();
      }
    } else {
      this._plAcc = 0;
    }
    if (this._plAlive > 0 || act > 0) {
      const tmp = this._tmp;
      const kvp = Math.min(1, 1.8 * dt);
      const pc = this._plumeCol;
      let alive = 0;
      for (let k = 0; k < MAX_PLUME; k++) {
        const j = k * 3;
        const life = this._plLife[k];
        if (life <= 0) {
          pl.col[j] = pl.col[j + 1] = pl.col[j + 2] = 0;
          pl.size[k] = 0;
          continue;
        }
        const nl = life - dt;
        this._plLife[k] = nl;
        if (nl <= 0) {
          pl.col[j] = pl.col[j + 1] = pl.col[j + 2] = 0;
          pl.size[k] = 0;
          continue;
        }
        alive++;
        let x = pl.pos[j];
        let y = pl.pos[j + 1];
        let z = pl.pos[j + 2];
        // yıldız rüzgârı akışı iyonları gezegenin etrafından kuyruğa süpürür
        sheathVelocity(tmp, x, y, z, PLUME_BODY_D, Up);
        const vx = this._plVel[j] + (tmp[0] * 0.32 - this._plVel[j]) * kvp;
        const vy = this._plVel[j + 1] + (tmp[1] * 0.32 - this._plVel[j + 1]) * kvp;
        const vz = this._plVel[j + 2] + (tmp[2] * 0.32 - this._plVel[j + 2]) * kvp;
        this._plVel[j] = vx;
        this._plVel[j + 1] = vy;
        this._plVel[j + 2] = vz;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        const r2 = x * x + y * y + z * z;
        if (r2 < 1.06) {
          const s = 1.03 / (Math.sqrt(r2) + 1e-6);
          x *= s;
          y *= s;
          z *= s;
        }
        if (x - x + y - y + z - z !== 0) {
          this._plLife[k] = 0;
          pl.size[k] = 0;
          continue;
        }
        pl.pos[j] = x;
        pl.pos[j + 1] = y;
        pl.pos[j + 2] = z;
        const lt = nl / this._plMax[k]; // 1 → 0
        const fa = Math.min(1, (1 - lt) * 6) * Math.pow(lt, 0.8) * 0.55;
        pl.col[j] = pc.r * fa;
        pl.col[j + 1] = pc.g * fa;
        pl.col[j + 2] = pc.b * fa;
        pl.size[k] = 0.16 * (0.8 + 0.5 * (1 - lt));
      }
      this._plAlive = alive;
      pl.pa.needsUpdate = true;
      pl.ca.needsUpdate = true;
      pl.sa.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- etiketler

  _setOpacity(label, v) {
    const q = Math.round(clamp(v, 0, 1) * 20) / 20;
    if (this._labelCache.get(label) !== q) {
      this._labelCache.set(label, q);
      label.element.style.opacity = String(q);
    }
  }

  _updateLabels(rdt) {
    const d = this.ctx.state.derived;

    // Şok varışı: yay şoku burnunda kısa süreli titreşimli etiket
    const sl = this._shockLabel;
    if (this._pulse > 0) {
      this._pulse -= rdt;
      this._pulseAge += rdt;
      sl.visible = true;
      sl.position.set(d.rbs > 0 ? d.rbs : 13.5, 0, 0);
      const k = clamp(this._pulse / PULSE_DUR, 0, 1);
      sl.element.style.opacity = String(Math.min(1, k * 3));
      const glow = 0.5 + 0.5 * Math.sin(this._pulseAge * 14);
      sl.element.style.boxShadow = `0 0 ${(8 + 18 * glow).toFixed(1)}px rgba(255, 77, 109, ${(0.35 + 0.5 * glow).toFixed(2)})`;
    } else if (sl.visible) {
      sl.visible = false;
      sl.element.style.boxShadow = '';
    }

    // Atmosfer kaybı
    const el = this._escapeLabel;
    const on = this._act > 0.3;
    if (on !== el.visible) el.visible = on;
    if (on) this._setOpacity(el, this._act);
  }

  _onReset() {
    for (let k = 0; k < this._clouds.length; k++) {
      const c = this._clouds[k];
      c.phase = 0;
      c.storm = null;
      c.pts.visible = false;
      c.shell.visible = false;
      c.label.visible = false;
    }
    this._sparkLife.fill(0);
    this._plLife.fill(0);
    for (const g of [this._sp, this._pl]) {
      g.col.fill(0);
      g.size.fill(0);
      g.ca.needsUpdate = true;
      g.sa.needsUpdate = true;
    }
    this._sparkAlive = 0;
    this._plAlive = 0;
    this._pulse = 0;
  }

  dispose() {
    for (const off of this._unsub) off();
    for (const c of this._clouds) {
      c.mat.dispose();
      c.shellMat.dispose();
      this.group.remove(c.label);
      c.label.element.remove();
    }
    for (const l of [this._shockLabel, this._escapeLabel]) {
      this.group.remove(l);
      l.element.remove();
    }
    this._windGeo.dispose();
    this._windMat.dispose();
    this._cmeGeo.dispose();
    this._shellGeo.dispose();
    for (const g of [this._sp, this._pl]) {
      g.geo.dispose();
      g.mat.dispose();
    }
    this.ctx.scene.remove(this.group);
  }
}
