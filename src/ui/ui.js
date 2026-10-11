// Arayüz yapıştırıcısı: tüm arayüz bileşenlerini oluşturur ve her karede günceller.
// Her bileşen { update(dt) } döndürür. Bileşenler kendi DOM kapsayıcılarına (index.html) yazar.

import { createTopBar } from './topbar.js';
import { createPanel } from './panel.js';
import { createInfo } from './info.js';
import { setupShortcuts } from './shortcuts.js';
import { createHud } from './hud.js';
import { createCharts } from './charts.js';
import { createLog } from './log.js';
import { t } from '../i18n/index.js';

export function createUI(ctx) {
  // index.html'deki bölge etiketleri Türkçe yedektir; etkin dile göre üzerine yaz
  document.getElementById('panel')?.setAttribute('aria-label', t('misc.a11y.panel'));
  document.getElementById('hud')?.setAttribute('aria-label', t('misc.a11y.hud'));

  const uiCtx = {
    ...ctx,
    ui: {
      toggleHidden() {
        document.body.classList.toggle('ui-hidden');
      },
      openInfo: (topic) => info.open(topic),
    },
  };
  const info = createInfo(uiCtx);
  const parts = [
    createTopBar(uiCtx),
    createPanel(uiCtx),
    createHud(uiCtx),
    createCharts(uiCtx),
    createLog(uiCtx),
    info,
  ];
  setupShortcuts(uiCtx);

  return {
    update(dt) {
      for (const p of parts) {
        try {
          p.update?.(dt);
        } catch (err) {
          console.error('[arayüz güncelleme hatası]', err);
        }
      }
    },
  };
}
