// Güneş katmanı: canlı plazma yüzeyi, korona, ışıklar, parlama (flare) görselleri ve Güneş–Dünya hattı.
// Güneş ölçeksizdir: (SUN_SCENE_DISTANCE, 0, 0) konumunda, SUN_VISUAL_RADIUS yarıçaplı.
// Parlama/CME fırlatma görselleri 'flare' ve 'storm:launched' olaylarıyla tetiklenir.

import * as THREE from 'three';
import { SUN_SCENE_DISTANCE, SUN_VISUAL_RADIUS } from '../core/constants.js';
import { clamp } from '../core/geo.js';
import { makeLabel } from './labels.js';
import { t } from '../i18n/index.js';

const R = SUN_VISUAL_RADIUS;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SUN_X = SUN_SCENE_DISTANCE;
const SURFACE_GAIN = 0.3; // Güneş yüzeyi parlaklığı (bloom eşiği düşük olduğundan sınırlı tutulur)
const CORONA_GAIN = 0.3;
const HALO_OPACITY = 0.08;
const HALO_RADIUS = 4; // Güneş yarıçapı cinsinden
const CORONA_HALF = 3.4; // korona düzleminin yarı boyu (Güneş yarıçapı cinsinden)
const LOOP_POOL = 3;
const LOOP_LIFE = 3.6; // saniye
const FLASH_DECAY_SEC = 2.6;
const RING_SEC = 3.0;
const FLARE_LABEL_HOLD = 5.0;
const SPRAY_N = 220;
const SPRAY_LIFE = 1.2;

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
float fbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
`;

const SUN_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
void main() {
  vLocalPos = position;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SUN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlash;
uniform float uRingR;
uniform float uRingA;
uniform float uActivity;
uniform float uGain;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
${NOISE_GLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  float t = uTime;

  // yavaş diferansiyel dönüş
  vec3 p0 = normalize(vLocalPos);
  float ra = t * 0.012;
  vec3 p = vec3(cos(ra) * p0.x + sin(ra) * p0.z, p0.y, -sin(ra) * p0.x + cos(ra) * p0.z);

  // granülasyon: akan, bükülmüş iki ölçek
  vec3 drift = vec3(t * 0.045, -t * 0.03, t * 0.02);
  float warp = fbm(p * 3.0 + drift * 0.5);
  float g1 = fbm(p * 10.0 + vec3(warp * 1.6) + drift);
  float g2 = vnoise(p * 32.0 - drift * 2.0);
  float gran = 0.62 * g1 + 0.38 * g2;
  float cell = smoothstep(0.30, 0.68, gran);
  vec3 col = mix(vec3(1.55, 0.46, 0.07), vec3(2.85, 1.70, 0.58), cell);

  // güneş lekeleri: ince, orta enlem bandında
  float sp = fbm(p * 3.2 + vec3(7.0, 2.0, 1.0));
  float band = 1.0 - smoothstep(0.35, 0.6, abs(p.y));
  float spots = smoothstep(0.66, 0.72, sp) * band;
  float umbra = smoothstep(0.72, 0.78, sp) * band;
  col *= 1.0 - 0.5 * spots - 0.3 * umbra;

  // kenar kararması
  float limb = 1.0 - 0.62 * (1.0 - mu);
  col *= limb;
  col.g *= mix(0.80, 1.0, mu);
  col.b *= mix(0.60, 1.0, mu);

  col *= (1.0 + 0.2 * uActivity) * uGain;

  // parlama: Dünya'ya bakan noktada parlak leke + yüzeyde yayılan halka
  float cosA = clamp(dot(N, vec3(-1.0, 0.0, 0.0)), -1.0, 1.0);
  float blob = pow(max(cosA, 0.0), 24.0);
  col += vec3(2.6, 1.9, 1.1) * blob * uFlash * (0.7 + 0.6 * gran);
  float rd = (acos(cosA) - uRingR) / 0.11;
  col += vec3(2.4, 1.6, 0.9) * exp(-rd * rd) * uRingA;

  gl_FragColor = vec4(col, 1.0);
}
`;

