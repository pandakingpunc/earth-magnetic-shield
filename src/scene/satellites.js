// Uydular: ISS, GPS takımyıldızı, jeosenkron (GEO) uydular ve Güney Atlantik Anomalisi (GAA).
// Yörüngeler Dünya'nın ekvator düzlemine göre kurulur ve state.time.simHours'tan hesaplanır.
// Ekvator çerçevesi: x = sabit referans düğüm yönü (dünya +X'in ekvatora izdüşümü), y = dönme ekseni, z = x × y.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ORBITS, RE_KM } from '../core/constants.js';
import { DEG, latLonToLocal, localToWorld, magneticLatitudeDeg, clamp } from '../core/geo.js';
import { insideMagnetopause } from '../physics/magnetopause.js';
import { makeLabel, setLabelVariant } from './labels.js';
import { nf } from '../core/format.js';
import { t as tt } from '../i18n/index.js';

const TAU = Math.PI * 2;

// ISS
const ISS_R = 1 + ORBITS.ISS.altitudeKm / RE_KM;
const ISS_INC = ORBITS.ISS.inclinationDeg * DEG;
const ISS_PERIOD_H = ORBITS.ISS.periodMin / 60;
const ISS_RAAN = 35 * DEG;
const ISS_PHASE0 = 0.8;

// GPS: 6 düzlem × 4 uydu
const GPS_R = ORBITS.GPS.radiusRe;
const GPS_INC = ORBITS.GPS.inclinationDeg * DEG;
const GPS_PERIOD_H = ORBITS.GPS.periodHours;
const GPS_PLANES = ORBITS.GPS.planes;
const GPS_PER_PLANE = ORBITS.GPS.perPlane;
const GPS_COUNT = GPS_PLANES * GPS_PER_PLANE;
const GPS_RAAN0 = 20 * DEG;

// GEO: Dünya ile birlikte dönen ekvator uyduları
const GEO_R = ORBITS.GEO.radiusRe;
const GEO_SATS = [
  { name: 'Türksat 5A', lon: 31, turksat: true },
  { name: 'Türksat 4A', lon: 42, turksat: true },
  { name: 'Türksat 5B', lon: 42.2, turksat: true },
  { name: 'Meteosat', lon: 0 },
  { name: 'GOES-East', lon: -75.2 },
  { name: 'GOES-West', lon: -137.2 },
  { name: 'Himawari', lon: 140.7 },
  { name: 'INSAT', lon: 82 },
];

// Güney Atlantik Anomalisi (elips yaması)
const SAA = { lat: -26, lon: -50, latHalf: 25, lonHalf: 35, r: 1.011 };

// GEO etiketlerinin üst üste binmemesi için denenen dikey konumlar (CSS2D center.y; >1 nokta üstünde, <0 altında)
const LABEL_SLOTS = [1.35, -0.35, 2.5, -1.5, 3.65, -2.65, 4.8, -3.8];
const LABEL_H = 22; // yaklaşık etiket yüksekliği (px)
const LABEL_CHAR_W = 6.8; // yaklaşık karakter genişliği (px)

// Parıltı noktalarının tampon düzeni: 0 = ISS, 1.. = GPS, sonra GEO
const PT_ISS = 0;
const PT_GPS = 1;
const PT_GEO = PT_GPS + GPS_COUNT;
const PT_COUNT = PT_GEO + GEO_SATS.length;

// ---------------------------------------------------------------------------
// Gölgelendiriciler
// ---------------------------------------------------------------------------

