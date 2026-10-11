// Bilgi penceresi (#info-modal): sol sekme listesi + sağ içerik. Kapatma: ×, Esc, arka plana tıklama.
// İçerik küçük bir blok biçiminde tanımlanır: lead, h, p, ul, ol, table, keys, note.
// Tüm metinler i18n anahtarıdır (info.*); çizim anında t() ile çözülür.
// Metinlerde **kalın** işareti kullanılabilir; keys tablosunda [Tuş] işaretli parçalar <kbd> olur.

import './panel.css';
import { el } from './panel.js';
import { t } from '../i18n/index.js';


const TOPICS = [
  {
    id: 'magnetosphere',
    icon: '🧲',
    title: 'info.magnetosphere.title',
    blocks: [
      { lead: 'info.magnetosphere.0' },
      { h: 'info.magnetosphere.1' },
      { p: 'info.magnetosphere.2' },
      { h: 'info.magnetosphere.3' },
      { p: 'info.magnetosphere.4' },
      { p: 'info.magnetosphere.5' },
      { h: 'info.magnetosphere.6' },
      { ul: ['info.magnetosphere.7.0', 'info.magnetosphere.7.1', 'info.magnetosphere.7.2', 'info.magnetosphere.7.3', 'info.magnetosphere.7.4', 'info.magnetosphere.7.5'] },
      { note: 'info.magnetosphere.8' },
    ],
  },
  {
    id: 'solarStorm',
    icon: '☀️',
    title: 'info.solarStorm.title',
    blocks: [
      { lead: 'info.solarStorm.0' },
      { h: 'info.solarStorm.1' },
      { table: { head: ['info.solarStorm.2.h0', 'info.solarStorm.2.h1', 'info.solarStorm.2.h2'], rows: [['info.solarStorm.2.r0c0', 'info.solarStorm.2.r0c1', 'info.solarStorm.2.r0c2'], ['info.solarStorm.2.r1c0', 'info.solarStorm.2.r1c1', 'info.solarStorm.2.r1c2'], ['info.solarStorm.2.r2c0', 'info.solarStorm.2.r2c1', 'info.solarStorm.2.r2c2']] } },
      { h: 'info.solarStorm.3' },
      { p: 'info.solarStorm.4' },
      { p: 'info.solarStorm.5' },
      { h: 'info.solarStorm.6' },
      { ul: ['info.solarStorm.7.0', 'info.solarStorm.7.1', 'info.solarStorm.7.2'] },
      { h: 'info.solarStorm.8' },
      { ul: ['info.solarStorm.9.0', 'info.solarStorm.9.1', 'info.solarStorm.9.2', 'info.solarStorm.9.3', 'info.solarStorm.9.4'] },
      { note: 'info.solarStorm.10' },
    ],
  },
  {
    id: 'cosmicRays',
    icon: '🌌',
    title: 'info.cosmicRays.title',
    blocks: [
      { lead: 'info.cosmicRays.0' },
      { h: 'info.cosmicRays.1' },
      { ul: ['info.cosmicRays.2.0', 'info.cosmicRays.2.1'] },
      { h: 'info.cosmicRays.3' },
      { p: 'info.cosmicRays.4' },
      { p: 'info.cosmicRays.5' },
      { p: 'info.cosmicRays.6' },
      { h: 'info.cosmicRays.7' },
      { p: 'info.cosmicRays.8' },
      { h: 'info.cosmicRays.9' },
      { p: 'info.cosmicRays.10' },
      { note: 'info.cosmicRays.11' },
    ],
  },
  {
    id: 'vanAllen',
    icon: '🍩',
    title: 'info.vanAllen.title',
    blocks: [
      { lead: 'info.vanAllen.0' },
      { h: 'info.vanAllen.1' },
      { p: 'info.vanAllen.2' },
      { h: 'info.vanAllen.3' },
      { ul: ['info.vanAllen.4.0', 'info.vanAllen.4.1', 'info.vanAllen.4.2'] },
      { h: 'info.vanAllen.5' },
      { p: 'info.vanAllen.6' },
      { h: 'info.vanAllen.7' },
      { p: 'info.vanAllen.8' },
    ],
  },
  {
    id: 'aurora',
    icon: '🌠',
    title: 'info.aurora.title',
    blocks: [
      { lead: 'info.aurora.0' },
      { h: 'info.aurora.1' },
      { p: 'info.aurora.2' },
      { h: 'info.aurora.3' },
      { table: { head: ['info.aurora.4.h0', 'info.aurora.4.h1', 'info.aurora.4.h2', 'info.aurora.4.h3'], rows: [['info.aurora.4.r0c0', 'info.aurora.4.r0c1', 'info.aurora.4.r0c2', 'info.aurora.4.r0c3'], ['info.aurora.4.r1c0', 'info.aurora.4.r1c1', 'info.aurora.4.r1c2', 'info.aurora.4.r1c3'], ['info.aurora.4.r2c0', 'info.aurora.4.r2c1', 'info.aurora.4.r2c2', 'info.aurora.4.r2c3']] } },
      { p: 'info.aurora.5' },
      { h: 'info.aurora.6' },
      { p: 'info.aurora.7' },
      { h: 'info.aurora.8' },
      { p: 'info.aurora.9' },
    ],
  },
  {
    id: 'indices',
    icon: '📈',
    title: 'info.indices.title',
    blocks: [
      { lead: 'info.indices.0' },
      { h: 'info.indices.1' },
      { p: 'info.indices.2' },
      { h: 'info.indices.3' },
      { p: 'info.indices.4' },
      { table: { head: ['info.indices.5.h0', 'info.indices.5.h1'], rows: [['info.indices.5.r0c0', 'info.indices.5.r0c1'], ['info.indices.5.r1c0', 'info.indices.5.r1c1'], ['info.indices.5.r2c0', 'info.indices.5.r2c1'], ['info.indices.5.r3c0', 'info.indices.5.r3c1']] } },
      { p: 'info.indices.6' },
      { h: 'info.indices.7' },
      { p: 'info.indices.8' },
      { table: { head: ['info.indices.9.h0', 'info.indices.9.h1', 'info.indices.9.h2', 'info.indices.9.h3'], rows: [['info.indices.9.r0c0', 'info.indices.9.r0c1', 'info.indices.9.r0c2', 'info.indices.9.r0c3'], ['info.indices.9.r1c0', 'info.indices.9.r1c1', 'info.indices.9.r1c2', 'info.indices.9.r1c3'], ['info.indices.9.r2c0', 'info.indices.9.r2c1', 'info.indices.9.r2c2', 'info.indices.9.r2c3'], ['info.indices.9.r3c0', 'info.indices.9.r3c1', 'info.indices.9.r3c2', 'info.indices.9.r3c3'], ['info.indices.9.r4c0', 'info.indices.9.r4c1', 'info.indices.9.r4c2', 'info.indices.9.r4c3']] } },
      { p: 'info.indices.10' },
      { ul: ['info.indices.11.0', 'info.indices.11.1', 'info.indices.11.2'] },
      { p: 'info.indices.12' },
    ],
  },
  {
    id: 'reversal',
    icon: '🧭',
    title: 'info.reversal.title',
    blocks: [
      { lead: 'info.reversal.0' },
      { h: 'info.reversal.1' },
      { p: 'info.reversal.2' },
      { p: 'info.reversal.3' },
      { h: 'info.reversal.4' },
      { p: 'info.reversal.5' },
      { p: 'info.reversal.6' },
      { h: 'info.reversal.7' },
      { p: 'info.reversal.8' },
      { h: 'info.reversal.9' },
      { ul: ['info.reversal.10.0', 'info.reversal.10.1', 'info.reversal.10.2'] },
      { note: 'info.reversal.11' },
    ],
  },
  {
    id: 'controls',
    icon: '⌨️',
    title: 'info.controls.title',
    blocks: [
      { lead: 'info.controls.0' },
      { h: 'info.controls.1' },
      { ul: ['info.controls.2.0', 'info.controls.2.1', 'info.controls.2.2', 'info.controls.2.3'] },
      { h: 'info.controls.3' },
      { keys: [['info.controls.4.r0c0', 'info.controls.4.r0c1'], ['info.controls.4.r1c0', 'info.controls.4.r1c1'], ['info.controls.4.r2c0', 'info.controls.4.r2c1'], ['info.controls.4.r3c0', 'info.controls.4.r3c1'], ['info.controls.4.r4c0', 'info.controls.4.r4c1'], ['info.controls.4.r5c0', 'info.controls.4.r5c1'], ['info.controls.4.r6c0', 'info.controls.4.r6c1'], ['info.controls.4.r7c0', 'info.controls.4.r7c1'], ['info.controls.4.r8c0', 'info.controls.4.r8c1'], ['info.controls.4.r9c0', 'info.controls.4.r9c1']] },
      { p: 'info.controls.5' },
      { h: 'info.controls.6' },
      { ol: ['info.controls.7.0', 'info.controls.7.1', 'info.controls.7.2', 'info.controls.7.3', 'info.controls.7.4'] },
    ],
  },
  {
    id: 'about',
    icon: '📚',
    title: 'info.about.title',
    blocks: [
      { lead: 'info.about.0' },
      { h: 'info.about.1' },
      { ul: ['info.about.2.0', 'info.about.2.1', 'info.about.2.2', 'info.about.2.3', 'info.about.2.4', 'info.about.2.5', 'info.about.2.6', 'info.about.2.7', 'info.about.2.8'] },
      { h: 'info.about.3' },
      { p: 'info.about.4' },
      { h: 'info.about.5' },
      { ul: ['info.about.6.0', 'info.about.6.1', 'info.about.6.2', 'info.about.6.3', 'info.about.6.4', 'info.about.6.5'] },
      { note: 'info.about.7' },
    ],
  },
];


