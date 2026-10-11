// Olay günlüğü (#log) ve bildirimler (#toasts). Günlük state.log'dan okunur (state'e yazılmaz);
// bildirimler ctx.events 'alert' olayından üretilir.

import './hud.css';
import { t } from '../i18n/index.js';

const MAX_ROWS = 80; // DOM'daki en çok günlük satırı
const MAX_TOASTS = 3; // aynı anda görünen en çok bildirim
const TOAST_TTL = 5.5; // sn
const TOAST_TTL_DANGER = 8; // sn
const TOAST_LEAVE = 0.3; // çıkış animasyonu (sn)
const COALESCE_SEC = 2; // aynı metin bu süre içinde birleştirilir
const GROUP_SEC = 4; // aynı kategorideki (S/G/Dst) art arda yükselmeler bu süre içinde tek bildirime yazılır
const LOG_INTERVAL = 0.25; // ~4 Hz

const LEVELS = { info: 'info', warn: 'warn', danger: 'danger' };
const levelOf = (l) => LEVELS[l] || 'info';

const pad2 = (n) => String(n).padStart(2, '0');

/** Sim saatini dile göre 'dd.MM HH:mm UT' (TR) / 'MM-dd HH:mm UT' (EN) biçimine çevirir. */
function stamp(state, simHours) {
  const d = new Date(state.time.startEpochMs + simHours * 3600e3);
  if (Number.isNaN(d.getTime())) return '—';
  return t('log.stamp', {
    dd: pad2(d.getUTCDate()),
    mm: pad2(d.getUTCMonth() + 1),
    hh: pad2(d.getUTCHours()),
    min: pad2(d.getUTCMinutes()),
  });
}

