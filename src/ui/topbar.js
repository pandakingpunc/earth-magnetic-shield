// Üst çubuk (#topbar): başlık, simülasyon saati, NOAA G/S/R rozetleri ve temel denetimler.

import './panel.css';
import './lang.css';
import { SCALE_LABELS } from '../physics/indices.js';
import { simDate } from '../core/state.js';
import { dayMonth, nint } from '../core/format.js';
import { t, getLang, setLang, LANGS } from '../i18n/index.js';
import { el, setText } from './panel.js';

const UPDATE_INTERVAL = 0.1; // sn (~10 Hz)

// nameKey: sözlük anahtarı (görünen ad t() ile her kullanımda çözülür)
const SCALES = [
  { key: 'g', letter: 'G', nameKey: 'misc.topbar.scale.g' },
  { key: 's', letter: 'S', nameKey: 'misc.topbar.scale.s' },
  { key: 'r', letter: 'R', nameKey: 'misc.topbar.scale.r' },
];

const LOGO_SVG = `
<svg viewBox="0 0 36 32" width="34" height="30" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="tb-orb" cx="35%" cy="32%" r="75%">
      <stop offset="0" stop-color="#b6e8ff"/>
      <stop offset="0.55" stop-color="#2f78e0"/>
      <stop offset="1" stop-color="#0a1e55"/>
    </radialGradient>
  </defs>
  <path d="M20 2.5C9 2.5 3 8.5 3 16s6 13.5 17 13.5" fill="none" stroke="#ffc04d" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>
  <path d="M21 6.5C13 6.5 8.5 10.5 8.5 16S13 25.5 21 25.5" fill="none" stroke="#59c8ff" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M22 10.5C17.5 10.5 14.5 12.7 14.5 16s3 5.5 7.5 5.5" fill="none" stroke="#59c8ff" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/>
  <circle cx="23" cy="16" r="6" fill="url(#tb-orb)"/>
  <path d="M29.5 9.5C32.5 11.5 33.5 13.5 33.5 16s-1 4.5-4 6.5" fill="none" stroke="#59c8ff" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/>
</svg>`;

const pad2 = (n) => String(n).padStart(2, '0');

/** TR '11 Eki 2026 · 14:35 UT', EN 'Oct 11, 2026 · 14:35 UT' */
function formatClock(d) {
  return t('misc.topbar.clock', {
    dm: dayMonth(d.getUTCDate(), d.getUTCMonth(), true),
    y: d.getUTCFullYear(),
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  });
}

/**
 * Dil anahtarı: TR | EN. Etkin dil aria-pressed=true; diğerine tıklamak dili kaydedip sayfayı yeniden yükler.
 * variant: 'right' (sağ denetim grubu, geniş ekran) | 'center' (rozet satırı, ≤820 px). İkisinden yalnızca biri
 * görünür (lang.css): dar ekranda sağ grup doluyken saat taşmasın diye anahtar rozetlerin yanına taşınır.
 */
function createLangSwitch(variant) {
  const current = getLang();
  const btn = (lang) => {
    const name = `${t(`lang.switch.${lang}`)} (${lang.toUpperCase()})`;
    return el('button', {
      class: 'lang-btn', type: 'button', 'data-lang': lang,
      text: lang.toUpperCase(), title: name, 'aria-label': name, 'aria-pressed': current === lang ? 'true' : 'false',
      onclick: () => {
        if (lang !== getLang()) setLang(lang); // sayfayı yeniden yükler
      },
    });
  };
  return el('div', { class: `tb-lang tb-lang--${variant}`, role: 'group', 'aria-label': t('lang.switch.label') }, LANGS.map(btn));
}

