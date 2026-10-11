// Yıldız alanı: ~7000 nokta yıldız (ekran-uzayı boyut, sıcaklık renkleri, hafif titreşim)
// + soluk bir Samanyolu bandı. Küme kameraya bağlıdır (gölgelendiricide yalnızca görüş dönüşü; paralaks yok).
// Parlaklıklar bilerek düşük tutulur: bloom (eşik 0.2) yıldızları patlatmasın.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const STAR_COUNT = 7000;
const STAR_RADIUS = 1400;
const MW_RADIUS = 1450;
const GAL_TILT_DEG = 60; // galaktik düzlemin ekliptiğe eğimi
const BAND_FRACTION = 0.38; // yıldızların galaktik banda yoğunlaşan oranı
const MW_TEX_W = 512;
const MW_TEX_H = 256;
const MW_INTENSITY = 0.14;

// ---------------------------------------------------------------- yardımcılar (CPU)

function mulberry32(seed) {
  let a = seed | 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

function fbm3(x, y, z, octaves) {
  let a = 0.5;
  let s = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise3(x, y, z);
    x = x * 2.03 + 1.7;
    y = y * 2.03 + 9.2;
    z = z * 2.03 + 3.1;
    a *= 0.5;
  }
  return s;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Kara cisim sıcaklığı (K) → yaklaşık RGB (0..1), beyaza doğru seyreltilmiş */
function starColor(T, out) {
  const t = T / 100;
  let r;
  let g;
  let b;
  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  r = clamp01(r / 255);
  g = clamp01(g / 255);
  b = clamp01(b / 255);
  const k = 0.5; // beyaza karıştırma
  out[0] = r + (1 - r) * k;
  out[1] = g + (1 - g) * k;
  out[2] = b + (1 - b) * k;
  return out;
}

/** Yıldız türü dağılımına göre rastgele sıcaklık */
function randomTemperature(rand) {
  const u = rand();
  if (u < 0.07) return 9000 + rand() * 7000; // B: mavi-beyaz
  if (u < 0.2) return 7200 + rand() * 1800; // A: beyaz
  if (u < 0.4) return 5900 + rand() * 1300; // F/G: sarımsı beyaz
  if (u < 0.68) return 4700 + rand() * 1200; // G/K: sarı-turuncu
  return 3300 + rand() * 1400; // K/M: turuncu-kırmızı
}

/** Galaktik düzlem tabanı: g normal, e1 ve e2 düzlem içi */
function galacticBasis() {
  const t = GAL_TILT_DEG * (Math.PI / 180);
  const g = new THREE.Vector3(0, Math.cos(t), Math.sin(t));
  const e1 = new THREE.Vector3(1, 0, 0);
  const e2 = new THREE.Vector3().crossVectors(g, e1).normalize();
  return { g, e1, e2 };
}

/** Samanyolu bandını eşdikdörtgen küçük bir dokuya pişirir (çalışma zamanında yalnızca 1 doku okuması). */
function buildMilkyWayTexture(basis) {
  const W = MW_TEX_W;
  const H = MW_TEX_H;
  const data = new Uint8Array(W * H * 4);
  const { g, e1, e2 } = basis;
  // galaktik merkez yönü (düzlem içinde)
  const psiC = 0.8;
  const cx = e1.x * Math.cos(psiC) + e2.x * Math.sin(psiC);
  const cy = e1.y * Math.cos(psiC) + e2.y * Math.sin(psiC);
  const cz = e1.z * Math.cos(psiC) + e2.z * Math.sin(psiC);
  const cosA = new Float32Array(W);
  const sinA = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const a = ((i + 0.5) / W - 0.5) * TAU;
    cosA[i] = Math.cos(a);
    sinA[i] = Math.sin(a);
  }
  for (let j = 0; j < H; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI;
    const dy = Math.sin(lat);
    const cl = Math.cos(lat);
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      data[o + 3] = 255;
      const dx = cl * cosA[i];
      const dz = cl * sinA[i];
      const b = dx * g.x + dy * g.y + dz * g.z;
      if (Math.abs(b) > 0.5) continue;
      const b2 = b * b;
      const band = Math.exp(-b2 / (2 * 0.1 * 0.1));
      const wide = Math.exp(-b2 / (2 * 0.22 * 0.22));
      const lonC = dx * cx + dy * cy + dz * cz;
      const bulge = Math.pow(clamp01(lonC * 0.5 + 0.5), 3);
      const n1 = fbm3(dx * 5 + 11, dy * 5 + 11, dz * 5 + 11, 4);
      const n2 = fbm3(dx * 14 + 3, dy * 14 + 3, dz * 14 + 3, 3);
      const dust = Math.abs(b) < 0.25 ? smooth(0.52, 0.72, fbm3(dx * 8 + 7, dy * 8 + 7, dz * 8 + 7, 3)) * Math.exp(-b2 / (2 * 0.06 * 0.06)) : 0;
      let v = (band * (0.5 + 0.9 * n1) + 0.35 * wide * n2) * (0.45 + 1.1 * bulge);
      v *= 1 - 0.7 * dust;
      const e = clamp01(v / 3);
      const warm = clamp01(bulge * 0.9);
      data[o] = Math.round((0.62 + 0.38 * warm) * e * 255);
      data[o + 1] = Math.round((0.72 + 0.1 * warm) * e * 255);
      data[o + 2] = Math.round((1.0 - 0.42 * warm) * e * 255);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- gölgelendiriciler

const STAR_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute vec3 aTw;
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  // yalnızca görüş dönüşü: yıldızlar sonsuzda gibi kameraya bağlı kalır (kare gecikmesi/paralaks yok)
  vec4 mv = vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 - aTw.z * (0.5 + 0.5 * sin(uTime * aTw.y + aTw.x));
  vColor = aColor * tw;
  gl_PointSize = aSize * uPixelRatio;
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  float a = 1.0 - smoothstep(0.35, 1.0, d);
  gl_FragColor = vec4(vColor, a);
}
`;

const MW_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}
`;

const MW_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  vec3 c = texture2D(uMap, uv).rgb * uIntensity;
  gl_FragColor = vec4(c, 1.0);
}
`;

// ---------------------------------------------------------------- katman

export class StarfieldLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'StarfieldLayer';
    this.time = 0;

    const basis = galacticBasis();
    this._buildStars(basis);
    this._buildMilkyWay(basis);

    ctx.scene.add(this.group);
  }

  _buildStars(basis) {
    const rand = mulberry32(0x5eed1234);
    const gauss = () => {
      let u = 0;
      while (u === 0) u = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand());
    };
    const n = STAR_COUNT;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const tw = new Float32Array(n * 3);
    const rgb = [1, 1, 1];
    const { g, e1, e2 } = basis;

    for (let i = 0; i < n; i++) {
      let dx;
      let dy;
      let dz;
      const inBand = rand() < BAND_FRACTION;
      if (inBand) {
        // galaktik düzlem boyunca düzgün, düzleme dik yönde gauss
        const psi = rand() * TAU;
        const off = 0.13 * gauss();
        dx = e1.x * Math.cos(psi) + e2.x * Math.sin(psi) + g.x * off;
        dy = e1.y * Math.cos(psi) + e2.y * Math.sin(psi) + g.y * off;
        dz = e1.z * Math.cos(psi) + e2.z * Math.sin(psi) + g.z * off;
      } else {
        const z = 2 * rand() - 1;
        const ph = TAU * rand();
        const rho = Math.sqrt(Math.max(0, 1 - z * z));
        dx = rho * Math.cos(ph);
        dy = z;
        dz = rho * Math.sin(ph);
      }
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      pos[i * 3] = dx * STAR_RADIUS;
      pos[i * 3 + 1] = dy * STAR_RADIUS;
      pos[i * 3 + 2] = dz * STAR_RADIUS;

      const mag = Math.pow(rand(), 8); // çoğu sönük, çok azı parlak
      let base = 0.1 + mag * 0.6;
      if (inBand) base *= 0.8;
      starColor(randomTemperature(rand), rgb);
      col[i * 3] = rgb[0] * base;
      col[i * 3 + 1] = rgb[1] * base;
      col[i * 3 + 2] = rgb[2] * base;
      size[i] = Math.min(3.2, 1.0 + mag * 1.9 + rand() * 0.25);
      tw[i * 3] = rand() * TAU; // faz
      tw[i * 3 + 1] = 0.8 + rand() * 2.2; // hız
      tw[i * 3 + 2] = 0.1 + 0.25 * mag + rand() * 0.06; // genlik
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aTw', new THREE.BufferAttribute(tw, 3));

    this.starUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    };
    this.starMat = new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.name = 'Yıldızlar';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -20;
    this.group.add(this.stars);
  }

  _buildMilkyWay(basis) {
    this.mwTexture = buildMilkyWayTexture(basis);
    const geo = new THREE.SphereGeometry(MW_RADIUS, 48, 24);
    this.mwMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.mwTexture },
        uIntensity: { value: MW_INTENSITY },
      },
      vertexShader: MW_VERT,
      fragmentShader: MW_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.milkyWay = new THREE.Mesh(geo, this.mwMat);
    this.milkyWay.name = 'Samanyolu';
    this.milkyWay.frustumCulled = false;
    this.milkyWay.renderOrder = -21;
    this.group.add(this.milkyWay);
  }

  update(visDt, simDt, realDt) {
    const ctx = this.ctx;
    const on = ctx.state.params.layers.stars !== false;
    this.group.visible = on;
    if (!on) return;
    this.time = (this.time + realDt) % 3600;
    this.starUniforms.uTime.value = this.time;
    const pr = ctx.renderer && ctx.renderer.getPixelRatio ? ctx.renderer.getPixelRatio() : 1;
    this.starUniforms.uPixelRatio.value = pr > 0 ? pr : 1;
    // kameraya bağlama köşe gölgelendiricisinde yapılır (viewMatrix'in dönme kısmı)
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.milkyWay.geometry.dispose();
    this.mwMat.dispose();
    this.mwTexture.dispose();
  }
}