export function createLog(ctx) {
  const { state, events } = ctx;
  const root = document.getElementById('log');
  let toastRoot = document.getElementById('toasts');
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.id = 'toasts';
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRoot);
  }

  // ------------------------------------------------------------ olay günlüğü

  const seen = new WeakSet(); // işlenmiş (gösterilmiş ya da temizlenmiş) girdiler
  let lastSeen = null;
  let logDirty = true;
  let list = null;
  let emptyEl = null;

  if (root) {
    root.classList.add('glass', 'log');
    root.textContent = '';

    const head = document.createElement('div');
    head.className = 'lg-head';
    const title = document.createElement('div');
    title.className = 'lg-title';
    title.textContent = t('log.title');
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'lg-clear';
    clear.textContent = t('log.clear');
    clear.title = t('log.clearTitle');
    head.append(title, clear);

    list = document.createElement('ul');
    list.className = 'lg-list';
    list.setAttribute('aria-label', t('log.title'));

    emptyEl = document.createElement('div');
    emptyEl.className = 'lg-empty';
    emptyEl.textContent = t('log.empty');

    root.append(head, list, emptyEl);

    clear.addEventListener('click', () => {
      // Yalnızca görünümü temizle: mevcut tüm girdileri "görüldü" say
      const log = state.log;
      if (Array.isArray(log)) {
        for (const e of log) seen.add(e);
        lastSeen = log.length ? log[log.length - 1] : null;
      }
      list.textContent = '';
      emptyEl.textContent = t('log.cleared');
      emptyEl.hidden = false;
    });
  }

  function makeRow(entry) {
    const li = document.createElement('li');
    li.className = 'lg-item';
    li.setAttribute('data-s', levelOf(entry.level));
    const time = document.createElement('span');
    time.className = 'lg-time';
    time.textContent = stamp(state, Number(entry.simHours) || 0);
    const text = document.createElement('span');
    text.className = 'lg-text';
    text.textContent = String(entry.text ?? '');
    li.append(time, text);
    return li;
  }

  function syncLog() {
    if (!list) return;
    const log = state.log;
    if (!Array.isArray(log)) return;
    const last = log.length ? log[log.length - 1] : null;
    if (last === lastSeen) return;
    lastSeen = last;

    // En yeniden geriye doğru, görülmemiş girdileri topla (en yeni önce)
    const fresh = [];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (seen.has(e)) break;
      seen.add(e);
      fresh.push(e);
    }
    if (!fresh.length) return;
    if (fresh.length > MAX_ROWS) fresh.length = MAX_ROWS;

    const frag = document.createDocumentFragment();
    for (const e of fresh) frag.appendChild(makeRow(e));
    list.insertBefore(frag, list.firstChild);
    while (list.children.length > MAX_ROWS) list.removeChild(list.lastChild);
    emptyEl.hidden = list.children.length > 0;
  }

  // ------------------------------------------------------------ bildirimler

  const toasts = []; // { el, body, ttl, leaving, leaveT, text, count, countEl, group, groupAt, hover }
  const recent = new Map(); // metin → { at, toast }
  let clock = 0; // update(dt) ile ilerleyen gerçek zaman (sn)

  function startLeave(t) {
    if (t.leaving) return;
    t.leaving = true;
    t.leaveT = TOAST_LEAVE;
    try {
      t.el.style.setProperty('--h', `${t.el.offsetHeight}px`);
    } catch {
      /* yok say */
    }
    t.el.classList.add('is-leaving');
  }

  function removeToast(t) {
    const i = toasts.indexOf(t);
    if (i >= 0) toasts.splice(i, 1);
    t.el.remove();
    if (recent.get(t.text)?.toast === t) recent.delete(t.text);
  }

  function showToast(level, text, group) {
    // Aynı kategoride kısa sürede yükselen düzeyler (S3 → S4 → S5) yeni bildirim açmak yerine mevcut olanı günceller
    if (group) {
      const g = toasts.find((x) => x.group === group && !x.leaving && clock - x.groupAt < GROUP_SEC);
      if (g) {
        if (recent.get(g.text)?.toast === g) recent.delete(g.text);
        g.text = text;
        g.groupAt = clock;
        g.body.textContent = text;
        g.count = 1;
        g.countEl.hidden = true;
        g.el.setAttribute('data-s', level);
        g.el.setAttribute('role', level === 'danger' ? 'alert' : 'status');
        g.ttl = level === 'danger' ? TOAST_TTL_DANGER : TOAST_TTL;
        recent.set(text, { at: clock, toast: g });
        return;
      }
    }

    // Aynı metin kısa süre içinde tekrar gelirse yeni bildirim açma
    const prev = recent.get(text);
    if (prev && clock - prev.at < COALESCE_SEC) {
      prev.at = clock;
      const pt = prev.toast;
      if (pt && !pt.leaving) {
        pt.count += 1;
        pt.countEl.textContent = `×${pt.count}`;
        pt.countEl.hidden = false;
        pt.ttl = level === 'danger' ? TOAST_TTL_DANGER : TOAST_TTL;
      }
      return;
    }

    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('data-s', level);
    el.setAttribute('role', level === 'danger' ? 'alert' : 'status');
    const body = document.createElement('div');
    body.className = 'toast-text';
    body.textContent = text;
    const countEl = document.createElement('span');
    countEl.className = 'toast-count';
    countEl.hidden = true;
    el.append(body, countEl);

    const toast = {
      el, body, ttl: level === 'danger' ? TOAST_TTL_DANGER : TOAST_TTL, leaving: false, leaveT: 0, text, count: 1, countEl,
      group: group || null, groupAt: clock, hover: false,
    };
    el.title = t('log.toastClose');
    el.addEventListener('click', () => startLeave(toast));
    // Fare üzerindeyken (okurken) süre ilerlemesin
    el.addEventListener('pointerenter', () => {
      toast.hover = true;
    });
    el.addEventListener('pointerleave', () => {
      toast.hover = false;
    });

    toastRoot.insertBefore(el, toastRoot.firstChild); // en yeni üstte
    toasts.unshift(toast);
    recent.set(text, { at: clock, toast });

    // En çok MAX_TOASTS görünür: fazlasını (en eskiyi) çıkar
    let visible = 0;
    for (const x of toasts) {
      if (x.leaving) continue;
      visible++;
      if (visible > MAX_TOASTS) startLeave(x);
    }
  }

  const offAlert = events?.on?.('alert', (e) => {
    if (!e || typeof e.text !== 'string' || !e.text) return;
    logDirty = true;
    showToast(levelOf(e.level), e.text, e.group);
  });

  // ------------------------------------------------------------ güncelleme

  let acc = LOG_INTERVAL;
  return {
    update(dt) {
      clock += dt;

      // Bildirim zamanlayıcıları
      for (let i = toasts.length - 1; i >= 0; i--) {
        const t = toasts[i];
        if (t.leaving) {
          t.leaveT -= dt;
          if (t.leaveT <= 0) removeToast(t);
        } else if (!t.hover) {
          t.ttl -= dt;
          if (t.ttl <= 0) startLeave(t);
        }
      }
      // Birleştirme tablosunu temizle
      if (recent.size > 24) {
        for (const [k, v] of recent) if (clock - v.at >= COALESCE_SEC && !toasts.includes(v.toast)) recent.delete(k);
      }

      acc += dt;
      if (logDirty || acc >= LOG_INTERVAL) {
        acc = 0;
        logDirty = false;
        syncLog();
      }
    },
    dispose() {
      offAlert?.();
      for (const t of [...toasts]) removeToast(t);
    },
  };
}