export function createTopBar(ctx) {
  const { state, sim } = ctx;
  const root = document.getElementById('topbar');
  if (!root) return { update() {} };
  root.textContent = '';

  const openInfo = (topic) => ctx.ui?.openInfo?.(topic);
  const panelEl = document.getElementById('panel');
  const hudEl = document.getElementById('hud');
  const logEl = document.getElementById('log');

  // --- Sol: logo + başlık
  const logo = el('span', { class: 'tb-logo' });
  logo.innerHTML = LOGO_SVG; // sabit, güvenli SVG
  const left = el(
    'div', { class: 'tb-left' },
    logo,
    el(
      'div', { class: 'tb-titles' },
      el('div', { class: 'tb-title', text: t('app.title') }),
      el('div', { class: 'tb-sub', text: t('misc.topbar.subtitle') }),
    ),
  );

  // --- Orta: saat, hızlandırma hapı, NOAA rozetleri
  const clock = el('div', { class: 'tb-clock', title: t('misc.topbar.clockTitle') });
  const ff = el('div', { class: 'tb-ff', hidden: true, 'aria-live': 'polite' });
  const badges = SCALES.map((s) => {
    const node = el('span', { class: 'tb-badge', 'data-lv': '0', role: 'img' });
    node._lv = -1;
    return { ...s, node };
  });
  const center = el('div', { class: 'tb-center' }, clock, ff, el('div', { class: 'tb-badges' }, badges.map((b) => b.node), createLangSwitch('center')));

  // --- Sağ: denetimler
  const playIco = el('span', { class: 'tb-ico', 'aria-hidden': 'true' });
  const playLbl = el('span', { class: 'tb-lbl' });
  const playBtn = el('button', {
    class: 'tb-btn tb-btn--play', type: 'button',
    onclick: () => {
      state.time.paused = !state.time.paused;
      syncPlay();
    },
  }, playIco, playLbl);

  const resetBtn = el('button', {
    class: 'tb-btn tb-hide-sm', type: 'button', text: '↺', title: t('misc.topbar.resetTitle'), 'aria-label': t('misc.topbar.resetAria'),
    onclick: () => sim.reset(),
  });

  const hideBtn = el('button', {
    class: 'tb-btn tb-hide-sm', type: 'button', text: '⛶', title: t('misc.topbar.hideTitle'), 'aria-label': t('misc.topbar.hideAria'), 'aria-pressed': 'false',
    onclick: () => {
      ctx.ui?.toggleHidden?.();
      syncHide();
    },
  });

  const infoBtn = el('button', {
    class: 'tb-btn', type: 'button', text: '?', title: t('misc.topbar.infoTitle'), 'aria-label': t('misc.topbar.infoAria'),
    onclick: () => openInfo('controls'), // I / ? kısayolu ve panel alt bilgisiyle aynı sayfa ('Model ve kaynaklar' bilgi penceresinde sekme)
  });

  const fps = el('span', { class: 'tb-fps', title: t('misc.topbar.fpsTitle') });

  // Dar ekranlarda çekmece düğmeleri (genel CSS panelleri .open olmadıkça gizler)
  const drawer = (target, others, icon, label) => {
    const b = el('button', {
      class: 'tb-btn tb-drawer', type: 'button', 'aria-expanded': 'false', title: label,
      onclick: () => {
        if (!target) return;
        const open = !target.classList.contains('open');
        target.classList.toggle('open', open);
        if (open) for (const o of others) o?.classList.remove('open');
        syncDrawers();
      },
    }, el('span', { class: 'tb-ico', 'aria-hidden': 'true', text: icon }), el('span', { class: 'tb-lbl', text: label }));
    return b;
  };
  const panelDrawer = drawer(panelEl, [hudEl, logEl], '☰', t('misc.topbar.drawer.panel'));
  const hudDrawer = drawer(hudEl, [panelEl, logEl], '📊', t('misc.topbar.drawer.hud'));
  const logDrawer = drawer(logEl, [panelEl, hudEl], '📜', t('misc.topbar.drawer.log')); // telefonda olay günlüğüne erişim

  const right = el('div', { class: 'tb-right' }, fps, panelDrawer, hudDrawer, logDrawer, playBtn, resetBtn, hideBtn, infoBtn, createLangSwitch('right'));

  root.append(left, center, right);

  // Fare ile tıklandıktan sonra odağı bırak: Boşluk gibi global kısayollar düğmeyi yeniden tetiklemesin
  root.addEventListener('click', (e) => {
    if (e.detail === 0) return; // klavye ile etkinleştirme: odak kalsın
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a)) a.blur();
  });

  // --- Eşitleme
  function syncPlay() {
    const p = state.time.paused;
    setText(playIco, p ? '▶' : '⏸');
    setText(playLbl, p ? t('misc.topbar.resume') : t('misc.topbar.pause'));
    const title = p ? t('misc.topbar.resumeTitle') : t('misc.topbar.pauseTitle');
    if (playBtn.title !== title) {
      playBtn.title = title;
      playBtn.setAttribute('aria-label', p ? t('misc.topbar.resumeAria') : t('misc.topbar.pauseAria'));
    }
    clock.classList.toggle('is-paused', p);
  }

  function syncHide() {
    const hidden = document.body.classList.contains('ui-hidden');
    const v = hidden ? 'true' : 'false';
    if (hideBtn.getAttribute('aria-pressed') !== v) hideBtn.setAttribute('aria-pressed', v);
  }

  function syncDrawers() {
    const a = panelEl?.classList.contains('open') ? 'true' : 'false';
    const b = hudEl?.classList.contains('open') ? 'true' : 'false';
    const c = logEl?.classList.contains('open') ? 'true' : 'false';
    if (panelDrawer.getAttribute('aria-expanded') !== a) panelDrawer.setAttribute('aria-expanded', a);
    if (hudDrawer.getAttribute('aria-expanded') !== b) hudDrawer.setAttribute('aria-expanded', b);
    if (logDrawer.getAttribute('aria-expanded') !== c) logDrawer.setAttribute('aria-expanded', c);
  }

  function syncAll() {
    const tm = state.time;
    setText(clock, formatClock(simDate(state)));

    // CME yolculuğunda zaman hızlandırma hapı
    const warp = tm.fastForward && !tm.paused && tm.timeScale > 0;
    if (warp) {
      const n = Math.max(1, Math.round(tm.effectiveRate / tm.timeScale));
      setText(ff, t('misc.topbar.ff', { n: nint(n) }));
    }
    if (ff.hidden === warp) ff.hidden = !warp;

    // NOAA ölçek rozetleri
    for (const b of badges) {
      const raw = state.derived[b.key];
      const lv = Math.max(0, Math.min(5, Number.isFinite(raw) ? Math.round(raw) : 0));
      if (b.node._lv === lv) continue;
      b.node._lv = lv;
      b.node.dataset.lv = String(lv);
      setText(b.node, `${b.letter}${lv}`);
      const label = `${t(b.nameKey)} ${b.letter}${lv} — ${SCALE_LABELS[b.letter][lv]}`;
      b.node.title = label;
      b.node.setAttribute('aria-label', label);
    }

    syncPlay();
    syncHide();
    syncDrawers();
  }
  const syncFps = () => {
    const v = state.perf?.fps;
    setText(fps, Number.isFinite(v) ? `${Math.round(v)} FPS` : '');
  };
  syncAll();
  syncFps();

  let acc = 0;
  let fpsAcc = 0;
  return {
    update(dt) {
      fpsAcc += dt;
      if (fpsAcc >= 0.5) {
        fpsAcc = 0;
        syncFps();
      }
      acc += dt;
      if (acc < UPDATE_INTERVAL) return;
      acc = 0;
      syncAll();
    },
  };
}
