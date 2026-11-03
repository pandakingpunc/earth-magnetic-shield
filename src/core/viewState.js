// Görünüm durumu yardımcıları (saf, WebGL'siz): URL parametreleri, paylaşım bağlantısı, kalite otomatiği,
// dil değişiminde oturum anlık görüntüsü. main.js, topbar.js ve i18n/index.js kullanır.

export const QUALITY_LEVELS = ['high', 'medium', 'low']; // 0 = en yüksek
export const QUALITY_CHOICES = ['auto', ...QUALITY_LEVELS];

/** Kalite düzeyi → oluşturma ayarları. dprCap: piksel oranı üst sınırı; msaaHi: yüksek DPR'de MSAA örnekleri */
export const QUALITY_PROFILES = {
  high: { dprCap: 2, msaa: 4, msaaHiDpr: 2, bloom: true },
  medium: { dprCap: 1.25, msaa: 4, msaaHiDpr: 4, bloom: true },
  low: { dprCap: 1, msaa: 0, msaaHiDpr: 0, bloom: false },
};

export function pixelRatioFor(level, dpr) {
  const p = QUALITY_PROFILES[level] ?? QUALITY_PROFILES.high;
  return Math.max(0.5, Math.min(Number.isFinite(dpr) ? dpr : 1, p.dprCap));
}

export function msaaSamplesFor(level, pixelRatio) {
  const p = QUALITY_PROFILES[level] ?? QUALITY_PROFILES.high;
  return pixelRatio > 1.5 ? p.msaaHiDpr : p.msaa;
}

// ---------------------------------------------------------------- otomatik kalite (histerezis)

export const AUTO_Q = { downFps: 40, downSec: 3, upFps: 58, upSec: 10, maxChangesPerMin: 3 };

export function createAutoQuality(level = 0) {
  return { level, lowT: 0, highT: 0, clock: 0, changes: [] };
}

/**
 * Durum makinesi: her ölçümde (fps, geçen sn) çağrılır; seviye değiştiyse yeni düzeyi (0..2), yoksa -1 döndürür.
 * Aşağı: fps < 40 kesintisiz ~3 sn. Yukarı: fps > 58 kesintisiz ~10 sn. Dakikada en çok 3 değişiklik.
 * Aradaki bölgede (40–58) sayaçlar sıfırlanır → salınım olmaz.
 */
export function stepAutoQuality(s, fps, dt) {
  s.clock += dt;
  if (!Number.isFinite(fps)) return -1;
  s.lowT = fps < AUTO_Q.downFps ? s.lowT + dt : 0;
  s.highT = fps > AUTO_Q.upFps ? s.highT + dt : 0;
  let next = s.level;
  if (s.lowT >= AUTO_Q.downSec && s.level < QUALITY_LEVELS.length - 1) next = s.level + 1;
  else if (s.highT >= AUTO_Q.upSec && s.level > 0) next = s.level - 1;
  if (next === s.level) return -1;
  // dakikada en çok N değişiklik
  while (s.changes.length && s.clock - s.changes[0] > 60) s.changes.shift();
  if (s.changes.length >= AUTO_Q.maxChangesPerMin) return -1;
  s.changes.push(s.clock);
  s.level = next;
  s.lowT = 0;
  s.highT = 0;
  return next;
}

// ---------------------------------------------------------------- URL parametreleri

/**
 * ?preset=<id>&cam=<id> ayrıştır. Bilinmeyen değerler sessizce yok sayılır (null).
 * @param {string} search  location.search
 * @param {{presets: string[], cams: string[]}} known
 */
export function parseUrlParams(search, known) {
  const out = { preset: null, cam: null };
  let q;
  try {
    q = new URLSearchParams(search || '');
  } catch {
    return out;
  }
  const preset = q.get('preset');
  const cam = q.get('cam');
  if (preset && Array.isArray(known?.presets) && known.presets.includes(preset)) out.preset = preset;
  if (cam && Array.isArray(known?.cams) && known.cams.includes(cam)) out.cam = cam;
  return out;
}

/** Paylaşım bağlantısı: yalnızca lang + (varsa) preset + cam. */
export function buildShareUrl(href, { lang, preset, cam } = {}) {
  const u = new URL(href);
  u.search = '';
  u.hash = '';
  if (lang) u.searchParams.set('lang', lang);
  if (preset) u.searchParams.set('preset', preset);
  if (cam) u.searchParams.set('cam', cam);
  return u.toString();
}

/** Panoya kopyala; clipboard yoksa execCommand yedeği. Başarıyı döndürür. */
export async function copyText(text) {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* izin yok → yedek yol */
  }
  try {
    const doc = globalThis.document;
    if (!doc?.body || typeof doc.execCommand !== 'function') return false;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

/** manyetik-kalkan-YYYYMMDD-HHMM.png */
export function screenshotName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `manyetik-kalkan-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

// ---------------------------------------------------------------- dil değişiminde anlık görüntü

export const SNAPSHOT_KEY = 'ms-snapshot';
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const vec = (v) => Array.isArray(v) && v.length === 3 && v.every(fin);

/** Küçük, JSON'a uygun anlık görüntü. camera/controls verilmezse kamera alanı yazılmaz. */
export function makeSnapshot(state, camera, controls) {
  const p = state.params;
  const snap = {
    layers: { ...p.layers },
    solarWind: { ...p.solarWind },
    fieldStrength: p.fieldStrength,
    stormStrength: p.stormStrength,
    stormPresetId: p.stormPresetId,
    quality: p.quality,
    timeScale: state.time.timeScale,
  };
  if (camera && controls) {
    snap.cam = {
      pos: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    };
  }
  return snap;
}

export function saveSnapshot(snap, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

/** Anlık görüntüyü oku ve anahtarı sil (bir kez geçerli). Yoksa/bozuksa null. */
export function takeSnapshot(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    storage.removeItem(SNAPSHOT_KEY);
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** Anlık görüntüyü durumun mevcut anahtarlarına doğrula-uygula. Kamera için { pos, target } döndürür (ya da null). */
export function applySnapshot(state, snap) {
  if (!snap || typeof snap !== 'object') return null;
  const p = state.params;
  if (snap.layers && typeof snap.layers === 'object') {
    for (const k of Object.keys(p.layers)) if (typeof snap.layers[k] === 'boolean') p.layers[k] = snap.layers[k];
  }
  if (snap.solarWind && typeof snap.solarWind === 'object') {
    for (const k of Object.keys(p.solarWind)) if (fin(snap.solarWind[k])) p.solarWind[k] = snap.solarWind[k];
  }
  if (fin(snap.fieldStrength)) p.fieldStrength = Math.max(0, Math.min(2, snap.fieldStrength));
  if (fin(snap.stormStrength)) p.stormStrength = Math.max(0, Math.min(1, snap.stormStrength));
  if (snap.stormPresetId === null || typeof snap.stormPresetId === 'string') p.stormPresetId = snap.stormPresetId;
  if (QUALITY_CHOICES.includes(snap.quality)) p.quality = snap.quality;
  if (fin(snap.timeScale) && snap.timeScale >= 0) state.time.timeScale = snap.timeScale;
  const c = snap.cam;
  return c && vec(c.pos) && vec(c.target) ? { pos: c.pos, target: c.target } : null;
}
