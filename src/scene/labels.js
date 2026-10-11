// CSS2D etiket yardımcıları. Etiketler body.hide-labels sınıfıyla topluca gizlenir.

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * @param {string} text  Görünen metin
 * @param {string} [variant]  'default' | 'small' | 'warn' | 'danger' | 'accent'
 * @returns {CSS2DObject}  .element.textContent ile güncellenebilir
 */
export function makeLabel(text, variant = 'default') {
  const el = document.createElement('div');
  el.className = `scene-label scene-label--${variant}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 1.2);
  return obj;
}

export function setLabelVariant(label, variant) {
  label.element.className = `scene-label scene-label--${variant}`;
}

const LABEL_PRIORITY = { danger: 4, warn: 3, accent: 2, default: 1, small: 0 };
const _variantRe = /scene-label--(\w+)/;

/**
 * Ekranda çakışan etiketleri önceliğe göre gizler (tehlike > uyarı > vurgu > normal > küçük).
 * Gizlenen etiket opacity ile saklanır; yerleşimi korunur, böylece bir sonraki taramada yeniden ölçülebilir.
 * Pahalı olmaması için birkaç karede bir çağrılmalıdır.
 */
export function declutterLabels(container, pad = 3) {
  const els = container.getElementsByClassName('scene-label');
  const items = [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (el.style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const m = _variantRe.exec(el.className);
    items.push({ el, r, p: LABEL_PRIORITY[m ? m[1] : 'default'] ?? 1, i });
  }
  items.sort((a, b) => b.p - a.p || a.i - b.i);
  const placed = [];
  for (const it of items) {
    const r = it.r;
    let hit = false;
    for (let k = 0; k < placed.length; k++) {
      const q = placed[k];
      if (r.left - pad < q.right && r.right + pad > q.left && r.top - pad < q.bottom && r.bottom + pad > q.top) {
        hit = true;
        break;
      }
    }
    if (hit !== it.el.classList.contains('is-occluded')) it.el.classList.toggle('is-occluded', hit);
    if (!hit) placed.push(r);
  }
}
