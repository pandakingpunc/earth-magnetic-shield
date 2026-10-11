// Kozmik ışınlar + güneş enerjik parçacıkları (SEP).
//
// Gerçek yüklü parçacık dinamiği: göreli Boris itici (physics/particles.js advanceParticle),
// dipol(+kuadrupol) alanında, manyetopozda kırpılmış model. Kalkan parçacıkları saptırır, yansıtır,
// kutuplara yönlendirir; kalkan kapalıyken hepsi çarpar. Hiçbir yörünge "elle" çizilmez.
//
// Kaynaklar:
//  a) GKI ('gcr'): izotropik, sürekli Poisson, dN/dR ∝ R^-2.7 (0.5..200 GV).
//  b) Patlama ('burst'): 'cosmic:burst' olayı, ~1.2 sn boyunca paralel demet.
//  c) SEP ('sep'): derived.sepPfu >= 1 iken Güneş tarafından, 0.15..1.2 GV.
//
// Görsel örnekleme notu: yüzeye ulaşan yörüngeler çok nadirdir (kayıp konisi; rastgele hedeflenen
// kozmik ışının kutuba varma olasılığı ~%0.2). Bu yüzden parçacıkların bir kısmı TERS-YÖRÜNGE
// yöntemiyle üretilir: yüzeyden dışa, yükü ters çevrilmiş bir parçacık izlenir; r=28 Re'ye kaçıyorsa
// o yörünge izinlidir ve ileri yönde oynatılır (kesme sertliği hesaplarının standart yöntemi).
// Böylece Störmer kesme sertliği, kutup hunileri ve yüksek sertlikte düşük enlemlere erişim doğal
// olarak görünür. Kalan parçacıklar izotropik hedeflenir ve çoğu saptırılır / yansır.

import * as THREE from 'three';
import { COLORS, VISUAL, DIPOLE } from '../core/constants.js';
import { DEG, clamp, lerp, smoothstep, magneticLatitudeDeg } from '../core/geo.js';
import { fieldModelFromState, minLatitudeForRigidity } from '../physics/dipole.js';
import { advanceParticle, adaptiveStep } from '../physics/particles.js';
import { makeLabel } from './labels.js';
import { t } from '../i18n/index.js';

// ---- Sabitler
const MAX_P = 500; // en çok canlı parçacık
const TRAIL = 48; // iz noktası sayısı (halka tampon)
const SEGS = TRAIL; // canlı baş → en yeni nokta → ... → en eski nokta
const R_SRC = 30; // kaynak küre yarıçapı (Re)
const R_FUNNEL = 28; // ters-yörünge başlangıç yarıçapı
const R_ESC = 45;
const R_HIT = 1.02;
const MAX_AGE = 14; // görsel sn; yarı-tuzaklı parçacıkları yok et
const STEP_BUDGET_MAX = 9000; // kare başına Boris alt adımı üst sınırı
const STEP_BUDGET_MIN = 1500;
const MIN_ALLOC = 6; // parçacık başına en az alt adım
const MAX_CHUNKS = 12; // parçacık başına kare içi en çok parça (iz örneği)
const MIN_SPACING = 0.06; // iz örnekleri arası en az yol (Re)
const TRAIL_STEP = 0.24; // düz uçuşta iz örnekleri arası yol (Re): iz uzunluğu kare hızından bağımsız
const MAX_SPAWN_PER_FRAME = 40;
const FUNNEL_MS = 0.9; // kare başına ters-yörünge CPU bütçesi (ms)
const REV_CALLS = 26; // ters izleme: çağrı sayısı (her biri 2.5 Re)
const FUNNEL_P_GCR = 0.3; // GKI'nın ters-yörünge ile üretilen payı
const FUNNEL_P_SEP = 0.4;
const BURST_SPAWN_SEC = 1.2;
const LABEL_SEC = 2.0;
const MAX_JOBS = 6;

const FLASH_MAX = 48;
const FLASH_SEC = 0.6;
const SPARK_MAX = 400;
const SPARKS_PER_HIT = 10;
const FX_MAX = MAX_P + FLASH_MAX + SPARK_MAX;

const KIND_GCR = 0;
const KIND_BURST = 1;
const KIND_SEP = 2;
const KIND_NAMES = ['gcr', 'burst', 'sep'];
const HEAD_SIZE = [0.22, 0.26, 0.26]; // dünya birimi (en az ~3 px)

// Sertlik spektrumu: dN/dR ∝ R^-2.7, [0.5, 200] GV (ters kümülatif dağılım)
const G1 = 1 - 2.7;
const R_SPEC_A = Math.pow(0.5, G1);
const R_SPEC_B = Math.pow(200, G1);

const C_PROTON = new THREE.Color(COLORS.cosmicProton);
const C_ELECTRON = new THREE.Color(COLORS.cosmicElectron);
const C_ALPHA = new THREE.Color(0xfff0d6); // sıcak beyaz
const C_SEP = new THREE.Color(COLORS.sep);

const TRAIL_GAIN = 0.85;
const HEAD_GAIN = 2.0;

// ---- Yardımcılar
let _spare = null;
function gauss() {
  if (_spare !== null) {
    const s = _spare;
    _spare = null;
    return s;
  }
  let u = 0;
  while (u === 0) u = Math.random();
  const v = Math.random();
  const m = Math.sqrt(-2 * Math.log(u));
  _spare = m * Math.sin(2 * Math.PI * v);
  return m * Math.cos(2 * Math.PI * v);
}

function sampleRigidity() {
  return Math.pow(R_SPEC_A + Math.random() * (R_SPEC_B - R_SPEC_A), 1 / G1);
}

