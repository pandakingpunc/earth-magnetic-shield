// Dil desteği (TR / EN): t(key, params), getLang(), setLang(lang), LANGS.
// Dil seçim sırası: URL ?lang=tr|en → localStorage['lang'] → navigator.language (tr* → tr, diğerleri → en).
// Dil sayfa yüklenirken bir kez seçilir; setLang kaydedip sayfayı yeniden yükler (canlı yeniden çizim yok).

import tr from './tr.js';
import en from './en.js';

export const LANGS = ['tr', 'en'];
const DICTS = { tr, en };
const STORAGE_KEY = 'lang';

const norm = (v) => (typeof v === 'string' && LANGS.includes(v.toLowerCase()) ? v.toLowerCase() : null);

function detectLang() {
  try {
    const q = norm(new URLSearchParams(globalThis.location?.search ?? '').get('lang'));
    if (q) return q;
  } catch {
    /* URL yok */
  }
  try {
    const s = norm(globalThis.localStorage?.getItem(STORAGE_KEY));
    if (s) return s;
  } catch {
    /* depolama kapalı */
  }
  const nav = globalThis.navigator?.language ?? '';
  return /^tr\b/i.test(nav) ? 'tr' : 'en';
}

let current = null;

export function getLang() {
  if (!current) current = detectLang();
  return current;
}

/** Belgeye dil ve başlığı uygula */
export function applyDocumentLang() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLang();
  document.title = t('app.title');
}

/**
 * Dili değiştir. Varsayılan: kaydet, URL'deki ?lang'ı güncelle ve sayfayı yeniden yükle.
 * { reload: false } yalnızca bellekteki dili değiştirir (testler için).
 */
export function setLang(lang, { reload = true } = {}) {
  const l = norm(lang);
  if (!l) return;
  if (!reload) {
    current = l;
    applyDocumentLang();
    return;
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, l);
  } catch {
    /* depolama kapalı */
  }
  const loc = globalThis.location;
  if (!loc) return;
  const url = new URL(loc.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', l);
    loc.replace(url.toString());
  } else {
    loc.reload();
  }
}

const warned = new Set();

/** Çeviri: t('alert.flare', { cls: 'X2.1' }) — {name} yer tutucularını doldurur. Eksik anahtarda anahtarı döndürür. */
export function t(key, params) {
  const s = DICTS[getLang()][key];
  if (s === undefined) {
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] eksik anahtar: ${key}`);
    }
    return key;
  }
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

/** Anahtar var mı? */
export function hasKey(key) {
  return DICTS[getLang()][key] !== undefined;
}