const POINT_VERT = /* glsl */ `
uniform float uPixelRatio;
uniform float uTime;
attribute vec3 aColor;
attribute float aSize;
attribute float aPulse;
attribute float aNear;
varying vec3 vColor;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.0);
  float s = sin(uTime * 6.5 + position.x * 5.0 + position.z * 3.0);
  // yakınlaşınca ISS parıltısı sönsün, model görünsün
  float fadeNear = mix(1.0, smoothstep(0.1, 1.0, dist), aNear);
  gl_PointSize = aSize * (1.0 + aPulse * 0.35 * s) * mix(0.5, 1.0, fadeNear) * uPixelRatio;
  vColor = aColor * (1.0 + aPulse * 0.5 * s);
  vFade = fadeNear;
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 0.4, r);
  float halo = pow(1.0 - r, 2.2) * 0.65;
  float a = clamp(core + halo, 0.0, 1.0) * vFade;
  vec3 col = mix(vColor, vec3(1.0), core * 0.3) * 1.2;
  gl_FragColor = vec4(col, a);
}
`;

const SAA_VERT = /* glsl */ `
attribute vec2 aEll;
varying vec2 vEll;
void main() {
  vEll = aEll;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SAA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vEll;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  float n = vnoise(vEll * 3.0 + vec2(uTime * 0.06, -uTime * 0.045));
  // sınır hafifçe dalgalı: kenar yumuşak ve organik
  float e = length(vEll) * (1.0 + 0.16 * (n - 0.5));
  if (e > 1.0) discard;
  float body = 1.0 - smoothstep(0.1, 1.0, e);
  body = body * body;
  float core = 1.0 - smoothstep(0.0, 0.55, e);
  float rim = smoothstep(0.72, 0.9, e) * (1.0 - smoothstep(0.9, 1.0, e));
  float shimmer = 0.9 + 0.1 * sin(uTime * 1.4 + n * 6.2831853);
  float a = (body * 0.8 + core * 0.35 + rim * 0.25) * uIntensity * shimmer * 0.75;
  vec3 col = mix(uColor, vec3(1.0, 0.45, 0.2), core * 0.4);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
}
`;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const _p = new THREE.Vector3();

/** Dairesel eğik yörünge noktası (ekvator çerçevesinde). u: yörünge argümanı (0 = çıkan düğüm). */
function orbitPoint(out, r, inc, raan, u) {
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  return out.set(r * (cO * cu - sO * su * ci), r * su * si, -r * (sO * cu + cO * su * ci));
}

/** Yörünge hız yönü (birim, ileri doğru). */
function orbitTangent(out, inc, raan, u) {
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  return out.set(-cO * su - sO * cu * ci, cu * si, sO * su - cO * cu * ci);
}

function ringGeometry(r, inc, raan, n) {
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    orbitPoint(_p, r, inc, raan, (i / n) * TAU);
    arr[i * 3] = _p.x;
    arr[i * 3 + 1] = _p.y;
    arr[i * 3 + 2] = _p.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

function ringMaterial(color, opacity) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Kameradan noktaya giden doğru parçası Dünya küresini kesiyor mu? (Dünya orijinde) */
function hiddenByEarth(cam, p) {
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const dd = dx * dx + dy * dy + dz * dz;
  if (dd < 1e-9) return false;
  const t = -(cam.x * dx + cam.y * dy + cam.z * dz) / dd;
  if (t <= 0 || t >= 1) return false;
  const qx = cam.x + dx * t;
  const qy = cam.y + dy * t;
  const qz = cam.z + dz * t;
  return qx * qx + qy * qy + qz * qz < 0.99;
}

/** Etiket metni/varyantı yalnızca değiştiğinde DOM'a yazılır. */
function setLabel(entry, text, variant) {
  if (entry.text !== text) {
    entry.label.element.textContent = text;
    entry.text = text;
  }
  if (entry.variant !== variant) {
    setLabelVariant(entry.label, variant);
    entry.variant = variant;
  }
}

/** ISS gövdesi ve güneş panelleri (iki birleştirilmiş geometri). Gövde ekseni: x = kafes, z = uçuş yönü, y = yukarı. */
function buildIssGeometries() {
  const hullParts = [];
  hullParts.push(new THREE.BoxGeometry(0.062, 0.0032, 0.0032)); // ana kafes
  const lab = new THREE.CylinderGeometry(0.0042, 0.0042, 0.034, 10); // modüller
  lab.rotateX(Math.PI / 2);
  lab.translate(0, -0.0048, 0);
  hullParts.push(lab);
  const node = new THREE.CylinderGeometry(0.003, 0.003, 0.02, 8); // enine modül
  node.rotateZ(Math.PI / 2);
  node.translate(0, -0.0048, 0.006);
  hullParts.push(node);
  for (const sx of [-1, 1]) {
    const rad = new THREE.BoxGeometry(0.009, 0.0004, 0.011); // radyatör
    rad.translate(sx * 0.0085, 0.0028, 0);
    hullParts.push(rad);
  }
  const hull = mergeGeometries(hullParts, false);

  const panelParts = [];
  for (const x of [-0.0265, -0.0125, 0.0125, 0.0265]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.BoxGeometry(0.0085, 0.0005, 0.0145);
      p.translate(x, 0, sz * 0.0078);
      panelParts.push(p);
    }
  }
  const panels = mergeGeometries(panelParts, false);

  for (const g of hullParts) g.dispose();
  for (const g of panelParts) g.dispose();
  return { hull, panels };
}