function makeParticle(i) {
  return {
    pos: [0, 0, 0],
    dir: [1, 0, 0],
    rigidity: 1, // GV
    charge: 1, // itici için işaret (±1)
    q: 1, // gerçek yük (+1, −1, +2)
    kind: 'gcr',
    kindId: KIND_GCR,
    age: 0,
    alive: false,
    dying: false,
    fade: 1,
    fadeRate: 2,
    lastB: 0,
    acc: 0, // son iz örneğinden beri alınan yol (Re)
    th: 0, // iz halka tamponu: bir sonraki yazım indeksi
    tc: 0, // iz nokta sayısı
    id: i,
    off: i * TRAIL * 3,
    cr: 1, cg: 1, cb: 1,
    need: 0,
  };
}

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uPxScale;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uSoftPx;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float viewDepth = max(-mv.z, 0.05);
  float px = aSize * uPxScale / viewDepth;
  // Yakın planda yumuşak doygunluk: başlar dev toplara dönüşmesin
  px = px / (1.0 + px / uSoftPx);
  gl_PointSize = clamp(px, uMinPx, uMaxPx);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c) * 2.0;
  if (d >= 1.0) discard;
  float core = exp(-d * d * 6.0);
  float halo = (1.0 - d) * (1.0 - d) * 0.3;
  gl_FragColor = vec4(vColor * (core + halo), 1.0);
}
`;

export class CosmicRayLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'CosmicRayLayer';
    ctx.scene.add(this.group);

    this._model = fieldModelFromState(ctx.state);
    this._opts = { rHit: R_HIT, rEscape: R_ESC, maxSubsteps: 400 };
    this._revOpts = { rHit: 1.0, rEscape: R_FUNNEL, maxSubsteps: 300 };
    this._rp = { pos: [0, 0, 0], dir: [1, 0, 0], rigidity: 1, charge: 1, lastB: 0 };
    this._v3 = new THREE.Vector3();
    this._v2 = new THREE.Vector2();
    this._b1 = [0, 0, 0];
    this._b2 = [0, 0, 0];
    this._shieldW = 1;
    this._crowd = 1;
    this._axisW = 0; // yarı-statik eksen ağırlığı (0: gerçek eksen)
    this._budget = 6000;
    this._revMs = 0;
    this._dirty = false;
    this._active = false;
    this.liveCount = 0;

    // ---- Parçacık havuzu
    this._pool = [];
    for (let i = 0; i < MAX_P; i++) this._pool.push(makeParticle(i));
    this._free = new Int32Array(MAX_P);
    this._nFree = 0;
    this._trail = new Float32Array(MAX_P * TRAIL * 3);
    this._fadeTab = new Float32Array(TRAIL + 1);
    for (let k = 0; k <= TRAIL; k++) this._fadeTab[k] = Math.pow(1 - k / TRAIL, 1.7);

    // ---- Patlama işleri (önceden ayrılmış)
    this._jobs = [];
    for (let i = 0; i < MAX_JOBS; i++) {
      this._jobs.push({
        active: false, n: [0, 0, 0], e1: [0, 0, 0], e2: [0, 0, 0],
        R: 5, q: 1, remaining: 0, rate: 0, acc: 0, elapsed: 0, aimR: 5,
      });
    }

    // ---- İzler: tek LineSegments
    const maxVerts = MAX_P * SEGS * 2;
    this._tPos = new Float32Array(maxVerts * 3);
    this._tCol = new Float32Array(maxVerts * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this._tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this._tCol, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setDrawRange(0, 0);
    this.trails = new THREE.LineSegments(
      tg,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.trails.name = 'CosmicTrails';
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 4;
    this.group.add(this.trails);

    // ---- Başlar + parlamalar + kıvılcımlar: tek Points
    this._fPos = new Float32Array(FX_MAX * 3);
    this._fCol = new Float32Array(FX_MAX * 3);
    this._fSize = new Float32Array(FX_MAX);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this._fPos, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('aColor', new THREE.BufferAttribute(this._fCol, 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('aSize', new THREE.BufferAttribute(this._fSize, 1).setUsage(THREE.DynamicDrawUsage));
    fg.setDrawRange(0, 0);
    this._fxMat = new THREE.ShaderMaterial({
      uniforms: {
        uPxScale: { value: 600 },
        uMinPx: { value: 3 },
        uMaxPx: { value: 64 },
        uSoftPx: { value: 56 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fx = new THREE.Points(fg, this._fxMat);
    this.fx.name = 'CosmicFx';
    this.fx.frustumCulled = false;
    this.fx.renderOrder = 5;
    this.group.add(this.fx);

    // ---- Çarpma parlamaları (halka tampon)
    this._fxPos = new Float32Array(FLASH_MAX * 3);
    this._fxCol = new Float32Array(FLASH_MAX * 3);
    this._fxSize = new Float32Array(FLASH_MAX);
    this._fxAge = new Float32Array(FLASH_MAX).fill(-1);
    this._fxNext = 0;

    // ---- Hava sağanağı kıvılcımları (halka tampon)
    this._sPos = new Float32Array(SPARK_MAX * 3);
    this._sVel = new Float32Array(SPARK_MAX * 3);
    this._sCol = new Float32Array(SPARK_MAX * 3);
    this._sLife = new Float32Array(SPARK_MAX);
    this._sMax = new Float32Array(SPARK_MAX).fill(1);
    this._sNext = 0;

    // ---- Patlama kaynağı etiketleri
    this._labels = [];
    for (let i = 0; i < 3; i++) {
      const obj = makeLabel(t('scene.cosmic.burst'), 'accent');
      obj.visible = false;
      this.group.add(obj);
      this._labels.push({ obj, life: 0 });
    }

    this._resetPool();

    this._offBurst = ctx.events.on('cosmic:burst', (e) => this._onBurst(e));
    this._offReset = ctx.events.on('sim:reset', () => this._clearAll());
  }

  // ------------------------------------------------------------------ havuz

  _resetPool() {
    this._nFree = 0;
    for (let i = MAX_P - 1; i >= 0; i--) {
      this._pool[i].alive = false;
      this._free[this._nFree++] = i;
    }
  }

  _release(i) {
    this._pool[i].alive = false;
    this._free[this._nFree++] = i;
  }

  /** Boş yuva döndürür; doluysa ölmekte olanı, sonra (GKI değilse) en eski GKI'yı çıkarır. -1: yer yok. */
  _alloc(kindId) {
    if (this._nFree > 0) return this._free[--this._nFree];
    const pool = this._pool;
    let best = -1;
    let bestV = 2;
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i];
      if (p.alive && p.dying && p.fade < bestV) {
        bestV = p.fade;
        best = i;
      }
    }
    if (best >= 0) return best;
    if (kindId === KIND_GCR) return -1;
    let bestAge = -1;
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i];
      if (p.alive && p.kindId === KIND_GCR && p.age > bestAge) {
        bestAge = p.age;
        best = i;
      }
    }
    return best;
  }

  _clearAll() {
    this._resetPool();
    for (const j of this._jobs) j.active = false;
    this._fxAge.fill(-1);
    this._sLife.fill(0);
    for (const L of this._labels) {
      L.life = 0;
      L.obj.visible = false;
    }
    this.trails.geometry.setDrawRange(0, 0);
    this.fx.geometry.setDrawRange(0, 0);
    this.liveCount = 0;
    this._crowd = 1;
    this._dirty = false;
  }

  _pushTrail(p) {
    const t = this._trail;
    const o = p.off + p.th * 3;
    t[o] = p.pos[0];
    t[o + 1] = p.pos[1];
    t[o + 2] = p.pos[2];
    p.th++;
    if (p.th >= TRAIL) p.th = 0;
    if (p.tc < TRAIL) p.tc++;
  }

  /** Parçacığı başlatır ve istatistiği artırır. */
  _launch(i, x, y, z, dx, dy, dz, R, q, kindId) {
    const p = this._pool[i];
    const dn = Math.hypot(dx, dy, dz) || 1;
    p.pos[0] = x; p.pos[1] = y; p.pos[2] = z;
    p.dir[0] = dx / dn; p.dir[1] = dy / dn; p.dir[2] = dz / dn;
    p.rigidity = R;
    p.q = q;
    p.charge = q < 0 ? -1 : 1;
    p.kindId = kindId;
    p.kind = KIND_NAMES[kindId];
    p.age = 0;
    p.alive = true;
    p.dying = false;
    p.fade = 1;
    p.lastB = 0;
    p.acc = 0;
    p.th = 0;
    p.tc = 0;
    // Renk: yük/tür + log sertliğe göre parlaklık
    const c = kindId === KIND_SEP ? C_SEP : q < 0 ? C_ELECTRON : q > 1 ? C_ALPHA : C_PROTON;
    const br = 0.7 + 0.9 * clamp((Math.log10(R) + 1) / 3.3, 0, 1);
    p.cr = c.r * br;
    p.cg = c.g * br;
    p.cb = c.b * br;
    this._pushTrail(p);
    this.ctx.state.cosmic.stats.spawned++;
  }

  _startDying(p, rate) {
    p.dying = true;
    p.fade = 1;
    p.fadeRate = rate;
  }

  // ------------------------------------------------------------------ kaynaklar

  /** n'ye dik birim taban (b1, b2) hesaplar */
  _perp(nx, ny, nz) {
    const hx = Math.abs(ny) < 0.9 ? 0 : 1;
    const hy = Math.abs(ny) < 0.9 ? 1 : 0;
    // e1 = h × n
    let ex = hy * nz;
    let ey = -hx * nz;
    let ez = hx * ny - hy * nx;
    const l = Math.hypot(ex, ey, ez) || 1;
    ex /= l; ey /= l; ez /= l;
    const b1 = this._b1;
    const b2 = this._b2;
    b1[0] = ex; b1[1] = ey; b1[2] = ez;
    // e2 = n × e1
    b2[0] = ny * ez - nz * ey;
    b2[1] = nz * ex - nx * ez;
    b2[2] = nx * ey - ny * ex;
  }

  _poisson(mean) {
    if (mean <= 0) return 0;
    if (mean > 25) return Math.min(MAX_SPAWN_PER_FRAME, Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss())));
    const L = Math.exp(-mean);
    let k = 0;
    let pr = 1;
    do {
      k++;
      pr *= Math.random();
    } while (pr > L);
    return Math.min(k - 1, MAX_SPAWN_PER_FRAME);
  }

  /** İzotropik: r=R_SRC küresinden Dünya çevresindeki bir diske doğru */
  _spawnIsotropic(kindId, R, q) {
    const i = this._alloc(kindId);
    if (i < 0) return false;
    const u = 2 * Math.random() - 1;
    const ph = 2 * Math.PI * Math.random();
    const s = Math.sqrt(1 - u * u);
    const nx = s * Math.cos(ph);
    const ny = u;
    const nz = s * Math.sin(ph);
    this._perp(nx, ny, nz);
    const aimR = lerp(1.5, 4.0, this._shieldW); // kalkan yokken neredeyse hepsi çarpsın
    const rho = aimR * Math.sqrt(Math.random());
    const a2 = 2 * Math.PI * Math.random();
    const ca = rho * Math.cos(a2);
    const sa = rho * Math.sin(a2);
    const b1 = this._b1;
    const b2 = this._b2;
    const sx = nx * R_SRC;
    const sy = ny * R_SRC;
    const sz = nz * R_SRC;
    this._launch(
      i, sx, sy, sz,
      b1[0] * ca + b2[0] * sa - sx,
      b1[1] * ca + b2[1] * sa - sy,
      b1[2] * ca + b2[2] * sa - sz,
      R, q, kindId,
    );
    return true;
  }

  /**
   * Ters-yörünge örneklemesi: yüzeyde (kesme sertliğinin izin verdiği enlemlerde) rastgele bir noktadan
   * dışa, yükü ters bir parçacık izlenir. r=R_FUNNEL'e kaçarsa yörünge izinlidir → ileri yönde oynatılır.
   */
  _spawnFunnel(kindId, R, q, sunward) {
    const model = this._model;
    const ax = model.axis;
    const lmin = minLatitudeForRigidity(R, Math.abs(model.M));
    const epsMax = clamp(95 - lmin, 8, 95);
    const cosMax = Math.cos(epsMax * DEG);
    this._perp(ax[0], ax[1], ax[2]);
    const b1 = this._b1;
    const b2 = this._b2;
    const rp = this._rp;
    const sq = q < 0 ? -1 : 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this._revMs >= FUNNEL_MS) return false;
      const t0 = performance.now();
      const sgn = Math.random() < 0.5 ? -1 : 1;
      const cosE = 1 - Math.random() * (1 - cosMax);
      const sinE = Math.sqrt(Math.max(0, 1 - cosE * cosE));
      const az = 2 * Math.PI * Math.random();
      const ca = Math.cos(az);
      const sa = Math.sin(az);
      const px = sgn * ax[0] * cosE + sinE * (b1[0] * ca + b2[0] * sa);
      const py = sgn * ax[1] * cosE + sinE * (b1[1] * ca + b2[1] * sa);
      const pz = sgn * ax[2] * cosE + sinE * (b1[2] * ca + b2[2] * sa);
      let dx = px + 0.55 * gauss();
      let dy = py + 0.55 * gauss();
      let dz = pz + 0.55 * gauss();
      let dn = Math.hypot(dx, dy, dz) || 1;
      dx /= dn; dy /= dn; dz /= dn;
      if (dx * px + dy * py + dz * pz < 0.1) {
        dx += px; dy += py; dz += pz;
        dn = Math.hypot(dx, dy, dz) || 1;
        dx /= dn; dy /= dn; dz /= dn;
      }
      rp.pos[0] = px * 1.021; rp.pos[1] = py * 1.021; rp.pos[2] = pz * 1.021;
      rp.dir[0] = dx; rp.dir[1] = dy; rp.dir[2] = dz;
      rp.rigidity = R;
      rp.charge = -sq; // zaman tersi: yük işareti ters
      rp.lastB = 0;
      let out = 0; // 1: kaçtı (izinli), −1: yüzeye döndü (yasak), 0: belirsiz
      for (let c = 0; c < REV_CALLS; c++) {
        const res = advanceParticle(rp, 2.5, model, this._revOpts);
        if (res.hit) { out = -1; break; }
        if (res.escaped) { out = 1; break; }
        if (performance.now() - t0 > 0.6) break;
      }
      this._revMs += performance.now() - t0;
      if (out !== 1) continue;
      const rr = Math.hypot(rp.pos[0], rp.pos[1], rp.pos[2]);
      if (!(rr > 1) || !Number.isFinite(rr)) continue;
      if (sunward && rp.pos[0] / rr < 0.5) continue;
      const slot = this._alloc(kindId);
      if (slot < 0) return false;
      this._launch(slot, rp.pos[0], rp.pos[1], rp.pos[2], -rp.dir[0], -rp.dir[1], -rp.dir[2], R, q, kindId);
      return true;
    }
    return false;
  }

  _spawnGcr() {
    if (this._nFree === 0) return; // havuz dolu: GKI atla
    const R = sampleRigidity();
    const q = Math.random() < 0.1 ? 2 : 1;
    if (Math.random() < FUNNEL_P_GCR && this._spawnFunnel(KIND_GCR, R, q, false)) return;
    this._spawnIsotropic(KIND_GCR, R, q);
  }

  _spawnSep() {
    const R = 0.15 * Math.pow(1.2 / 0.15, Math.random());
    if (Math.random() < FUNNEL_P_SEP && this._spawnFunnel(KIND_SEP, R, 1, true)) return;
    const i = this._alloc(KIND_SEP);
    if (i < 0) return;
    // Güneş tarafı: x≈25..30, X ekseninin ~8 Re çevresi; yaklaşık −X yönünde, yayılımlı
    const x = 25 + 5 * Math.random();
    const rho = 8 * Math.sqrt(Math.random());
    const a = 2 * Math.PI * Math.random();
    const y = rho * Math.cos(a);
    const z = rho * Math.sin(a);
    const rt = 5 * Math.sqrt(Math.random());
    const at = 2 * Math.PI * Math.random();
    const dx = -x + 0.07 * gauss() * 25;
    const dy = rt * Math.cos(at) - y + 0.07 * gauss() * 25;
    const dz = rt * Math.sin(at) - z + 0.07 * gauss() * 25;
    this._launch(i, x, y, z, dx, dy, dz, R, 1, KIND_SEP);
  }

  /** Patlama demetinden bir parçacık */
  _spawnBeam(job) {
    const i = this._alloc(KIND_BURST);
    if (i < 0) return false;
    const rho = job.aimR * Math.sqrt(Math.random());
    const a = 2 * Math.PI * Math.random();
    const c = rho * Math.cos(a);
    const s = rho * Math.sin(a);
    const n = job.n;
    const e1 = job.e1;
    const e2 = job.e2;
    const R = job.R * clamp(Math.exp(0.09 * gauss()), 0.8, 1.2);
    this._launch(
      i,
      e1[0] * c + e2[0] * s + n[0] * R_SRC,
      e1[1] * c + e2[1] * s + n[1] * R_SRC,
      e1[2] * c + e2[2] * s + n[2] * R_SRC,
      -n[0] + 0.004 * gauss(),
      -n[1] + 0.004 * gauss(),
      -n[2] + 0.004 * gauss(),
      R, job.q, KIND_BURST,
    );
    return true;
  }

  // ------------------------------------------------------------------ olaylar

  /**
   * 'cosmic:burst' → demet işi. payload.direction: Dünya'dan KAYNAĞA doğru yön (parçacıklar
   * bu yönden gelir, −direction yönünde uçar).
   */
  _onBurst(e) {
    const st = this.ctx.state;
    if (!e || st.params.layers.cosmicRays === false) return;
    const count = clamp(Math.round(Number.isFinite(e.count) ? e.count : 100), 1, 600);
    const R = clamp(Number.isFinite(e.rigidityGV) ? e.rigidityGV : 5, 0.02, 400);
    const q = Number.isFinite(e.charge) && e.charge !== 0 ? e.charge : e.particle === 'electron' ? -1 : e.particle === 'alpha' ? 2 : 1;

    let nx = 0, ny = 0, nz = 0;
    const d = e.direction;
    if (d) {
      const x = Array.isArray(d) ? d[0] : d.x;
      const y = Array.isArray(d) ? d[1] : d.y;
      const z = Array.isArray(d) ? d[2] : d.z;
      if (Number.isFinite(x + y + z) && Math.hypot(x, y, z) > 1e-6) {
        const l = Math.hypot(x, y, z);
        nx = x / l; ny = y / l; nz = z / l;
      }
    }
    if (nx === 0 && ny === 0 && nz === 0) {
      // Rastgele yön, Güneş (+X) çizgisinden biraz uzak (daha görünür)
      const u = 2 * Math.random() - 1;
      const ph = 2 * Math.PI * Math.random();
      const s = Math.sqrt(1 - u * u);
      nx = 0.5 * s * Math.cos(ph);
      ny = u;
      nz = s * Math.sin(ph);
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
    }

    // Boş ya da en az kalanı olan işi seç
    let job = null;
    for (const j of this._jobs) {
      if (!j.active) { job = j; break; }
      if (!job || j.remaining < job.remaining) job = j;
    }
    job.active = true;
    job.n[0] = nx; job.n[1] = ny; job.n[2] = nz;
    this._perp(nx, ny, nz);
    job.e1[0] = this._b1[0]; job.e1[1] = this._b1[1]; job.e1[2] = this._b1[2];
    job.e2[0] = this._b2[0]; job.e2[1] = this._b2[1]; job.e2[2] = this._b2[2];
    job.R = R;
    job.q = q;
    job.remaining = count;
    job.rate = count / BURST_SPAWN_SEC;
    job.acc = 0;
    job.elapsed = 0;
    const w = smoothstep(0.05, 0.5, st.derived.shieldStrength);
    job.aimR = lerp(1.7, 5.0, w); // demet ~5 Re içinde (kalkan yokken daha sıkı)

    this._showLabel(nx * 24, ny * 24, nz * 24);
  }

  _showLabel(x, y, z) {
    let L = null;
    for (const l of this._labels) {
      if (l.life <= 0) { L = l; break; }
      if (!L || l.life < L.life) L = l;
    }
    L.life = LABEL_SEC;
    L.obj.position.set(x, y, z);
    L.obj.visible = true;
    L.obj.element.style.opacity = '0';
  }

  _emitEscaped(p) {
    this.ctx.events.emit('cosmic:escaped', { rigidityGV: p.rigidity, charge: p.q, kind: p.kind });
  }

  // ------------------------------------------------------------------ güncelleme

  update(visDt, simDt, realDt) {
    const st = this.ctx.state;
    const on = st.params.layers.cosmicRays !== false;
    this.group.visible = on;
    if (!on) {
      if (this._active) {
        this._clearAll();
        this._active = false;
      }
      return;
    }
    this._active = true;
    this._updateUniforms();

    const dt = Math.min(visDt, 0.25);
    if (dt > 0) {
      fieldModelFromState(st, this._model);
      this._slowAxis(st, dt);
      this._revMs = 0;
      this._spawn(dt, st);
      const t0 = performance.now();
      this._advanceAll(dt);
      const ms = performance.now() - t0;
      // Kendi kendine ayarlanan alt adım bütçesi (yavaş makinelerde düşer)
      if (ms > 2.2) this._budget = Math.max(STEP_BUDGET_MIN, this._budget * 0.85);
      else if (ms < 1.1) this._budget = Math.min(STEP_BUDGET_MAX, this._budget * 1.05);
      this._updateFx(dt);
      this._updateLabels(dt);
      this._dirty = true;
    }
    if (this._dirty) {
      this._buildTrails();
      this._buildFx();
      this._dirty = false;
    }
  }

  /**
   * Hızlı zaman akışında (CME yolculuğu, yüksek timeScale) Dünya'nın günlük dönüşü birkaç saniyede
   * bir tur atar; parçacıklar ise görsel olarak saniyeler boyu uçar. Yarı-statik alan için, hızlı
   * zamanda dipol ekseninden günlük dönme bileşeni (spinAxis çevresindeki −earthRotationRad) çıkarılır.
   * Normal hızda eksen aynen izlenir; ağırlık yumuşakça geçiş yapar (uçuştaki parçacıklarda sıçrama yok).
   */
  _slowAxis(st, dt) {
    const rate = st.time.effectiveRate ?? st.time.timeScale ?? 0.25;
    const target = smoothstep(0.5, 2.5, rate);
    this._axisW += (target - this._axisW) * (1 - Math.exp(-dt / 0.6));
    const w = this._axisW;
    if (w < 0.002) return;
    const a = st.frame.dipoleAxis;
    const k = st.frame.spinAxis;
    const th = st.frame.earthRotationRad;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const kd = k.x * a.x + k.y * a.y + k.z * a.z;
    // Rodrigues, açı = −θ
    const cx = k.y * a.z - k.z * a.y;
    const cy = k.z * a.x - k.x * a.z;
    const cz = k.x * a.y - k.y * a.x;
    const ux = a.x * c - cx * s + k.x * kd * (1 - c);
    const uy = a.y * c - cy * s + k.y * kd * (1 - c);
    const uz = a.z * c - cz * s + k.z * kd * (1 - c);
    let bx = a.x * (1 - w) + ux * w;
    let by = a.y * (1 - w) + uy * w;
    let bz = a.z * (1 - w) + uz * w;
    const l = Math.hypot(bx, by, bz) || 1;
    bx /= l; by /= l; bz /= l;
    const ax = this._model.axis;
    ax[0] = bx; ax[1] = by; ax[2] = bz;
  }

  _updateUniforms() {
    const r = this.ctx.renderer;
    const cam = this.ctx.camera;
    const pr = r.getPixelRatio ? r.getPixelRatio() : 1;
    let h = 900;
    if (r.getSize) {
      r.getSize(this._v2);
      if (this._v2.y > 0) h = this._v2.y;
    }
    const fov = (cam.fov || 45) * DEG;
    const u = this._fxMat.uniforms;
    u.uPxScale.value = (h * pr) / (2 * Math.tan(fov * 0.5));
    u.uMinPx.value = 3.0 * pr;
    u.uMaxPx.value = 64 * pr;
    u.uSoftPx.value = 56 * pr;
  }

  _spawn(dt, st) {
    const cosmic = st.params.cosmic;
    const d = st.derived;
    this._shieldW = smoothstep(0.05, 0.5, d.shieldStrength);

    // a) Galaktik kozmik ışınlar (Forbush azalması gcrRelative ile)
    const rate = clamp(cosmic.backgroundIntensity ?? 0, 0, 2) * 30 * (d.gcrRelative ?? 1);
    let n = this._poisson(rate * dt);
    while (n-- > 0) this._spawnGcr();

    // c) Güneş enerjik parçacıkları
    if (d.sepPfu >= 1) {
      const sr = Math.min(24, 0.6 + 4 * Math.log10(d.sepPfu));
      n = this._poisson(sr * dt);
      while (n-- > 0) this._spawnSep();
    }

    // b) Patlama demetleri
    for (const job of this._jobs) {
      if (!job.active) continue;
      job.elapsed += dt;
      job.acc += job.rate * dt;
      let k = Math.floor(job.acc);
      job.acc -= k;
      if (job.elapsed >= BURST_SPAWN_SEC) k = job.remaining;
      if (k > job.remaining) k = job.remaining;
      for (; k > 0; k--) {
        this._spawnBeam(job);
        job.remaining--;
      }
      if (job.remaining <= 0) job.active = false;
    }
  }

  _advanceAll(dt) {
    const dist = VISUAL.cosmicRayRePerSec * dt;
    const pool = this._pool;

    // 1) Alt adım ihtiyacı tahmini → toplam bütçeye göre orantıla
    let total = 0;
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i];
      if (!p.alive || p.dying) continue;
      p.need = Math.ceil(dist / adaptiveStep(p.rigidity, p.lastB)) + 3;
      total += p.need;
    }
    const scale = total > this._budget ? this._budget / total : 1;

    // 2) İlerlet
    let live = 0;
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      if (p.dying) {
        p.fade -= p.fadeRate * dt;
        if (p.fade <= 0) this._release(i);
        else live++;
        continue;
      }
      p.age += dt;
      if (p.age > MAX_AGE) {
        this._emitEscaped(p);
        this._startDying(p, 1.0);
        live++;
        continue;
      }
      this._moveParticle(p, dist, Math.max(MIN_ALLOC, Math.floor(p.need * scale)));
      if (p.alive) live++;
    }
    this.liveCount = live;
    // Kalabalıkta (patlama) parlaklığı azalt: eklemeli karışımda beyaza doymayı önler
    this._crowd = 1 / Math.sqrt(1 + live / 150);
  }

  _moveParticle(p, dist, alloc) {
    const model = this._model;
    const opts = this._opts;
    const pos = p.pos;
    const dir = p.dir;
    let left = dist;
    let sub = alloc;
    let chunks = 0;
    while (left > 1e-5 && sub > 0 && chunks < MAX_CHUNKS) {
      // İz örnek aralığı: yerel jirasyon yarıçapına göre (eğrilen yerde sık), düz uçuşta TRAIL_STEP.
      // İz, örnekler arası yola göre tutulur: iz uzunluğu (Re) kare hızından bağımsızdır.
      let sp = p.lastB > 1e-9 ? (0.8 * DIPOLE.gyroRePerGV * p.rigidity) / p.lastB : TRAIL_STEP;
      if (sp > TRAIL_STEP) sp = TRAIL_STEP;
      if (sp < MIN_SPACING) sp = MIN_SPACING;
      let c = sp;
      if (c < dist / MAX_CHUNKS) c = dist / MAX_CHUNKS;
      if (c > left) c = left;
      const ox = pos[0];
      const oy = pos[1];
      const oz = pos[2];
      opts.maxSubsteps = sub;
      const res = advanceParticle(p, c, model, opts);
      chunks++;
      if (!Number.isFinite(pos[0] + pos[1] + pos[2] + dir[0] + dir[1] + dir[2])) {
        this._release(p.id); // sayısal bozulma: sessizce kaldır
        return;
      }
      if (res.hit) {
        this._onHit(p, ox, oy, oz);
        return;
      }
      if (res.escaped) {
        this._pushTrail(p);
        this._emitEscaped(p);
        this._startDying(p, 1.25);
        return;
      }
      p.acc += res.travelled;
      if (p.acc >= 0.7 * sp) {
        this._pushTrail(p);
        p.acc = 0;
      }
      left -= res.travelled;
      if (res.travelled < c - 1e-7) break; // alt adım bütçesi bitti
      sub -= Math.max(1, Math.ceil(res.travelled / Math.max(adaptiveStep(p.rigidity, p.lastB), 0.002)));
    }
  }

  /** Yüzeye çarpma: kesişim noktası, olay, parlama, hava sağanağı */
  _onHit(p, ox, oy, oz) {
    const pos = p.pos;
    const dx = pos[0] - ox;
    const dy = pos[1] - oy;
    const dz = pos[2] - oz;
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (ox * dx + oy * dy + oz * dz);
    const c0 = ox * ox + oy * oy + oz * oz - R_HIT * R_HIT;
    let t = 1;
    if (a > 1e-12) {
      const disc = b * b - 4 * a * c0;
      if (disc >= 0) t = (-b - Math.sqrt(disc)) / (2 * a);
    }
    t = clamp(t, 0, 1);
    let ix = ox + dx * t;
    let iy = oy + dy * t;
    let iz = oz + dz * t;
    const r = Math.hypot(ix, iy, iz) || 1;
    ix *= R_HIT / r; iy *= R_HIT / r; iz *= R_HIT / r;
    pos[0] = ix; pos[1] = iy; pos[2] = iz;
    this._pushTrail(p);
    this._startDying(p, 1 / 0.6);

    const magLat = magneticLatitudeDeg(this._v3.set(ix, iy, iz), this.ctx.state.frame);
    this.ctx.events.emit('cosmic:impact', {
      magLatDeg: Number.isFinite(magLat) ? magLat : 0,
      rigidityGV: p.rigidity,
      charge: p.q,
      kind: p.kind,
    });

    // Parlama + hava sağanağı
    const k = 0.35 + 0.65 * clamp((Math.log10(p.rigidity) + 1) / 3.3, 0, 1);
    this._addFlash(ix, iy, iz, lerp(p.cr, 1, 0.5), lerp(p.cg, 1, 0.5), lerp(p.cb, 1, 0.5), 0.1 + 0.06 * k);
    this._shower(ix, iy, iz, p);
  }

  _addFlash(x, y, z, r, g, b, size) {
    const f = this._fxNext;
    this._fxNext = (f + 1) % FLASH_MAX;
    const o = f * 3;
    this._fxPos[o] = x * 1.004; this._fxPos[o + 1] = y * 1.004; this._fxPos[o + 2] = z * 1.004;
    this._fxCol[o] = r; this._fxCol[o + 1] = g; this._fxCol[o + 2] = b;
    this._fxSize[f] = size;
    this._fxAge[f] = 0;
  }

  /** ~10 ikincil kıvılcım: gelen yön konisi (içeri) + geri saçılma; yüzeyde süzülüp söner */
  _shower(ix, iy, iz, p) {
    const inv = 1 / R_HIT;
    const nx = ix * inv;
    const ny = iy * inv;
    const nz = iz * inv;
    const d = p.dir;
    const dn = d[0] * nx + d[1] * ny + d[2] * nz;
    const tx = d[0] - dn * nx;
    const ty = d[1] - dn * ny;
    const tz = d[2] - dn * nz;
    for (let k = 0; k < SPARKS_PER_HIT; k++) {
      const s = this._sNext;
      this._sNext = (s + 1) % SPARK_MAX;
      let vx, vy, vz;
      if (k < 6) {
        vx = d[0] * 0.8 + gauss() * 0.4;
        vy = d[1] * 0.8 + gauss() * 0.4;
        vz = d[2] * 0.8 + gauss() * 0.4;
      } else {
        vx = nx * 0.55 + tx * 0.6 + gauss() * 0.5;
        vy = ny * 0.55 + ty * 0.6 + gauss() * 0.5;
        vz = nz * 0.55 + tz * 0.6 + gauss() * 0.5;
      }
      const vl = Math.hypot(vx, vy, vz) || 1;
      const sp = (0.35 + 0.9 * Math.random()) / vl;
      const o = s * 3;
      this._sPos[o] = ix; this._sPos[o + 1] = iy; this._sPos[o + 2] = iz;
      this._sVel[o] = vx * sp; this._sVel[o + 1] = vy * sp; this._sVel[o + 2] = vz * sp;
      const m = Math.random();
      this._sCol[o] = lerp(0.75, p.cr, 0.4) * (0.8 + 0.5 * m);
      this._sCol[o + 1] = lerp(0.85, p.cg, 0.4) * (0.8 + 0.5 * m);
      this._sCol[o + 2] = lerp(1.0, p.cb, 0.4) * (0.8 + 0.5 * m);
      const life = 0.45 + 0.45 * Math.random();
      this._sLife[s] = life;
      this._sMax[s] = life;
    }
  }

  _updateFx(dt) {
    for (let f = 0; f < FLASH_MAX; f++) {
      if (this._fxAge[f] < 0) continue;
      this._fxAge[f] += dt;
      if (this._fxAge[f] >= FLASH_SEC) this._fxAge[f] = -1;
    }
    const pos = this._sPos;
    const vel = this._sVel;
    for (let s = 0; s < SPARK_MAX; s++) {
      if (this._sLife[s] <= 0) continue;
      this._sLife[s] -= dt;
      if (this._sLife[s] <= 0) continue;
      const o = s * 3;
      pos[o] += vel[o] * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o + 2] += vel[o + 2] * dt;
      // Yüzeyin altına inme: yansıt ve sürtünmeyle yavaşlat (atmosfer içinde saçılma)
      const r = Math.hypot(pos[o], pos[o + 1], pos[o + 2]);
      if (r < 1.004) {
        const inv = 1 / (r || 1);
        const nx = pos[o] * inv;
        const ny = pos[o + 1] * inv;
        const nz = pos[o + 2] * inv;
        const vr = vel[o] * nx + vel[o + 1] * ny + vel[o + 2] * nz;
        if (vr < 0) {
          const k = -1.3 * vr;
          vel[o] = (vel[o] + nx * k) * 0.85;
          vel[o + 1] = (vel[o + 1] + ny * k) * 0.85;
          vel[o + 2] = (vel[o + 2] + nz * k) * 0.85;
        }
        pos[o] = nx * 1.004;
        pos[o + 1] = ny * 1.004;
        pos[o + 2] = nz * 1.004;
      }
    }
  }

  _updateLabels(dt) {
    for (const L of this._labels) {
      if (L.life <= 0) continue;
      L.life -= dt;
      if (L.life <= 0) {
        L.obj.visible = false;
        continue;
      }
      const a = LABEL_SEC - L.life;
      const op = smoothstep(0, 0.2, a) * (1 - smoothstep(1.2, LABEL_SEC, a));
      L.obj.element.style.opacity = op.toFixed(2);
    }
  }

  // ------------------------------------------------------------------ tamponları doldur

  _buildTrails() {
    const pool = this._pool;
    const trail = this._trail;
    const pos = this._tPos;
    const col = this._tCol;
    const ft = this._fadeTab;
    const crowd = this._crowd;
    let w = 0;
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i];
      if (!p.alive || p.tc < 1) continue;
      const g = p.fade * p.fade * TRAIL_GAIN * crowd;
      const cr = p.cr * g;
      const cg = p.cg * g;
      const cb = p.cb * g;
      // En yeni uç: canlı konum (iz örnekleri yola göre seyrek eklenir)
      let idx = p.th;
      let o = 0;
      let ax = p.pos[0];
      let ay = p.pos[1];
      let az = p.pos[2];
      const n = p.tc;
      for (let k = 0; k < n; k++) {
        idx--;
        if (idx < 0) idx += TRAIL;
        o = p.off + idx * 3;
        const bx = trail[o];
        const by = trail[o + 1];
        const bz = trail[o + 2];
        const fa = ft[k];
        const fb = ft[k + 1];
        pos[w] = ax; pos[w + 1] = ay; pos[w + 2] = az;
        col[w] = cr * fa; col[w + 1] = cg * fa; col[w + 2] = cb * fa;
        w += 3;
        pos[w] = bx; pos[w + 1] = by; pos[w + 2] = bz;
        col[w] = cr * fb; col[w + 1] = cg * fb; col[w + 2] = cb * fb;
        w += 3;
        ax = bx; ay = by; az = bz;
      }
    }
    const verts = w / 3;
    const g = this.trails.geometry;
    g.setDrawRange(0, verts);
    if (verts > 0) {
      const pa = g.attributes.position;
      const ca = g.attributes.color;
      pa.clearUpdateRanges();
      pa.addUpdateRange(0, w);
      pa.needsUpdate = true;
      ca.clearUpdateRanges();
      ca.addUpdateRange(0, w);
      ca.needsUpdate = true;
    }
  }

  _buildFx() {
    const pool = this._pool;
    const fp = this._fPos;
    const fc = this._fCol;
    const fs = this._fSize;
    let n = 0;
    const headK = HEAD_GAIN * Math.sqrt(this._crowd);

    // Başlar
    for (let i = 0; i < MAX_P; i++) {
      const p = pool[i];
      if (!p.alive || p.tc < 1) continue;
      let g = headK;
      if (p.dying) {
        if (p.fade < 0.05) continue;
        g *= p.fade * p.fade * p.fade;
      }
      const o = n * 3;
      fp[o] = p.pos[0]; fp[o + 1] = p.pos[1]; fp[o + 2] = p.pos[2];
      fc[o] = p.cr * g; fc[o + 1] = p.cg * g; fc[o + 2] = p.cb * g;
      fs[n] = HEAD_SIZE[p.kindId];
      n++;
    }

    // Çarpma parlamaları
    for (let f = 0; f < FLASH_MAX; f++) {
      const age = this._fxAge[f];
      if (age < 0) continue;
      const t = age / FLASH_SEC;
      const inten = 3.0 * (1 - t) * (1 - t);
      const o = n * 3;
      const s = f * 3;
      fp[o] = this._fxPos[s]; fp[o + 1] = this._fxPos[s + 1]; fp[o + 2] = this._fxPos[s + 2];
      fc[o] = this._fxCol[s] * inten; fc[o + 1] = this._fxCol[s + 1] * inten; fc[o + 2] = this._fxCol[s + 2] * inten;
      fs[n] = this._fxSize[f] * (0.6 + 2.4 * Math.sqrt(t));
      n++;
    }

    // Hava sağanağı kıvılcımları
    for (let s = 0; s < SPARK_MAX; s++) {
      const life = this._sLife[s];
      if (life <= 0) continue;
      const t = life / this._sMax[s];
      const inten = 1.8 * t * Math.sqrt(t);
      const o = n * 3;
      const q = s * 3;
      fp[o] = this._sPos[q]; fp[o + 1] = this._sPos[q + 1]; fp[o + 2] = this._sPos[q + 2];
      fc[o] = this._sCol[q] * inten; fc[o + 1] = this._sCol[q + 1] * inten; fc[o + 2] = this._sCol[q + 2] * inten;
      fs[n] = 0.028;
      n++;
    }

    const g = this.fx.geometry;
    g.setDrawRange(0, n);
    if (n > 0) {
      const pa = g.attributes.position;
      const ca = g.attributes.aColor;
      const sa = g.attributes.aSize;
      pa.clearUpdateRanges();
      pa.addUpdateRange(0, n * 3);
      pa.needsUpdate = true;
      ca.clearUpdateRanges();
      ca.addUpdateRange(0, n * 3);
      ca.needsUpdate = true;
      sa.clearUpdateRanges();
      sa.addUpdateRange(0, n);
      sa.needsUpdate = true;
    }
  }

  dispose() {
    this._offBurst?.();
    this._offReset?.();
    this.ctx.scene.remove(this.group);
    this.trails.geometry.dispose();
    this.trails.material.dispose();
    this.fx.geometry.dispose();
    this._fxMat.dispose();
    for (const L of this._labels) {
      this.group.remove(L.obj);
      L.obj.element.remove();
    }
  }
}
