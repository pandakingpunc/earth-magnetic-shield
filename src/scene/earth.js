// Dünya katmanı: gün/gece gölgelendiricisi (yumuşak terminatör, şehir ışıkları, okyanus parıltısı),
// bulutlar, Fresnel atmosfer kabuğu, dönme/dipol eksenleri + kutup işaretleri ve Ay.
// Doku yoksa (ağ hatası) her şey prosedürel yedekle çizilir. Güneş yönü sahnede sabit +X'tir.

import * as THREE from 'three';
import { ORBITS } from '../core/constants.js';
import { clamp, smoothstep } from '../core/geo.js';
import { makeLabel } from './labels.js';
import { t } from '../i18n/index.js';

const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SUN_DIR = new THREE.Vector3(1, 0, 0);

const CLOUD_RADIUS = 1.008;
const CLOUD_DRIFT_RAD_PER_HOUR = 0.026; // ≈1.5°/sim saati: yüzeye göre yavaş sürüklenme
// Bloom eşiği düşük (0.2) olduğundan yüzey parlaklığı bilerek mütevazı tutulur
const SUN_INTENSITY = 0.7;
const SPEC_GAIN = 0.35;
const CLOUD_GAIN = 0.27;
const SHOULDER = 1.6;

const MOON_RADIUS_RE = 0.273;
const MOON_NEW_AT_HOURS = -20.17; // yeni ay: 10 Eki 2026 15:50 UT (sim başlangıcı 11 Eki 12:00 UT)
const YEAR_DAYS = 365.256;
// Yörünge düzleminin düğüm doğrusu Güneş'e göre yavaş döner (tutulma yılı ≈ 346.62 gün). Sabit olsaydı
// düğümler Güneş–Dünya hattında kalır ve her dolunayda tam ay tutulması görülürdü.
const NODE_AZ0_RAD = (128.98 * Math.PI) / 180; // sim başlangıcında çıkış düğümünün Güneş yönüne göre açısı
const ECLIPSE_YEAR_HOURS = 24 * 346.62;
// Güneş'e göre sabit çerçevede Ay'ın faz periyodu sinodiktir: 1/Ts = 1/Tsidereal − 1/Tyıl
const MOON_PERIOD_HOURS = 24 / (1 / ORBITS.MOON.periodDays - 1 / YEAR_DAYS);