const BY_ID = new Map(TOPICS.map((tp) => [tp.id, tp]));

// ------------------------------------------------------------------ içerik oluşturma

/** **kalın** işaretli metni DOM parçasına çevirir */
function inline(text) {
  const frag = document.createDocumentFragment();
  text.split('**').forEach((part, i) => {
    if (!part) return;
    frag.appendChild(i % 2 ? el('strong', { text: part }) : document.createTextNode(part));
  });
  return frag;
}

/** '[Shift] + [R]' → <kbd>Shift</kbd> + <kbd>R</kbd> */
function keyCombo(text) {
  const frag = document.createDocumentFragment();
  for (const part of text.split(/(\[[^\]]+\])/)) {
    if (!part) continue;
    if (part.startsWith('[') && part.endsWith(']')) frag.appendChild(el('kbd', { text: part.slice(1, -1) }));
    else frag.appendChild(document.createTextNode(part));
  }
  return frag;
}

function table(head, rows, cell, cls = '') {
  return el(
    'div', { class: `im-table-wrap ${cls}`.trim() },
    el(
      'table', {},
      el('thead', {}, el('tr', {}, head.map((h) => el('th', { text: h })))),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => el('td', {}, cell(c, i)))))),
    ),
  );
}

function renderBlock(b) {
  if (b.lead) return el('p', { class: 'im-lead' }, inline(t(b.lead)));
  if (b.h) return el('h3', { text: t(b.h) });
  if (b.p) return el('p', {}, inline(t(b.p)));
  if (b.ul) return el('ul', {}, b.ul.map((k) => el('li', {}, inline(t(k)))));
  if (b.ol) return el('ol', {}, b.ol.map((k) => el('li', {}, inline(t(k)))));
  if (b.note) return el('div', { class: 'im-note' }, inline(t(b.note)));
  if (b.table) return table(b.table.head.map((k) => t(k)), b.table.rows, (c) => inline(t(c)));
  if (b.keys) return table([t('info.keys.head.key'), t('info.keys.head.fn')], b.keys, (c, i) => (i === 0 ? keyCombo(t(c)) : inline(t(c))), 'im-keys');
  return null;
}

