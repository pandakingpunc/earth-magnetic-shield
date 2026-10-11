// Ortak sayı ve tarih biçimlendirme (dile duyarlı). Gerçek eksi işareti (−), −0 yok.
// TR: ondalık virgül, binlik ayırıcı ince boşluk. EN: ondalık nokta, binlik ayırıcı virgül.
// Arayüz, grafikler, sahne etiketleri ve uyarı metinleri aynı biçimi kullanır.

import { getLang, t } from '../i18n/index.js';

export const MINUS = '−';
export const THIN = ' '; // ince, bölünmeyen boşluk

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Etkin dilin ondalık ayırıcısı */
export const decimalSep = () => (getLang() === 'tr' ? ',' : '.');
/** Etkin dilin binlik ayırıcısı */
export const thousandsSep = () => (getLang() === 'tr' ? THIN : ',');

/** Ondalıklı sayı: nf(-3.25, 1) → '−3,3' (TR) / '−3.3' (EN). Sayı değilse '—'. */
export function nf(v, d = 0) {
  if (!isNum(v)) return '—';
  let s = v.toFixed(d);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace('-', MINUS).replace('.', decimalSep());
}

/** nf + sondaki gereksiz sıfırları at (2,0 → 2) */
export function nfs(v, d = 0) {
  let s = nf(v, d);
  const sep = decimalSep();
  if (s.includes(sep)) s = s.replace(/0+$/, '').replace(new RegExp(`\\${sep}$`), '');
  return s;
}

/** İşaretli sayı: +3,2 / −3,2 (sıfır işaretsiz) */
export function nfSigned(v, d = 1) {
  const s = nf(v, d);
  return isNum(v) && s[0] !== MINUS && s !== nf(0, d) ? `+${s}` : s;
}

/** Tam sayı, binlik ayırıcılı: 2 020 (TR) / 2,020 (EN) */
export function nint(v) {
  if (!isNum(v)) return '—';
  const n = Math.round(Math.abs(v));
  const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep());
  return v < 0 && n !== 0 ? MINUS + s : s;
}

/** Ay adı (0..11); short = kısa biçim */
export function monthName(m, short = false) {
  return t(`month.${short ? 'short' : 'long'}.${m}`);
}

/** Gün + ay: TR '20 Mart', EN 'March 20' */
export function dayMonth(day, m, short = false) {
  return t('date.dayMonth', { d: day, m: monthName(m, short) });
}