// ---------------------------------------------------------------- GLSL ortak parçalar

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
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
`;

// Ortak köşe gölgelendiricisi: dünya konumu/normali, yerel konum, doğu/kuzey teğetleri
const SURFACE_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vWorldT;
varying vec3 vWorldB;
varying vec3 vLocalPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vLocalPos = position;
  vec3 nl = normalize(normal);
  vec3 t = cross(vec3(0.0, 1.0, 0.0), nl);
  float tl = length(t);
  t = (tl > 0.001) ? t / tl : vec3(0.0, 0.0, -1.0);
  vec3 b = cross(nl, t);
  mat3 m3 = mat3(modelMatrix);
  vWorldNormal = normalize(m3 * nl);
  vWorldT = normalize(m3 * t);
  vWorldB = normalize(m3 * b);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// ---------------------------------------------------------------- Dünya yüzeyi

const EARTH_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uSpecGain;
uniform float uShoulder;
uniform float uDayRim;
uniform float uNormalScale;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uSpec;
uniform sampler2D uNormalMap;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vWorldT;
varying vec3 vWorldB;
varying vec3 vLocalPos;
varying vec2 vUv;
${NOISE_GLSL}

float procHeight(vec3 p) {
  float h = fbm(p * 1.45 + vec3(3.1, 1.7, 8.2));
  h += 0.22 * (fbm(p * 3.6 + vec3(9.0, 4.0, 1.0)) - 0.484);
  return h;
}

// Prosedürel kıtalar/okyanuslar/buz: doku yoksa kullanılır
void procSurface(vec3 p, out vec3 albedo, out float ocean) {
  float h = procHeight(p);
  float landM = smoothstep(0.515, 0.535, h);
  float coast = smoothstep(0.46, 0.515, h);
  vec3 water = mix(vec3(0.004, 0.022, 0.085), vec3(0.014, 0.085, 0.19), coast);
  float latW = abs(p.y);
  float moist = fbm(p * 4.0 + vec3(2.0, 7.0, 5.0));
  float desert = 0.8 * smoothstep(0.42, 0.58, 1.0 - moist) * smoothstep(0.05, 0.2, latW) * (1.0 - smoothstep(0.35, 0.62, latW));
  vec3 land = mix(vec3(0.035, 0.11, 0.03), vec3(0.10, 0.17, 0.05), smoothstep(0.35, 0.65, moist));
  land = mix(land, vec3(0.30, 0.22, 0.11), desert);
  land = mix(land, vec3(0.14, 0.12, 0.10), smoothstep(0.62, 0.72, h) * 0.8);
  land = mix(land, vec3(0.16, 0.15, 0.12), smoothstep(0.62, 0.8, latW) * 0.7);
  float iceLat = latW + 0.07 * (fbm(p * 6.0 + vec3(5.0)) - 0.484);
  float ice = smoothstep(0.80, 0.86, iceLat);
  albedo = mix(mix(water, land, landM), vec3(0.62, 0.68, 0.76), ice);
  ocean = (1.0 - landM) * (1.0 - ice);
}

// Prosedürel gece ışıkları: kara üzerinde kümeler + noktalar
float procLights(vec3 p, float land, float iceM) {
  float latA = abs(p.y);
  float pop = smoothstep(0.02, 0.2, latA) * (1.0 - smoothstep(0.5, 0.95, latA));
  float clusters = smoothstep(0.58, 0.72, fbm(p * 9.0 + vec3(4.0, 2.0, 7.0)));
  float dots = smoothstep(0.72, 0.9, vnoise(p * 85.0 + vec3(3.0)));
  return clusters * (0.25 + 0.9 * dots) * land * (1.0 - iceM) * pop;
}

void main() {
  vec3 Ng = normalize(vWorldNormal);
  vec3 N = Ng;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec3 p = normalize(vLocalPos);

  // --- albedo ve okyanus maskesi
  vec3 albedo;
  float ocean;
#ifdef EARTH_TEX_DAY
  albedo = texture2D(uDay, vUv).rgb;
  #ifdef EARTH_TEX_SPEC
  ocean = texture2D(uSpec, vUv).r;
  #else
  ocean = clamp((albedo.b - albedo.r * 1.15) * 12.0, 0.0, 1.0);
  #endif
#else
  procSurface(p, albedo, ocean);
#endif

  // --- ince kabartma (normal haritası), okyanusta kapalı
#ifdef EARTH_TEX_NORMAL
  vec3 tn = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  tn.xy *= uNormalScale * (1.0 - ocean);
  N = normalize(normalize(vWorldT) * tn.x + normalize(vWorldB) * tn.y + Ng * max(tn.z, 0.3));
#endif

  float ndl = dot(N, L);
  float ndlG = dot(Ng, L);
  float ndv = clamp(dot(Ng, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);

  // --- gündüz: yumuşak terminatör
  float dayAmt = smoothstep(-0.12, 0.14, ndlG);
  float lam = smoothstep(-0.10, 0.12, ndl) * (0.22 + 0.78 * pow(clamp(ndl + 0.04, 0.0, 1.0), 0.75));
  float tw = exp(-(ndlG / 0.16) * (ndlG / 0.16));
  vec3 lit0 = albedo * lam * uSunIntensity;
  vec3 col = lit0 / (1.0 + uShoulder * lit0); // yumuşak omuz: çöl/buz bloom'u patlatmasın
  col *= mix(vec3(1.0), vec3(1.25, 0.80, 0.55), tw * 0.7); // alacakaranlık sıcaklığı

  // --- atmosferik saçılma: gündüz kenarında mavi, terminatörde turuncu
  vec3 skyCol = vec3(0.22, 0.46, 1.0);
  col += skyCol * fres * dayAmt * uDayRim * (0.12 + 0.5 * lam);
  col += vec3(1.0, 0.42, 0.10) * tw * (0.04 + 0.30 * fres);

  // --- okyanus parıltısı (Blinn-Phong)
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float specMask = ocean * smoothstep(0.0, 0.2, ndlG);
  float spec = pow(nh, 260.0) * 1.0 + pow(nh, 40.0) * 0.05;
  col += vec3(1.0, 0.93, 0.80) * spec * specMask * uSpecGain;

  // --- gece: şehir ışıkları terminatör boyunca belirir
  float nightAmt = 1.0 - smoothstep(-0.22, 0.05, ndlG);
#ifdef EARTH_TEX_NIGHT
  vec3 lights = texture2D(uNight, vUv).rgb * 1.8;
#else
  // Gündüz tarafında ışıklar zaten nightAmt ile sıfırlanır: pahalı gürültüyü yalnızca gece kenarında hesapla
  vec3 lights = vec3(0.0);
  if (nightAmt > 0.001) {
    float iceM = smoothstep(0.35, 0.6, dot(albedo, vec3(0.3333)));
    lights = vec3(1.0, 0.80, 0.45) * procLights(p, 1.0 - ocean, iceM) * 1.1;
  }
#endif
  col += lights * vec3(1.0, 0.85, 0.6) * nightAmt;
  // çok zayıf yer ışığı ve gece kenarı hava ışıması
  col += albedo * vec3(0.5, 0.7, 1.0) * 0.012 * (1.0 - dayAmt);
  col += vec3(0.02, 0.05, 0.12) * fres * (1.0 - dayAmt) * 0.5;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- bulutlar

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uDayRim;
uniform float uCloudGain;
uniform sampler2D uClouds;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vWorldT;
varying vec3 vWorldB;
varying vec3 vLocalPos;
varying vec2 vUv;
${NOISE_GLSL}

float procClouds(vec3 p) {
  float c = fbm(p * 4.2 + vec3(5.0, 1.0, 2.0));
  c += 0.06 * cos(p.y * 7.0) + 0.05 * (fbm(p * 9.0 + vec3(3.0)) - 0.484);
  return smoothstep(0.57, 0.77, c);
}

void main() {
  vec3 Ng = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(Ng, uSunDir);
  vec3 p = normalize(vLocalPos);

  float cov;
#ifdef EARTH_TEX_CLOUDS
  vec4 t = texture2D(uClouds, vUv);
  cov = t.g * t.a;
#else
  cov = procClouds(p);
#endif

  float ndv = clamp(dot(Ng, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  float dayAmt = smoothstep(-0.10, 0.14, ndl);
  float lit = smoothstep(-0.12, 0.25, ndl) * (0.25 + 0.75 * clamp(ndl + 0.05, 0.0, 1.0));
  float tw = exp(-(ndl / 0.16) * (ndl / 0.16));

  vec3 dayCol = vec3(1.0, 0.99, 0.97) * (0.04 + 1.0 * lit);
  dayCol = mix(dayCol, vec3(1.0, 0.5, 0.25) * (0.15 + 0.5 * lit), tw * 0.55);
  dayCol += vec3(0.22, 0.46, 1.0) * fres * dayAmt * uDayRim * 0.18;
  vec3 nightCol = vec3(0.006, 0.009, 0.02);
  vec3 col = mix(nightCol, dayCol * uCloudGain, dayAmt);

  float alpha = clamp(cov * 0.92 * (1.0 + 0.35 * fres), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------- atmosfer kabuğu

const ATMO_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Işın–kabuk geometrisi: ışının merkeze en yakın noktasındaki yükseklikten parıltı hesaplanır
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uDayRim;
uniform float uRa;
uniform float uBoost;
varying vec3 vWorldPos;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  float tc = dot(-ro, rd);
  vec3 pc = ro + rd * tc;
  float b = length(pc);
  float thick = uRa - 1.0;
  float h = max(b - 1.0, 0.0);
  if (h >= thick) discard;

  float g = exp(-h / (0.18 * thick));
  g *= 1.0 - smoothstep(0.55 * thick, thick, h);

  vec3 n = pc / max(b, 0.0001);
  float s = dot(n, uSunDir);
  float dayF = smoothstep(-0.3, 0.45, s);
  float tw = exp(-(s / 0.28) * (s / 0.28));
  vec3 col = vec3(0.20, 0.48, 1.0) * dayF * uDayRim
           + vec3(1.0, 0.42, 0.10) * tw * 0.9
           + vec3(0.03, 0.07, 0.16) * 0.35 * (1.0 - dayF);
  gl_FragColor = vec4(col * g * 1.1 * uBoost, 1.0);
}
`;