const CORONA_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uHalf;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += (uv * 2.0 - 1.0) * uHalf;
  gl_Position = projectionMatrix * mv;
}
`;

const CORONA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uActivity;
uniform float uScaleR;
uniform float uGain;
varying vec2 vUv;
${NOISE_GLSL}

void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  float rn = r * uScaleR;
  if (rn < 0.97 || r > 0.999) discard;

  float ang = atan(q.y, q.x);
  vec3 dir = vec3(cos(ang), sin(ang), 0.0);
  float s1 = fbm3(dir * 1.7 + vec3(0.0, 0.0, uTime * 0.04 + rn * 0.25));
  float s2 = fbm3(dir * 4.0 + vec3(7.0, 3.0, -uTime * 0.03 + rn * 0.4));
  float str = smoothstep(0.38, 0.78, 0.65 * s1 + 0.35 * s2);

  float base = exp(-(rn - 1.0) * 2.6);
  float halo = 0.18 / (rn * rn);
  float streamer = (0.25 + 1.5 * str) * exp(-(rn - 1.0) * 1.05);
  float I = 0.50 * base + halo + 0.42 * streamer;
  I *= 1.0 - smoothstep(0.55, 0.999, r);
  I *= (1.0 + 0.8 * uActivity) * uGain;

  vec3 warm = mix(vec3(1.0, 0.50, 0.18), vec3(1.0, 0.86, 0.60), exp(-(rn - 1.0) * 2.5));
  gl_FragColor = vec4(warm * I, 1.0);
}
`;

// ---------------------------------------------------------------- yardımcılar

/** Radyal parıltı dokusu (canvas'sız) */
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

const easeOut = (k) => 1 - (1 - k) * (1 - k);

// ---------------------------------------------------------------- katman