// ------------------------------------------------------------------ pencere

export function createInfo(ctx) {
  const root = document.getElementById('info-modal');
  if (!root) return { open() {}, close() {}, update() {} };
  root.textContent = '';
  root.hidden = true;

  let current = null;
  let lastFocus = null;

  const title = el('h2', { class: 'im-title', id: 'im-title' });
  const body = el('div', { class: 'im-body', role: 'tabpanel', id: 'im-panel', tabindex: '0' });
  const closeBtn = el('button', { class: 'im-close', type: 'button', text: '×', title: t('info.close.title'), 'aria-label': t('info.close.aria'), onclick: () => close() });

  const tabBtns = TOPICS.map((tp) => el(
    'button', {
      class: 'im-tab', type: 'button', role: 'tab', id: `im-tab-${tp.id}`, 'aria-selected': 'false', 'aria-controls': 'im-panel', tabindex: '-1',
      onclick: () => select(tp.id),
    },
    el('span', { class: 'im-tab-ico', 'aria-hidden': 'true', text: tp.icon }),
    el('span', { text: t(tp.title) }),
  ));
  const tabs = el(
    'nav', { class: 'im-tabs', role: 'tablist', 'aria-label': t('info.topics'), 'aria-orientation': 'vertical' },
    el('div', { class: 'im-tabs-ttl', text: t('info.topics') }),
    tabBtns,
  );

  const dialog = el(
    'div', { class: 'im-dialog glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'im-title' },
    tabs,
    el('div', { class: 'im-main' }, el('header', { class: 'im-head' }, title, closeBtn), body),
  );
  const backdrop = el('div', { class: 'im-backdrop', onclick: () => close() });
  root.append(backdrop, dialog);

  function select(id) {
    const topic = BY_ID.get(id) ?? TOPICS[0];
    current = topic.id;
    TOPICS.forEach((tp, i) => {
      const on = tp.id === current;
      tabBtns[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabBtns[i].tabIndex = on ? 0 : -1;
    });
    title.textContent = `${topic.icon} ${t(topic.title)}`;
    body.setAttribute('aria-labelledby', `im-tab-${topic.id}`);
    body.textContent = '';
    for (const b of topic.blocks) {
      const node = renderBlock(b);
      if (node) body.appendChild(node);
    }
    body.scrollTop = 0;
  }

  function isOpen() {
    return !root.hidden;
  }

  // Kapanınca odak yalnızca klavyeyle odaklanmış açıcıya geri verilir. Fareyle açıldıysa odak
  // düğmede kalmasın: aksi hâlde Boşluk (duraklat) o düğmeyi yeniden tetikleyip pencereyi açardı.
  function focusBackTarget(node) {
    if (!node || node === document.body || typeof node.focus !== 'function') return null;
    try {
      return node.matches(':focus-visible') ? node : null;
    } catch {
      return null;
    }
  }

  function open(topic) {
    select(BY_ID.has(topic) ? topic : current ?? 'magnetosphere');
    if (!isOpen()) lastFocus = focusBackTarget(document.activeElement);
    root.hidden = false;
    const idx = TOPICS.findIndex((tp) => tp.id === current);
    tabBtns[idx]?.focus();
  }

  function close() {
    if (!isOpen()) return;
    root.hidden = true;
    if (lastFocus && lastFocus !== document.body && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  // Dışarı (dolgu alanı) tıklaması
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });

  // Sekme listesinde ok tuşlarıyla gezinme
  tabs.addEventListener('keydown', (e) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    let i = TOPICS.findIndex((tp) => tp.id === current);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = TOPICS.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') i = (i + 1) % TOPICS.length;
    else i = (i + TOPICS.length - 1) % TOPICS.length;
    select(TOPICS[i].id);
    tabBtns[i].focus();
  });

  // Esc ile kapat; Tab odağı pencerede tut
  window.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) {
      // odak pencerenin dışına (ör. gövdeye) düştüyse içeri çek
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  select('magnetosphere');

  return {
    open,
    close,
    update() {},
  };
}