// ---------------------------------------------------------------- Ay

const MOON_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform sampler2D uMap;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vWorldT;
varying vec3 vWorldB;
varying vec3 vLocalPos;
varying vec2 vUv;
${NOISE_GLSL}

void main() {
  vec3 Ng = normalize(vWorldNormal);
  vec3 p = normalize(vLocalPos);
  vec3 albedo;
#ifdef EARTH_TEX_MOON
  albedo = texture2D(uMap, vUv).rgb;
#else
  float mare = smoothstep(0.50, 0.60, fbm(p * 2.2 + vec3(4.0, 1.0, 6.0)));
  float grain = 0.75 + 0.5 * fbm(p * 18.0);
  float crater = smoothstep(0.62, 0.72, vnoise(p * 9.0 + vec3(2.0)));
  albedo = vec3(mix(0.16, 0.07, mare) * grain * (1.0 - 0.25 * crater));
#endif
  float ndl = dot(Ng, uSunDir);
  float lam = smoothstep(-0.03, 0.10, ndl) * pow(clamp(ndl, 0.0, 1.0), 0.8);
  // Dünya'nın gölgesi (ay tutulması): Güneş ekseni (+X) boyunca arkada kalan bölge
  float axisDist = length(vWorldPos.yz);
  float shade = (vWorldPos.x < 0.0) ? 1.0 - smoothstep(0.62, 1.30, axisDist) : 0.0;
  lam *= 1.0 - 0.97 * shade;
  vec3 col = albedo * lam * 1.5;
  col += vec3(0.45, 0.10, 0.03) * 0.2 * shade * smoothstep(0.0, 0.3, ndl);
  col += albedo * 0.004;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- yardımcılar

/** Radyal parıltı dokusu (canvas'sız, DataTexture) */
function makeGlowTexture(size = 128, power = 2.2) {
  const data = new Uint8Array(size * size * 4);
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h;
      const a = r >= 1 ? 0 : Math.pow(1 - r, power);
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeDummyTexture() {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

function isTex(t) {
  return !!(t && t.isTexture);
}

// ---------------------------------------------------------------- katman

export class EarthLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'EarthLayer';
    this.time = 0;
    this.cloudDrift = 0;
    this._geos = [];
    this._mats = [];
    this._texs = [];
    this._labels = [];
    this._labelMagText = '';
    this._tmp = new THREE.Vector3();

    const tex = ctx.textures || {};
    this.dummy = makeDummyTexture();
    this._texs.push(this.dummy);
    // gündüz kenarı parlaklığı (kalkan erimesinde titrer) — Dünya, bulut ve atmosfer paylaşır
    this.uDayRim = { value: 1 };

    this._buildEarth(tex);
    this._buildClouds(tex);
    this._buildAtmosphere();
    this._buildAxes();
    this._buildMoon(tex);

    ctx.scene.add(this.group);
  }

  _track(geo, mat) {
    if (geo) this._geos.push(geo);
    if (mat) this._mats.push(mat);
  }

  _buildEarth(tex) {
    // Yardımcı dokular yalnızca gündüz dokusuyla tutarlıdır; gündüz yoksa tamamen prosedürel
    const defines = {};
    const hasDay = isTex(tex.earthDay);
    if (hasDay) defines.EARTH_TEX_DAY = 1;
    if (hasDay && isTex(tex.earthNight)) defines.EARTH_TEX_NIGHT = 1;
    if (hasDay && isTex(tex.earthSpecular)) defines.EARTH_TEX_SPEC = 1;
    if (hasDay && isTex(tex.earthNormal)) defines.EARTH_TEX_NORMAL = 1;

    this.earthGroup = new THREE.Group();
    this.earthGroup.name = 'Dünya gövdesi';
    this.group.add(this.earthGroup);

    const geo = new THREE.SphereGeometry(1, 128, 64);
    const mat = new THREE.ShaderMaterial({
      defines,
      uniforms: {
        uSunDir: { value: SUN_DIR.clone() },
        uSunIntensity: { value: SUN_INTENSITY },
        uSpecGain: { value: SPEC_GAIN },
        uShoulder: { value: SHOULDER },
        uDayRim: this.uDayRim,
        uNormalScale: { value: 0.6 },
        uDay: { value: hasDay ? tex.earthDay : this.dummy },
        uNight: { value: defines.EARTH_TEX_NIGHT ? tex.earthNight : this.dummy },
        uSpec: { value: defines.EARTH_TEX_SPEC ? tex.earthSpecular : this.dummy },
        uNormalMap: { value: defines.EARTH_TEX_NORMAL ? tex.earthNormal : this.dummy },
      },
      vertexShader: SURFACE_VERT,
      fragmentShader: EARTH_FRAG,
    });
    this._track(geo, mat);
    this.earth = new THREE.Mesh(geo, mat);
    this.earth.name = 'Dünya';
    this.earthGroup.add(this.earth);
  }

  _buildClouds(tex) {
    const defines = {};
    if (isTex(tex.earthClouds)) defines.EARTH_TEX_CLOUDS = 1;
    const geo = new THREE.SphereGeometry(CLOUD_RADIUS, 96, 48);
    const mat = new THREE.ShaderMaterial({
      defines,
      uniforms: {
        uSunDir: { value: SUN_DIR.clone() },
        uDayRim: this.uDayRim,
        uCloudGain: { value: CLOUD_GAIN },
        uClouds: { value: isTex(tex.earthClouds) ? tex.earthClouds : this.dummy },
      },
      vertexShader: SURFACE_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      // uzaktan (kamera ≥ ~30 Re) 0.008'lik aralık derinlik çözünürlüğünden küçük kalır: z-çakışmasını önle
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this._track(geo, mat);
    this.clouds = new THREE.Mesh(geo, mat);
    this.clouds.name = 'Bulutlar';
    this.clouds.renderOrder = -1; // normal harmanlı: diğer katmanların eklemeli parıltılarından önce çizilir
    this.earthGroup.add(this.clouds);
  }

  _buildAtmosphere() {
    const geo = new THREE.SphereGeometry(1, 64, 32);
    this.atmoUniforms = {
      uSunDir: { value: SUN_DIR.clone() },
      uDayRim: this.uDayRim,
      uRa: { value: 1.06 },
      uBoost: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms,
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._track(geo, mat);
    this.atmo = new THREE.Mesh(geo, mat);
    this.atmo.name = 'Atmosfer';
    this.atmo.scale.setScalar(1.06);
    this.group.add(this.atmo);
  }

  // Merkezden iki yöne ayrı renkli yarı doğru: güney ucu cSouth, kuzey ucu cNorth
  _makeAxisLine(len, cSouth, cNorth, opacity) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, len, 0, 0, 0, 0, 0, -len, 0]), 3));
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array([...cNorth, ...cNorth, ...cSouth, ...cSouth]), 3),
    );
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
    this._track(geo, mat);
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    return line;
  }

  _makeMarker(r, g, b, glowTex) {
    const holder = new THREE.Group();
    const sGeo = new THREE.SphereGeometry(0.02, 12, 8);
    const sMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    sMat.color.setRGB(r, g, b);
    this._track(sGeo, sMat);
    holder.add(new THREE.Mesh(sGeo, sMat));
    const spMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color().setRGB(r * 0.6, g * 0.6, b * 0.6),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._track(null, spMat);
    const sprite = new THREE.Sprite(spMat);
    sprite.scale.setScalar(0.16);
    holder.add(sprite);
    holder.userData.sprite = sprite;
    return holder;
  }

  _buildAxes() {
    this.axesGroup = new THREE.Group();
    this.axesGroup.name = 'Eksenler';
    this.group.add(this.axesGroup);

    // dönme ekseni: beyaz, ±1.6
    this.spinLine = this._makeAxisLine(1.6, [0.85, 0.9, 1.0], [1.0, 1.0, 1.0], 0.7);
    // dipol ekseni: güney macenta, kuzey camgöbeği, ±1.7
    this.dipoleLine = this._makeAxisLine(1.7, [1.0, 0.25, 0.85], [0.2, 0.9, 1.0], 0.9);
    this.axesGroup.add(this.spinLine, this.dipoleLine);

    this.glowTex = makeGlowTexture(64, 2.0);
    this._texs.push(this.glowTex);
    this.markerGeo = this._makeMarker(1.4, 1.4, 1.6, this.glowTex);
    this.markerGeo.userData.sprite.scale.setScalar(0.1);
    this.markerMagN = this._makeMarker(0.5, 1.7, 2.1, this.glowTex);
    this.markerMagS = this._makeMarker(2.0, 0.5, 1.6, this.glowTex);
    this.axesGroup.add(this.markerGeo, this.markerMagN, this.markerMagS);

    // etiketler: üst-sol ve alt-sağ ofsetle çakışmayı azalt
    this.labelGeo = makeLabel(t('scene.earth.geoNorth'), 'small');
    this.labelGeo.center.set(1.08, 1.25);
    this.labelMag = makeLabel(t('scene.earth.magNorth'), 'accent');
    this.labelMag.center.set(-0.08, -0.25);
    this._labelMagText = t('scene.earth.magNorth');
    this.axesGroup.add(this.labelGeo, this.labelMag);
    this._labels.push(this.labelGeo, this.labelMag);
  }

  _buildMoon(tex) {
    this.moonGroup = new THREE.Group();
    this.moonGroup.name = 'Ay';
    this.group.add(this.moonGroup);

    const defines = {};
    if (isTex(tex.moon)) defines.EARTH_TEX_MOON = 1;
    const geo = new THREE.SphereGeometry(1, 48, 24);
    const mat = new THREE.ShaderMaterial({
      defines,
      uniforms: {
        uSunDir: { value: SUN_DIR.clone() },
        uMap: { value: isTex(tex.moon) ? tex.moon : this.dummy },
      },
      vertexShader: SURFACE_VERT,
      fragmentShader: MOON_FRAG,
    });
    this._track(geo, mat);
    this.moon = new THREE.Mesh(geo, mat);
    this.moon.scale.setScalar(MOON_RADIUS_RE);
    this.moonGroup.add(this.moon);

    this.moonLabel = makeLabel(t('scene.earth.moon'), 'small');
    this.moonLabel.position.set(0, MOON_RADIUS_RE + 0.5, 0);
    this.moonGroup.add(this.moonLabel);
    this._labels.push(this.moonLabel);

    // yörünge halkası (ekliptik, 5.14° eğik)
    const R = ORBITS.MOON.radiusRe;
    const inc = (ORBITS.MOON.inclinationDeg * Math.PI) / 180;
    const n = 192;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      pts[i * 3] = R * Math.cos(a);
      pts[i * 3 + 1] = R * Math.sin(a) * Math.sin(inc);
      pts[i * 3 + 2] = -R * Math.sin(a) * Math.cos(inc);
    }
    const oGeo = new THREE.BufferGeometry();
    oGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const oMat = new THREE.LineBasicMaterial({ color: 0x7f98c8, transparent: true, opacity: 0.16, depthWrite: false });
    this._track(oGeo, oMat);
    this.moonOrbit = new THREE.LineLoop(oGeo, oMat);
    this.moonOrbit.frustumCulled = false;
    this.moonGroup.add(this.moonOrbit);
    this.moonGroup.visible = false;
  }

  /** Yüzey noktası kameraya bakıyorsa (ufuk üstünde) etiketi göster */
  _faces(pos) {
    return pos.dot(this.ctx.camera.position) > 1.0;
  }

  update(visDt, simDt, realDt) {
    const ctx = this.ctx;
    const state = ctx.state;
    const fr = state.frame;
    const flags = state.params.layers;
    const camera = ctx.camera;
    this.time = (this.time + realDt) % 7200;

    // --- gövde yönelimi ve bulut sürüklenmesi
    this.earthGroup.quaternion.copy(fr.earthQuaternion);
    this.cloudDrift = (this.cloudDrift + simDt * CLOUD_DRIFT_RAD_PER_HOUR) % TAU;
    this.clouds.rotation.y = this.cloudDrift;

    // --- kalkan erimesi: gündüz kenarı hafif titrer/sönükleşir
    const shield = state.derived.shieldStrength;
    const erosion = shield < 0.1 ? 1 - Math.max(0, shield) / 0.1 : 0;
    const flick = 0.5 + 0.5 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3 + 1.0);
    this.uDayRim.value = 1 - erosion * (0.2 + 0.18 * flick);

    // --- atmosfer kabuğu: uzaktan görülebilsin diye kamera uzaklığıyla genişler
    const dist = camera.position.length();
    const ra = clamp(1.055 + 0.0012 * Math.max(dist - 4, 0), 1.055, 1.18);
    this.atmo.scale.setScalar(ra);
    this.atmoUniforms.uRa.value = ra;
    this.atmoUniforms.uBoost.value = 1 + 1.4 * smoothstep(4, 60, dist);

    // --- eksenler ve kutup işaretleri
    const axesOn = flags.axes !== false;
    this.axesGroup.visible = axesOn;
    this.labelGeo.visible = false;
    this.labelMag.visible = false;
    if (axesOn) {
      this.spinLine.quaternion.setFromUnitVectors(Y_AXIS, fr.spinAxis);
      this.dipoleLine.quaternion.setFromUnitVectors(Y_AXIS, fr.dipoleAxis);
      this.markerGeo.position.copy(fr.spinAxis).multiplyScalar(1.012);
      this.markerMagN.position.copy(fr.dipoleAxis).multiplyScalar(1.012);
      this.markerMagS.position.copy(fr.dipoleAxis).multiplyScalar(-1.012);
      const pulse = 0.16 + 0.03 * Math.sin(this.time * 3);
      this.markerMagN.userData.sprite.scale.setScalar(pulse);
      this.markerMagS.userData.sprite.scale.setScalar(pulse);

      // etiketler: kutup noktasının biraz dışında; arka yüzdeyse gizle
      this.labelGeo.position.copy(fr.spinAxis).multiplyScalar(1.03);
      this.labelMag.position.copy(fr.dipoleAxis).multiplyScalar(1.03);
      this.labelGeo.visible = this._faces(this.labelGeo.position);
      this.labelMag.visible = this._faces(this.labelMag.position);
      const text = state.derived.dipoleMoment < 0 ? t('scene.earth.magNorthRev') : t('scene.earth.magNorth');
      if (text !== this._labelMagText) {
        this._labelMagText = text;
        this.labelMag.element.textContent = text;
      }
    }

    // --- Ay
    const moonOn = flags.moon === true;
    this.moonGroup.visible = moonOn;
    if (moonOn) {
      const R = ORBITS.MOON.radiusRe;
      const inc = (ORBITS.MOON.inclinationDeg * Math.PI) / 180;
      const hrs = state.time.simHours;
      // moonGroup düğüm doğrusu etrafında döner; Ay konumu bu yerel çerçevede (düğüm +X'te) hesaplanır
      const om = NODE_AZ0_RAD - (hrs / ECLIPSE_YEAR_HOURS) * TAU;
      this.moonGroup.rotation.y = om;
      const th = (((hrs - MOON_NEW_AT_HOURS) / MOON_PERIOD_HOURS) % 1) * TAU; // Güneş yönünden ölçülen azimut
      const nu = th - om;
      const s = Math.sin(nu);
      this.moon.position.set(R * Math.cos(nu), R * s * Math.sin(inc), -R * s * Math.cos(inc));
      this.moon.rotation.y = nu + Math.PI; // yakın yüz hep Dünya'ya bakar
      this.moonLabel.position.copy(this.moon.position);
      this.moonLabel.position.y += MOON_RADIUS_RE + 0.5;
    }
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    for (const l of this._labels) {
      l.removeFromParent();
      l.element.remove();
    }
    this._labels.length = 0;
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
    for (const t of this._texs) t.dispose();
    this._geos.length = 0;
    this._mats.length = 0;
    this._texs.length = 0;
  }
}