export class SunLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'SunLayer';
    this.time = 0;
    this._geos = [];
    this._mats = [];
    this._texs = [];
    this._labels = [];
    this._off = [];

    // etkinlik durumu
    this.activity = 0;
    this.haloOpacity = HALO_OPACITY;
    this.flash = 0;
    this.flashScale = 1;
    this.ringT = -1;
    this.flareHold = 0;
    this.flareText = '';
    this._labelText = '';
    this._lastCls = '';
    this._clsText = '';
    this.sprayAge = -1;

    // geçici nesneler (kare başına bellek ayırmamak için)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._m = new THREE.Matrix4();

    this.sunGroup = new THREE.Group();
    this.sunGroup.name = 'Güneş';
    this.sunGroup.position.set(SUN_X, 0, 0);
    this.group.add(this.sunGroup);

    this.glowTex = makeGlowTexture(128, 2.4);
    this._texs.push(this.glowTex);

    this._buildLights();
    this._buildSurface();
    this._buildCorona();
    this._buildFlareFx();
    this._buildLine();
    this._buildLabels();

    this._off.push(ctx.events.on('flare', (e) => this._onFlare(e)));
    this._off.push(ctx.events.on('storm:launched', () => this._onLaunch()));
    this._off.push(ctx.events.on('sim:reset', () => this._clearFx()));

    ctx.scene.add(this.group);
  }

  _track(geo, mat) {
    if (geo) this._geos.push(geo);
    if (mat) this._mats.push(mat);
  }

  // ---- ışıklar: standart malzemeler için Güneş yönlü ışık + çok zayıf ortam
  _buildLights() {
    this.sunLight = new THREE.DirectionalLight(0xfff4e6, 2.5);
    this.sunLight.position.set(100, 0, 0);
    this.sunLight.name = 'Güneş ışığı';
    this.ambient = new THREE.AmbientLight(0x8fa5d8, 0.06);
    this.ambient.name = 'Ortam ışığı';
    this.ctx.scene.add(this.sunLight, this.sunLight.target, this.ambient);
  }

  _buildSurface() {
    const geo = new THREE.SphereGeometry(R, 96, 48);
    this.sunUniforms = {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uRingR: { value: 0 },
      uRingA: { value: 0 },
      uActivity: { value: 0 },
      uGain: { value: SURFACE_GAIN },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.sunUniforms,
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
    });
    this._track(geo, mat);
    this.sunMesh = new THREE.Mesh(geo, mat);
    this.sunMesh.name = 'Güneş yüzeyi';
    this.sunGroup.add(this.sunMesh);
  }

  _buildCorona() {
    // 1) ışık huzmeli, parıldayan korona (kameraya dönük düzlem)
    const geo = new THREE.PlaneGeometry(1, 1);
    this.coronaUniforms = {
      uTime: { value: 0 },
      uActivity: { value: 0 },
      uScaleR: { value: CORONA_HALF },
      uGain: { value: CORONA_GAIN },
      uHalf: { value: CORONA_HALF * R },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.coronaUniforms,
      vertexShader: CORONA_VERT,
      fragmentShader: CORONA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._track(geo, mat);
    this.corona = new THREE.Mesh(geo, mat);
    this.corona.name = 'Korona';
    this.corona.frustumCulled = false;
    this.corona.renderOrder = 3;
    this.sunGroup.add(this.corona);

    // 2) geniş, sönük dış halo
    const hMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: new THREE.Color().setRGB(1.0, 0.6, 0.22),
      opacity: HALO_OPACITY,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._track(null, hMat);
    this.halo = new THREE.Sprite(hMat);
    this.halo.scale.setScalar(2 * HALO_RADIUS * R);
    this.halo.renderOrder = 2;
    this.sunGroup.add(this.halo);
  }

  _buildFlareFx() {
    // Dünya'ya bakan kenarda parlama çakması
    const fMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: new THREE.Color().setRGB(1.8, 1.3, 0.8),
      opacity: 0,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._track(null, fMat);
    this.flashSprite = new THREE.Sprite(fMat);
    this.flashSprite.position.set(-R, 0, 0);
    this.flashSprite.renderOrder = 6;
    this.flashSprite.visible = false;
    this.sunGroup.add(this.flashSprite);

    // fışkıran protüberans halkaları
    const torus = new THREE.TorusGeometry(1, 0.07, 8, 40, Math.PI);
    this._track(torus, null);
    this.loops = [];
    for (let i = 0; i < LOOP_POOL; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      m.color.setRGB(2.6, 0.8, 0.28);
      this._track(null, m);
      const mesh = new THREE.Mesh(torus, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.sunGroup.add(mesh);
      this.loops.push({
        mesh,
        mat: m,
        active: false,
        age: 0,
        life: LOOP_LIFE,
        size: 1,
        n: new THREE.Vector3(-1, 0, 0),
        delay: 0,
      });
    }

    // CME fırlatma püskürtüsü (ilk ~1 sn, −X yönünde)
    this.sprayPos0 = new Float32Array(SPRAY_N * 3);
    this.sprayVel = new Float32Array(SPRAY_N * 3);
    this.sprayDelay = new Float32Array(SPRAY_N);
    const pos = new Float32Array(SPRAY_N * 3);
    const col = new Float32Array(SPRAY_N * 3);
    const sGeo = new THREE.BufferGeometry();
    this.sprayPosAttr = new THREE.BufferAttribute(pos, 3);
    this.sprayColAttr = new THREE.BufferAttribute(col, 3);
    this.sprayPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.sprayColAttr.setUsage(THREE.DynamicDrawUsage);
    sGeo.setAttribute('position', this.sprayPosAttr);
    sGeo.setAttribute('color', this.sprayColAttr);
    const sMat = new THREE.PointsMaterial({
      map: this.glowTex,
      size: 2.6,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._track(sGeo, sMat);
    this.spray = new THREE.Points(sGeo, sMat);
    this.spray.frustumCulled = false;
    this.spray.visible = false;
    this.spray.renderOrder = 5;
    this.sunGroup.add(this.spray);
  }

  _buildLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(SUN_X - R * 1.02, 0, 0),
      new THREE.Vector3(1.15, 0, 0),
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: 0xffd27a,
      dashSize: 0.9,
      gapSize: 0.55,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this._track(geo, mat);
    this.line = new THREE.Line(geo, mat);
    this.line.computeLineDistances();
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.group.add(this.line);

    this.lineLabel = makeLabel(t('scene.sun.line'), 'small');
    this.lineLabel.position.set(SUN_X * 0.5, 0.35, 0);
    this.lineLabel.visible = false;
    this.group.add(this.lineLabel);
    this._labels.push(this.lineLabel);
  }

  _buildLabels() {
    this.sunLabel = makeLabel(t('scene.sun.label'), 'default');
    this.sunLabel.position.set(0, R + 0.9, 0);
    this.sunGroup.add(this.sunLabel);
    this._labels.push(this.sunLabel);

    this.flareLabel = makeLabel('', 'danger');
    this.flareLabel.position.set(-R - 0.4, 1.0, 0);
    this.flareLabel.visible = false;
    this.sunGroup.add(this.flareLabel);
    this._labels.push(this.flareLabel);
  }

  // ---------------------------------------------------------------- olaylar

  _onFlare(e) {
    const st = this.ctx.state;
    const flux = (e && e.storm && e.storm.flareFlux) || st.derived.xrayFlux || 1e-5;
    const L = Math.log10(Math.max(flux, 1e-8));
    this.flash = 1;
    this.flashScale = clamp(0.55 + 0.3 * (L + 5.2), 0.5, 1.4);
    this.ringT = 0;
    this.flareHold = FLARE_LABEL_HOLD;
    const cls = (e && e.flareClass) || st.derived.flareClass || '';
    this.flareText = cls ? t('scene.sun.flareCls', { cls }) : t('scene.sun.flare');

    // protüberans halkaları: yarı genişlik log10(akı) ile büyür (kare başına en çok 0.8 R)
    const half = R * clamp(0.3 + 0.2 * (L + 5.2), 0.25, 0.8);
    const count = L > -3.6 ? 3 : 2;
    for (let i = 0; i < count; i++) this._spawnLoop(this.loops[i], half * (0.8 + 0.35 * Math.random()), i * 0.35);
  }

  // Halka kamera yönüne dik (limbde, profilden) yerleştirilir: kemer yüzü kameraya bakar
  _spawnLoop(lp, size, delay) {
    const cam = this.ctx.camera.position;
    const v = this._v1.set(cam.x - SUN_X, cam.y, cam.z).normalize();
    const e1 = this._v2.crossVectors(v, Y_AXIS);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = this._v3.crossVectors(v, e1);
    const th = Math.random() * Math.PI * 2;
    const n = lp.n.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
    n.x -= 0.5; // hafifçe Dünya'ya (−X) doğru
    n.normalize();
    const t = this._v2.crossVectors(n, v);
    if (t.lengthSq() < 1e-6) t.set(0, 0, 1);
    t.normalize();
    t.applyAxisAngle(n, (Math.random() - 0.5) * 0.9);
    const b = this._v3.crossVectors(t, n);
    this._m.makeBasis(t, n, b);
    lp.mesh.quaternion.setFromRotationMatrix(this._m);
    lp.size = size;
    lp.age = 0;
    lp.delay = delay;
    lp.life = LOOP_LIFE * (0.85 + 0.3 * Math.random());
    lp.active = true;
    lp.mesh.visible = false;
  }

  _onLaunch() {
    const g = () => {
      let u = 0;
      while (u === 0) u = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    };
    const p0 = this.sprayPos0;
    const vel = this.sprayVel;
    for (let i = 0; i < SPRAY_N; i++) {
      const ry = g() * 0.32;
      const rz = g() * 0.32;
      const inv = 1 / Math.hypot(1, ry, rz);
      const rad = R * (0.96 + Math.random() * 0.06);
      p0[i * 3] = -inv * rad;
      p0[i * 3 + 1] = ry * inv * rad;
      p0[i * 3 + 2] = rz * inv * rad;
      const sp = 7 + Math.random() * 9;
      const inv2 = 1 / Math.hypot(1, ry * 1.4, rz * 1.4);
      vel[i * 3] = -inv2 * sp;
      vel[i * 3 + 1] = ry * 1.4 * inv2 * sp;
      vel[i * 3 + 2] = rz * 1.4 * inv2 * sp;
      this.sprayDelay[i] = Math.random() * 0.25;
    }
    this.sprayAge = 0;
    this.spray.visible = true;
  }

  _clearFx() {
    this.flash = 0;
    this.ringT = -1;
    this.flareHold = 0;
    this.sprayAge = -1;
    this.spray.visible = false;
    for (const lp of this.loops) {
      lp.active = false;
      lp.mesh.visible = false;
    }
  }

  // ---------------------------------------------------------------- güncelleme

  update(visDt, simDt, realDt) {
    const ctx = this.ctx;
    const state = ctx.state;
    const flags = state.params.layers;
    this.time = (this.time + realDt) % 3600;

    // --- X-ışını akısından etkinlik düzeyi (0..1), yumuşatılmış
    const xray = Math.max(state.derived.xrayFlux, 1e-9);
    const target = clamp((Math.log10(xray) + 6.5) / 3.0, 0, 1);
    this.activity += (target - this.activity) * Math.min(1, realDt * 3);

    // --- parlama çakması ve halka
    this.flash = Math.max(0, this.flash - realDt / FLASH_DECAY_SEC);
    if (this.ringT >= 0) {
      this.ringT += realDt / RING_SEC;
      if (this.ringT >= 1) this.ringT = -1;
    }
    const f = this.flash;
    const u = this.sunUniforms;
    u.uTime.value = this.time;
    u.uActivity.value = this.activity;
    u.uFlash.value = f * f * this.flashScale;
    if (this.ringT >= 0) {
      u.uRingR.value = this.ringT * 1.9;
      u.uRingA.value = (1 - this.ringT) * 0.9 * Math.min(1, this.flashScale);
    } else {
      u.uRingR.value = 0;
      u.uRingA.value = 0;
    }
    this.coronaUniforms.uTime.value = this.time;
    this.coronaUniforms.uActivity.value = this.activity;
    // korona hafifçe nefes alır
    this.halo.material.opacity = this.haloOpacity * (0.9 + 0.16 * Math.sin(this.time * 0.7) + 0.3 * this.activity);

    // çakma sprite'ı: kamera ufuk gerisindeyse sönük
    const camX = ctx.camera.position.x;
    const vis = clamp((SUN_X - R - camX) / 8 + 0.5, 0, 1);
    const fs = this.flashSprite;
    if (f > 0.003 && vis > 0) {
      fs.visible = true;
      fs.material.opacity = Math.min(0.85, f * f * this.flashScale) * vis;
      fs.scale.setScalar(R * (0.6 + 1.4 * f) * this.flashScale);
    } else {
      fs.visible = false;
    }

    this._updateLoops(realDt);
    this._updateSpray(realDt);

    // --- etiketler
    this.flareHold = Math.max(0, this.flareHold - realDt);
    const flaring = this.flareHold > 0 || state.derived.xrayFlux >= 1e-5;
    this.flareLabel.visible = flaring;
    if (flaring) {
      let text = this.flareText;
      if (this.flareHold <= 0) {
        // sınıf değişmedikçe metin yeniden oluşturulmaz (kare başına string ayırma yok)
        const cls = state.derived.flareClass;
        if (cls !== this._lastCls) {
          this._lastCls = cls;
          this._clsText = t('scene.sun.flareCls', { cls });
        }
        text = this._clsText;
      }
      if (text !== this._labelText) {
        this._labelText = text;
        this.flareLabel.element.textContent = text;
      }
    }

    // --- Güneş–Dünya hattı
    const lineOn = flags.sunEarthLine === true;
    this.line.visible = lineOn;
    this.lineLabel.visible = lineOn;
  }

  _updateLoops(realDt) {
    for (const lp of this.loops) {
      if (!lp.active) continue;
      if (lp.delay > 0) {
        lp.delay -= realDt;
        continue;
      }
      lp.age += realDt;
      const k = lp.age / lp.life;
      if (k >= 1) {
        lp.active = false;
        lp.mesh.visible = false;
        continue;
      }
      lp.mesh.visible = true;
      const s = lp.size * (0.25 + 0.75 * easeOut(Math.min(1, k * 1.6)));
      lp.mesh.scale.setScalar(s);
      // ayaklar yüzeye oturur: yarı açıklığı s olan halkanın merkezi Güneş merkezinden √(R²−s²) uzakta olmalı;
      // ömrün son evresinde halka yüzeyden kopup dışarı fırlar (püskürme)
      const sc = Math.min(s, 0.95 * R);
      const e = Math.max(0, k - 0.55) / 0.45;
      const lift = s * 0.55 * e * e;
      const base = Math.sqrt(R * R - sc * sc) * 0.995 - 0.03 + lift;
      lp.mesh.position.copy(lp.n).multiplyScalar(base);
      lp.mat.opacity = Math.pow(Math.sin(Math.PI * k), 0.8);
    }
  }

  _updateSpray(realDt) {
    if (this.sprayAge < 0) return;
    this.sprayAge += realDt;
    const pos = this.sprayPosAttr.array;
    const col = this.sprayColAttr.array;
    const p0 = this.sprayPos0;
    const vel = this.sprayVel;
    const age = this.sprayAge;
    for (let i = 0; i < SPRAY_N; i++) {
      const a = age - this.sprayDelay[i];
      const j = i * 3;
      if (a <= 0 || a > SPRAY_LIFE) {
        pos[j] = p0[j];
        pos[j + 1] = p0[j + 1];
        pos[j + 2] = p0[j + 2];
        col[j] = 0;
        col[j + 1] = 0;
        col[j + 2] = 0;
        continue;
      }
      const k = a / SPRAY_LIFE;
      const d = a * (1 - 0.35 * k);
      pos[j] = p0[j] + vel[j] * d;
      pos[j + 1] = p0[j + 1] + vel[j + 1] * d;
      pos[j + 2] = p0[j + 2] + vel[j + 2] * d;
      const fade = Math.pow(1 - k, 1.5) * Math.min(1, a * 6);
      col[j] = 2.2 * fade;
      col[j + 1] = 0.9 * fade;
      col[j + 2] = 0.35 * fade;
    }
    this.sprayPosAttr.needsUpdate = true;
    this.sprayColAttr.needsUpdate = true;
    if (age > SPRAY_LIFE + 0.3) {
      this.sprayAge = -1;
      this.spray.visible = false;
    }
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    const scene = this.ctx.scene;
    scene.remove(this.group);
    scene.remove(this.sunLight, this.sunLight.target, this.ambient);
    this.sunLight.dispose?.();
    this.ambient.dispose?.();
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
