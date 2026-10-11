// Klavye kısayolları. Metin girişi (input/select/textarea) odaktayken veya Ctrl/Meta ile çalışmaz.
// Esc ile bilgi penceresini kapatma info.js içindedir.
//
//   Boşluk duraklat/devam · F fırtına · K kozmik ışın patlaması · T kutup tersinmesi
//   1–7 kamera önayarları · H arayüzü gizle · L etiketler · I veya ? yardım · Shift+R sıfırla

import { CAMERA_PRESETS } from '../scene/cameraRig.js';

function isEditable(node) {
  if (!node || !node.tagName) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || node.isContentEditable === true;
}

export function setupShortcuts(ctx) {
  const { state, sim, events } = ctx;
  const cameraNames = Object.keys(CAMERA_PRESETS);
  const modal = document.getElementById('info-modal');

  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (isEditable(e.target) || isEditable(document.activeElement)) return;
    if (modal && !modal.hidden) return; // bilgi penceresi açıkken yalnızca Esc (info.js) çalışır

    const k = e.key;
    if (typeof k !== 'string') return;
    switch (k) {
      case ' ':
        // Odaktaki düğme/sekme Boşluk ile kendi işini yapsın
        if (e.target?.closest?.('button, a[href], summary, [role="button"], [role="tab"], [role="radio"]')) return;
        e.preventDefault();
        state.time.paused = !state.time.paused;
        return;
      case 'f':
      case 'F':
        sim.triggerSolarStorm();
        return;
      case 'k':
      case 'K':
        sim.triggerCosmicBurst();
        return;
      case 't':
      case 'T':
        sim.startPoleReversal();
        return;
      case 'h':
      case 'H':
        ctx.ui?.toggleHidden?.();
        return;
      case 'l':
      case 'L': {
        const layers = state.params.layers;
        layers.labels = !layers.labels;
        events.emit('layers:changed', { layers });
        return;
      }
      case 'i':
      case 'I':
      case 'İ':
      case 'ı':
      case '?':
        ctx.ui?.openInfo?.('controls');
        return;
      case 'r':
      case 'R':
        // Kazara sıfırlamayı önlemek için yalnızca Shift ile
        if (e.shiftKey) sim.reset();
        return;
      default:
        break;
    }

    // 1–7: kamera önayarları (CAMERA_PRESETS sırasıyla)
    if (k.length === 1 && k >= '1' && k <= '7') {
      const name = cameraNames[Number(k) - 1];
      if (name) {
        ctx.cameraRig?.goTo(name);
        events.emit('camera:preset', { name });
      }
    }
  };

  // Fareyle tıklanan düğme odağı tutmasın: aksi hâlde Boşluk (duraklat) o düğmeyi yeniden tetikler.
  // Klavyeyle etkinleştirmede (detail 0) odak kalır; bilgi penceresi kendi odağını yönetir.
  const onClick = (e) => {
    if (e.detail === 0) return;
    const a = document.activeElement;
    if (a && a.tagName === 'BUTTON' && !a.closest('#info-modal')) a.blur();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('click', onClick);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('click', onClick);
  };
}
