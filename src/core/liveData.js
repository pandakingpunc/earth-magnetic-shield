// Canlı uzay havası: NOAA SWPC gerçek zamanlı güneş rüzgârı (L1) ve Kp verisi.
// Ayrıştırıcılar saf işlevlerdir (testli); ağ çağrısı yalnızca fetchLiveSpaceWeather içinde.

export const LIVE_URLS = {
  wind: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json',
  mag: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json',
  kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
};
export const LIVE_TIMEOUT_MS = 15000;

/** "2026-11-03T13:25:02" (Z yok) → UTC ms; geçersizse NaN */
export function parseTimeTag(tag) {
  if (typeof tag !== 'string' || !tag) return NaN;
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(tag);
  let s = tag.trim().replace(' ', 'T');
  if (!hasZone) s += 'Z';
  return Date.parse(s);
}

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const ok = (v) => Number.isFinite(num(v));

/** En yeni satırı seçer: önce active===true ve alanlar geçerli; yoksa herhangi bir kaynaktan en yeni geçerli satır.
 *  Dizi yeniden eskiye sıralı varsayılır, ama güvenlik için zamana göre de karşılaştırılır. */
function pickRow(rows, fields) {
  if (!Array.isArray(rows)) return null;
  let bestActive = null;
  let bestAny = null;
  let tActive = -Infinity;
  let tAny = -Infinity;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (!fields.every((f) => ok(r[f]))) continue;
    const tm = parseTimeTag(r.time_tag);
    const tv = Number.isFinite(tm) ? tm : -Infinity;
    if (tv > tAny || (bestAny === null && tv === tAny)) {
      bestAny = r;
      tAny = tv;
    }
    if (r.active === true && (tv > tActive || (bestActive === null && tv === tActive))) {
      bestActive = r;
      tActive = tv;
    }
  }
  return bestActive || bestAny;
}

/** Rüzgâr: { speed, density, time, source } veya null */
export function parseWind(json) {
  const r = pickRow(json, ['proton_speed', 'proton_density']);
  if (!r) return null;
  return {
    speed: num(r.proton_speed),
    density: num(r.proton_density),
    time: parseTimeTag(r.time_tag),
    source: typeof r.source === 'string' ? r.source : null,
  };
}

/** Manyetik alan (GSM): { bt, by, bz, time, source } veya null */
export function parseMag(json) {
  const r = pickRow(json, ['bz_gsm', 'by_gsm']);
  if (!r) return null;
  const by = num(r.by_gsm);
  const bz = num(r.bz_gsm);
  return {
    bt: ok(r.bt) ? num(r.bt) : Math.hypot(by, bz),
    by,
    bz,
    time: parseTimeTag(r.time_tag),
    source: typeof r.source === 'string' ? r.source : null,
  };
}

/** Gözlenen gezegensel Kp: dizi eskiden yeniye sıralı; en yeni geçerli satır → { kp, time } veya null.
 *  Başlık satırı (dizi dizisi) ya da nesne biçimi desteklenir. */
export function parseKp(json) {
  if (!Array.isArray(json)) return null;
  let best = null;
  let bestT = -Infinity;
  for (const r of json) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const kp = num(r.Kp ?? r.kp);
    if (!Number.isFinite(kp) || kp < 0 || kp > 9) continue;
    const tm = parseTimeTag(r.time_tag);
    if (!Number.isFinite(tm)) continue;
    if (tm >= bestT) {
      best = { kp, time: tm };
      bestT = tm;
    }
  }
  return best;
}

async function getJson(fetchImpl, url, signal) {
  const res = await fetchImpl(url, { signal, cache: 'no-store' });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '?'}`);
  return res.json();
}

/** Üç uç noktayı paralel çeker. Rüzgâr veya manyetik alan başarısızsa hata fırlatır; Kp hatası önemsizdir.
 *  → { speed, density, bt, by, bz, kpObserved, kpTime, windTime, magTime, source } */
export async function fetchLiveSpaceWeather({ fetchImpl, signal, timeoutMs = LIVE_TIMEOUT_MS } = {}) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('fetch yok');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const [wind, mag, kp] = await Promise.all([
      getJson(f, LIVE_URLS.wind, ctrl.signal).then(parseWind),
      getJson(f, LIVE_URLS.mag, ctrl.signal).then(parseMag),
      getJson(f, LIVE_URLS.kp, ctrl.signal).then(parseKp).catch(() => null),
    ]);
    if (!wind) throw new Error('rüzgâr verisi yok');
    if (!mag) throw new Error('manyetik alan verisi yok');
    return {
      speed: wind.speed,
      density: wind.density,
      bt: mag.bt,
      by: mag.by,
      bz: mag.bz,
      kpObserved: kp ? kp.kp : null,
      kpTime: kp ? kp.time : null,
      windTime: wind.time,
      magTime: mag.time,
      source: wind.source || mag.source || null,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
