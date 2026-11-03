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
const _variantRe = /scene-label--(w+)/;

// Kare başına bellek ayırmamak için diziler/nesneler çağrılar arasında yeniden kullanılır
const _pool = []; // { el, r, p, i } (nesne havuzu)
const _items = []; // bu taramada kullanılan öğeler
const _placed = [];
const _sigTransform = []; // son taramadaki etiket imzası: transform / sınıf / metin
const _sigClass = [];
const _sigText = [];
const _sigDisp = [];
let _sigCount = -1;
let _sigPad = -1;
const _camMat = new Float32Array(16);
let _camValid = false;
const _byPriority = (a, b) => b.p - a.p || a.i - b.i;

/**
 * Ekranda çakışan etiketleri önceliğe göre gizler (tehlike > uyarı > vurgu > normal > küçük).
 * Gizlenen etiket opacity ile saklanır; yerleşimi korunur, böylece bir sonraki taramada yeniden ölçülebilir.
 * Pahalı olmaması için birkaç karede bir çağrılmalıdır.
 * camera verilirse: kamera matrisi ve etiket kümesi (sayı, ekran dönüşümü, sınıf, metin) önceki taramayla aynıysa
 * ölçüm yapılmadan atlanır; sonuç değişmeyeceği için görsel çıktı aynıdır.
 */
export function declutterLabels(container, pad = 3, camera = null) {
  const els = container.getElementsByClassName('scene-label');
  const n = els.length;

  if (camera) {
    const me = camera.matrixWorld.elements;
    let same = _camValid && n === _sigCount && pad === _sigPad;
    for (let k = 0; k < 16; k++) {
      if (same && _camMat[k] !== me[k]) same = false;
      _camMat[k] = me[k];
    }
    _camValid = true;
    for (let i = 0; i < n; i++) {
      const el = els[i];
      const tr = el.style.transform;
      const cl = el.className;
      const tx = el.textContent;
      const dp = el.style.display;
      if (same && (_sigDisp[i] !== dp || _sigTransform[i] !== tr || _sigClass[i] !== cl || _sigText[i] !== tx)) same = false;
      _sigTransform[i] = tr;
      _sigClass[i] = cl;
      _sigText[i] = tx;
      _sigDisp[i] = dp;
    }
    _sigCount = n;
    _sigPad = pad;
    if (same) return;
  }

  let count = 0;
  _items.length = 0;
  for (let i = 0; i < n; i++) {
    const el = els[i];
    if (el.style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const m = _variantRe.exec(el.className);
    let it = _pool[count];
    if (!it) it = _pool[count] = { el: null, r: null, p: 0, i: 0 };
    it.el = el;
    it.r = r;
    it.p = LABEL_PRIORITY[m ? m[1] : 'default'] ?? 1;
    it.i = i;
    _items.push(it);
    count++;
  }
  _items.sort(_byPriority);
  _placed.length = 0;
  for (let j = 0; j < count; j++) {
    const it = _items[j];
    const r = it.r;
    let hit = false;
    for (let k = 0; k < _placed.length; k++) {
      const q = _placed[k];
      if (r.left - pad < q.right && r.right + pad > q.left && r.top - pad < q.bottom && r.bottom + pad > q.top) {
        hit = true;
        break;
      }
    }
    if (hit !== it.el.classList.contains('is-occluded')) it.el.classList.toggle('is-occluded', hit);
      _sigClass[it.i] = it.el.className; // kendi değişikliğimiz bir sonraki imzayı bozmasın
    if (!hit) _placed.push(r);
    it.el = null; // DOM düğümlerini havuzda tutma
    it.r = null;
  }
}