/** GAA yaması: enlem/boylam ızgarasında elips-normalize koordinat (aEll) taşıyan kısmi küre. */
function buildSaaGeometry() {
  const NLAT = 28;
  const NLON = 36;
  const EXT = 1.22; // elipsin biraz dışına kadar uzanır (yumuşak kenar kırpılmasın)
  const count = (NLAT + 1) * (NLON + 1);
  const pos = new Float32Array(count * 3);
  const ell = new Float32Array(count * 2);
  const idx = new Uint16Array(NLAT * NLON * 6);
  const v = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i <= NLAT; i++) {
    for (let j = 0; j <= NLON; j++) {
      const fu = (i / NLAT) * 2 - 1;
      const fv = (j / NLON) * 2 - 1;
      const dLat = fu * SAA.latHalf * EXT;
      const dLon = fv * SAA.lonHalf * EXT;
      latLonToLocal(SAA.lat + dLat, SAA.lon + dLon, SAA.r, v);
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = v.y;
      pos[k * 3 + 2] = v.z;
      ell[k * 2] = dLat / SAA.latHalf;
      ell[k * 2 + 1] = dLon / SAA.lonHalf;
      k++;
    }
  }
  let n = 0;
  for (let i = 0; i < NLAT; i++) {
    for (let j = 0; j < NLON; j++) {
      const a = i * (NLON + 1) + j;
      const b = a + NLON + 1;
      idx[n++] = a;
      idx[n++] = a + 1;
      idx[n++] = b;
      idx[n++] = b;
      idx[n++] = a + 1;
      idx[n++] = b + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEll', new THREE.BufferAttribute(ell, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ---------------------------------------------------------------------------
// Katman
// ---------------------------------------------------------------------------

export class SatelliteLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'SatelliteLayer';
    ctx.scene.add(this.group);

    // Yörünge halkalarının ve ISS'in bağlı olduğu, ekvator çerçevesiyle dönen grup
    this.orbitGroup = new THREE.Group();
    this.orbitGroup.name = 'SatelliteOrbits';
    this.group.add(this.orbitGroup);

    this._time = 0;

    // Önceden ayrılmış geçici nesneler
    this._e1 = new THREE.Vector3();
    this._e3 = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
    this._issL = new THREE.Vector3();
    this._issV = new THREE.Vector3();
    this._issR = new THREE.Vector3();
    this._issH = new THREE.Vector3();
    this._issW = new THREE.Vector3();
    this._sub = new THREE.Vector3();
    this._sun = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._qInv = new THREE.Quaternion();
    this._tmpC = new THREE.Color();
    this._pv = new THREE.Vector3();
    this._sz = new THREE.Vector2();
    this._rects = new Float32Array(GEO_SATS.length * 4); // yerleştirilmiş GEO etiket dikdörtgenleri
    // Etiket metinleri değer değişince yeniden kurulur (karede dizge üretme)
    this._dragKey = -1;
    this._dragStr = '';
    this._gpsKey = -1;
    this._gpsStr = '';

    // Renkler (doğrusal uzay)
    this._cIssNormal = new THREE.Color(0x8fe9ff);
    this._cIssWarn = new THREE.Color(0xffb347);
    this._cGeoBase = new THREE.Color(0x9fdcff);
    this._cGeoTurksat = new THREE.Color(0xffd27a);
    this._cDanger = new THREE.Color(0xff2a1f);
    this._cGpsGood = new THREE.Color(0x3dff7a);
    this._cGpsWarn = new THREE.Color(0xffd83a);
    this._cGpsBad = new THREE.Color(0xff3a2e);
    this._cGps = new THREE.Color(0x3dff7a);

    this._buildRings();
    this._buildIss();
    this._buildGpsPhases();
    this._buildPoints();
    this._buildGeo();
    this._buildGpsLabel();
    this._buildSaa();
  }

  _buildRings() {
    this.issRing = new THREE.LineLoop(ringGeometry(ISS_R, ISS_INC, ISS_RAAN, 160), ringMaterial(0x7fe8ff, 0.3));
    this.issRing.name = 'ISS yörüngesi';
    this.orbitGroup.add(this.issRing);

    // 6 GPS halkası tek LineSegments içinde
    const SEG = 120;
    const arr = new Float32Array(GPS_PLANES * SEG * 2 * 3);
    let o = 0;
    for (let k = 0; k < GPS_PLANES; k++) {
      const raan = GPS_RAAN0 + (k * TAU) / GPS_PLANES;
      for (let s = 0; s < SEG; s++) {
        for (let e = 0; e < 2; e++) {
          orbitPoint(_p, GPS_R, GPS_INC, raan, ((s + e) / SEG) * TAU);
          arr[o++] = _p.x;
          arr[o++] = _p.y;
          arr[o++] = _p.z;
        }
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.gpsRingMat = ringMaterial(0x3dff7a, 0.13);
    this.gpsRings = new THREE.LineSegments(gg, this.gpsRingMat);
    this.gpsRings.name = 'GPS yörüngeleri';
    this.orbitGroup.add(this.gpsRings);

    this.geoRing = new THREE.LineLoop(ringGeometry(GEO_R, 0, 0, 192), ringMaterial(0x8fc8ff, 0.14));
    this.geoRing.name = 'GEO halkası';
    this.orbitGroup.add(this.geoRing);
  }

  _buildIss() {
    this.issGroup = new THREE.Group();
    this.issGroup.name = 'ISS';
    this.orbitGroup.add(this.issGroup);

    const { hull, panels } = buildIssGeometries();
    this.issHullMat = new THREE.MeshStandardMaterial({
      color: 0x7d838f, // güçlü Güneş ışığında ve parlamada (bloom) beyaza taşmasın
      metalness: 0.1,
      roughness: 0.75,
      emissive: 0x2b3340, // gece tarafında/ışık zayıfken de seçilebilsin
      emissiveIntensity: 0.9,
    });
    this.issPanelMat = new THREE.MeshStandardMaterial({
      color: 0x1b3a8e,
      metalness: 0.1,
      roughness: 0.7,
      emissive: 0x112a70,
      emissiveIntensity: 1.0,
      side: THREE.DoubleSide,
    });
    this.issHull = new THREE.Mesh(hull, this.issHullMat);
    this.issPanels = new THREE.Mesh(panels, this.issPanelMat);
    this.issHull.name = 'ISS gövde';
    this.issPanels.name = 'ISS paneller';
    this.issGroup.add(this.issHull, this.issPanels);

    this.issLabelEntry = { label: makeLabel('ISS', 'accent'), text: 'ISS', variant: 'accent' };
    this.issLabelEntry.label.center.set(0.5, 1.7);
    this.issGroup.add(this.issLabelEntry.label);
  }

  _buildGpsPhases() {
    // GPS düzlem başına sabit faz kayması (düzgün dağılım yerine doğal görünüm)
    this._gpsRaan = new Float32Array(GPS_PLANES);
    this._gpsPhase = new Float32Array(GPS_COUNT);
    for (let k = 0; k < GPS_PLANES; k++) {
      this._gpsRaan[k] = GPS_RAAN0 + (k * TAU) / GPS_PLANES;
      for (let j = 0; j < GPS_PER_PLANE; j++) {
        this._gpsPhase[k * GPS_PER_PLANE + j] = (j * TAU) / GPS_PER_PLANE + k * (TAU / GPS_COUNT) * 2.0;
      }
    }
  }

  _buildPoints() {
    this.ptPos = new Float32Array(PT_COUNT * 3);
    this.ptCol = new Float32Array(PT_COUNT * 3);
    this.ptPulse = new Float32Array(PT_COUNT);
    const size = new Float32Array(PT_COUNT);
    const near = new Float32Array(PT_COUNT);
    size[PT_ISS] = 15;
    near[PT_ISS] = 1;
    for (let i = 0; i < GPS_COUNT; i++) size[PT_GPS + i] = 9;
    for (let i = 0; i < GEO_SATS.length; i++) size[PT_GEO + i] = GEO_SATS[i].turksat ? 14 : 11;

    const g = new THREE.BufferGeometry();
    this.ptPosAttr = new THREE.BufferAttribute(this.ptPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ptColAttr = new THREE.BufferAttribute(this.ptCol, 3).setUsage(THREE.DynamicDrawUsage);
    this.ptPulseAttr = new THREE.BufferAttribute(this.ptPulse, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.ptPosAttr);
    g.setAttribute('aColor', this.ptColAttr);
    g.setAttribute('aPulse', this.ptPulseAttr);
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aNear', new THREE.BufferAttribute(near, 1));

    this.pointMat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.pointMat);
    this.points.name = 'Uydu parıltıları';
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  _buildGeo() {
    this.geo = GEO_SATS.map((s) => {
      const local = latLonToLocal(0, s.lon, GEO_R);
      const variant = s.turksat ? 'accent' : 'danger';
      const label = makeLabel(s.name, variant);
      label.center.set(0.5, LABEL_SLOTS[0]);
      label.visible = !!s.turksat;
      this.group.add(label);
      return {
        name: s.name,
        exposedText: tt('scene.sat.exposed', { name: s.name }),
        turksat: !!s.turksat,
        local,
        world: new THREE.Vector3(),
        exposure: 0,
        exposed: false,
        label,
        text: s.name,
        variant,
      };
    });
  }

  _buildGpsLabel() {
    // Etiket, varsayılan kameraya (dawn tarafı) bakan halkanın kuzey tepe noktasına sabitlenir
    let best = 0;
    let bestDiff = Infinity;
    const target = 55 * DEG;
    for (let k = 0; k < GPS_PLANES; k++) {
      const raan = GPS_RAAN0 + (k * TAU) / GPS_PLANES;
      const az = Math.atan2(-Math.cos(raan), -Math.sin(raan));
      const d = Math.abs(Math.atan2(Math.sin(az - target), Math.cos(az - target)));
      if (d < bestDiff) {
        bestDiff = d;
        best = k;
      }
    }
    this.gpsAnchor = orbitPoint(new THREE.Vector3(), GPS_R, GPS_INC, GPS_RAAN0 + (best * TAU) / GPS_PLANES, Math.PI / 2);
    this.gpsLabelEntry = { label: makeLabel(tt('scene.sat.gps'), 'default'), text: tt('scene.sat.gps'), variant: 'default' };
    this.gpsLabelEntry.label.position.copy(this.gpsAnchor);
    this.orbitGroup.add(this.gpsLabelEntry.label);
  }

  _buildSaa() {
    this.saaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.45 },
        uColor: { value: new THREE.Color(0.95, 0.12, 0.07) },
      },
      vertexShader: SAA_VERT,
      fragmentShader: SAA_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending, // yüzeyi renklendirir (toplamalı karışım gündüz yüzünde beyaza taşıyordu)
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.saaMesh = new THREE.Mesh(buildSaaGeometry(), this.saaMat);
    this.saaMesh.name = 'Güney Atlantik Anomalisi';
    this.saaMesh.renderOrder = 2;
    this.group.add(this.saaMesh);

    this.saaCenterLocal = latLonToLocal(SAA.lat, SAA.lon, 1.02);
    this.saaLabelEntry = { label: makeLabel(tt('scene.sat.saa'), 'small'), text: tt('scene.sat.saa'), variant: 'small' };
    this.saaLabelEntry.label.position.copy(this.saaCenterLocal);
    this.saaMesh.add(this.saaLabelEntry.label);
  }

  /** Ekvator çerçevesini (referans düğüm yönü, dönme ekseni) orbitGroup'a uygular. */
  _updateEquatorialFrame() {
    const n = this.ctx.state.frame.spinAxis;
    const e1 = this._e1.set(1, 0, 0).addScaledVector(n, -n.x);
    if (!(e1.lengthSq() > 1e-8)) e1.set(0, 0, 1);
    e1.normalize();
    const e3 = this._e3.crossVectors(e1, n);
    this._m4.makeBasis(e1, n, e3);
    this.orbitGroup.quaternion.setFromRotationMatrix(this._m4);
  }

  /** Görünen GEO etiketlerini ekranda üst üste binmeyecek dikey konumlara yerleştirir (açgözlü, Türksat öncelikli). */
  _layoutGeoLabels() {
    const cam = this.ctx.camera;
    const sz = this._sz;
    this.ctx.renderer?.getSize?.(sz);
    const W = sz.x > 0 ? sz.x : 1280;
    const H = sz.y > 0 ? sz.y : 720;
    const rects = this._rects;
    const last = LABEL_SLOTS.length - 1;
    let n = 0;
    for (let i = 0; i < this.geo.length; i++) {
      const g = this.geo[i];
      if (!g.label.visible) continue;
      const p = this._pv.copy(g.world).project(cam);
      if (!(Math.abs(p.x) < 4 && Math.abs(p.y) < 4 && p.z < 1)) {
        g.label.center.y = LABEL_SLOTS[0];
        continue;
      }
      const px = (p.x * 0.5 + 0.5) * W;
      const py = (-p.y * 0.5 + 0.5) * H;
      const half = (g.text.length * LABEL_CHAR_W + 18) * 0.5;
      let slot = 0;
      for (; slot < last; slot++) {
        const top = py - LABEL_SLOTS[slot] * LABEL_H;
        let clash = false;
        for (let k = 0; k < n; k++) {
          const o = k * 4;
          if (px - half < rects[o + 2] && px + half > rects[o] && top < rects[o + 3] && top + LABEL_H > rects[o + 1]) {
            clash = true;
            break;
          }
        }
        if (!clash) break;
      }
      const top = py - LABEL_SLOTS[slot] * LABEL_H;
      rects[n * 4] = px - half;
      rects[n * 4 + 1] = top;
      rects[n * 4 + 2] = px + half;
      rects[n * 4 + 3] = top + LABEL_H;
      n++;
      g.label.center.y = LABEL_SLOTS[slot];
    }
  }

  update(visDt, simDt, realDt) {
    const ctx = this.ctx;
    const state = ctx.state;
    const on = !!state.params.layers.satellites;
    this.group.visible = on;
    if (!on) return;

    const rdt = realDt > 0 && realDt < 1 ? realDt : 1 / 60;
    this._time += rdt;
    const t = state.time.simHours;
    const d = state.derived;
    const frame = state.frame;
    const cam = ctx.camera.position;
    const camDist = cam.length();
    const orbitQ = this.orbitGroup.quaternion;

    this.pointMat.uniforms.uTime.value = this._time;
    this.pointMat.uniforms.uPixelRatio.value = ctx.renderer?.getPixelRatio?.() ?? 1;

    this._updateEquatorialFrame();

    // --- ISS ---------------------------------------------------------------
    const iL = this._issL;
    const iV = this._issV;
    const iR = this._issR;
    const iH = this._issH;
    const iW = this._issW;
    const issU = (ISS_PHASE0 + (TAU * t) / ISS_PERIOD_H) % TAU;
    orbitPoint(iL, ISS_R, ISS_INC, ISS_RAAN, issU);
    orbitTangent(iV, ISS_INC, ISS_RAAN, issU);
    iR.copy(iL).multiplyScalar(1 / ISS_R);
    iH.crossVectors(iR, iV);
    this._m4.makeBasis(iH, iR, iV);
    this.issGroup.position.copy(iL);
    this.issGroup.quaternion.setFromRotationMatrix(this._m4);
    // Paneller Güneş'e dönük (Güneş = +X yönü)
    this._qInv.copy(orbitQ).invert();
    this._sun.set(1, 0, 0).applyQuaternion(this._qInv);
    this.issPanels.rotation.x = Math.atan2(this._sun.dot(iV), this._sun.dot(iR));

    iW.copy(iL).applyQuaternion(orbitQ);
    const issMagLat = magneticLatitudeDeg(iW, frame);

    // Alt-nokta (Dünya-yerel) → GAA içinde mi?
    this._qInv.copy(frame.earthQuaternion).invert();
    const sub = this._sub.copy(iW).applyQuaternion(this._qInv);
    const subLat = Math.asin(clamp(sub.y / ISS_R, -1, 1)) / DEG;
    let dLon = Math.atan2(-sub.z, sub.x) / DEG - SAA.lon;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    const eLat = (subLat - SAA.lat) / SAA.latHalf;
    const eLon = dLon / SAA.lonHalf;
    const inSaa = eLat * eLat + eLon * eLon < 1;

    let issText = 'ISS';
    let issVariant = 'accent';
    if (d.sepPfu >= 10 && Math.abs(issMagLat) > 45) {
      issText = tt('scene.sat.issRad');
      issVariant = 'warn';
    } else if (inSaa) {
      issText = tt('scene.sat.issSaa');
      issVariant = 'warn';
    } else if (d.impacts.dragFactor > 1.3) {
      const dk = Math.round(d.impacts.dragFactor * 10);
      if (dk !== this._dragKey) {
        this._dragKey = dk;
        this._dragStr = tt('scene.sat.issDrag', { x: nf(dk / 10, 1) });
      }
      issText = this._dragStr;
      issVariant = 'warn';
    }
    const issWarn = issVariant === 'warn';
    setLabel(this.issLabelEntry, issText, issVariant);
    this.issLabelEntry.label.visible = camDist < 100 && !hiddenByEarth(cam, iW);

    // --- Parıltı noktaları: ISS --------------------------------------------
    const pos = this.ptPos;
    const col = this.ptCol;
    pos[PT_ISS * 3] = iW.x;
    pos[PT_ISS * 3 + 1] = iW.y;
    pos[PT_ISS * 3 + 2] = iW.z;
    const issC = issWarn ? this._cIssWarn : this._cIssNormal;
    col[PT_ISS * 3] = issC.r;
    col[PT_ISS * 3 + 1] = issC.g;
    col[PT_ISS * 3 + 2] = issC.b;
    this.ptPulse[PT_ISS] = issWarn ? 0.55 : 0;

    // --- GPS ---------------------------------------------------------------
    const gpsErr = d.impacts.gpsError;
    const gpsTarget = gpsErr < 5 ? this._cGpsGood : gpsErr < 12 ? this._cGpsWarn : this._cGpsBad;
    this._cGps.lerp(gpsTarget, 1 - Math.exp(-rdt * 4));
    const gpsW = (TAU * t) / GPS_PERIOD_H;
    const v = this._v;
    for (let k = 0; k < GPS_PLANES; k++) {
      const raan = this._gpsRaan[k];
      for (let j = 0; j < GPS_PER_PLANE; j++) {
        const gi = k * GPS_PER_PLANE + j;
        orbitPoint(v, GPS_R, GPS_INC, raan, (this._gpsPhase[gi] + gpsW) % TAU);
        v.applyQuaternion(orbitQ);
        const pi = PT_GPS + gi;
        pos[pi * 3] = v.x;
        pos[pi * 3 + 1] = v.y;
        pos[pi * 3 + 2] = v.z;
        col[pi * 3] = this._cGps.r;
        col[pi * 3 + 1] = this._cGps.g;
        col[pi * 3 + 2] = this._cGps.b;
      }
    }
    this.gpsRingMat.color.copy(this._cGps);

    let gpsText = tt('scene.sat.gps');
    let gpsVariant = 'default';
    if (gpsErr >= 5) {
      const gk = Math.round(gpsErr);
      if (gk !== this._gpsKey) {
        this._gpsKey = gk;
        this._gpsStr = tt('scene.sat.gpsErr', { m: gk });
      }
      gpsText = this._gpsStr;
      gpsVariant = gpsErr >= 12 ? 'danger' : 'warn';
    }
    setLabel(this.gpsLabelEntry, gpsText, gpsVariant);
    this._w.copy(this.gpsAnchor).applyQuaternion(orbitQ);
    this.gpsLabelEntry.label.visible = camDist < 150 && !hiddenByEarth(cam, this._w);

    // --- GEO ---------------------------------------------------------------
    const k6 = Math.min(1, rdt * 6);
    for (let i = 0; i < this.geo.length; i++) {
      const g = this.geo[i];
      localToWorld(g.local, frame, g.world);
      const w = g.world;
      g.exposed = !insideMagnetopause(w.x, w.y, w.z, d.r0, d.alpha);
      g.exposure += ((g.exposed ? 1 : 0) - g.exposure) * k6;

      const pi = PT_GEO + i;
      pos[pi * 3] = w.x;
      pos[pi * 3 + 1] = w.y;
      pos[pi * 3 + 2] = w.z;
      this._tmpC.copy(g.turksat ? this._cGeoTurksat : this._cGeoBase).lerp(this._cDanger, g.exposure);
      col[pi * 3] = this._tmpC.r;
      col[pi * 3 + 1] = this._tmpC.g;
      col[pi * 3 + 2] = this._tmpC.b;
      this.ptPulse[pi] = g.exposure;

      g.label.position.copy(w);
      if (g.exposed) {
        setLabel(g, g.exposedText, 'danger');
      } else if (g.turksat) {
        setLabel(g, g.name, 'accent');
      }
      g.label.visible = (g.turksat || g.exposed) && !hiddenByEarth(cam, w);
    }
    this._layoutGeoLabels();

    this.ptPosAttr.needsUpdate = true;
    this.ptColAttr.needsUpdate = true;
    this.ptPulseAttr.needsUpdate = true;

    // --- Güney Atlantik Anomalisi -------------------------------------------
    this.saaMesh.quaternion.copy(frame.earthQuaternion);
    const sepT = clamp(Math.log10(Math.max(d.sepPfu, 1)) / 4, 0, 1);
    this.saaMat.uniforms.uIntensity.value = 0.42 + 0.5 * sepT;
    this.saaMat.uniforms.uTime.value = this._time;
    // Etiket yalnızca yama kameraya bakıyorsa ve Dünya etiketten büyük görünecek kadar yakınsa görünür
    const sn = this._v.copy(this.saaCenterLocal).applyQuaternion(frame.earthQuaternion);
    const facing = sn.dot(cam) / sn.length() > 1.03;
    this.saaLabelEntry.label.visible = facing && camDist < 14;
  }

  dispose() {
    const labels = [this.issLabelEntry.label, this.gpsLabelEntry.label, this.saaLabelEntry.label];
    for (const g of this.geo) labels.push(g.label);
    for (const l of labels) l.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.ctx.scene.remove(this.group);
  }
}
