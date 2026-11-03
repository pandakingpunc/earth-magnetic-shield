// Canlı uzay havası denetleyicisi: canlı mod açıkken ve sekme görünürken NOAA verisini periyodik çeker,
// örneği ctx.sim.applyLiveSample ile uygular. Sahne katmanlarında değil, arayüzde yaşar.
// Açılışta ağ çağrısı yapmaz; yalnızca state.live.on iken çeker.

import { fetchLiveSpaceWeather } from '../core/liveData.js';

export const LIVE_POLL_MS = 5 * 60e3; // dosya ~2,4 MB: 5 dakikadan sık çekme
export const LIVE_RETRY_MS = 60e3; // hata sonrası yeniden deneme
const CHECK_MS = 15e3;

export function createLive(ctx, { fetchImpl } = {}) {
  const { state, sim, events } = ctx;
  let timer = null;
  let busy = false;
  let nextAt = 0;
  let abort = null;
  let gen = 0; // kapatıp yeniden açmada eski yanıtları yok saymak için

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

  async function refresh() {
    if (!state.live.on || busy) return;
    busy = true;
    const my = gen;
    abort = new AbortController();
    sim.setLiveStatus('loading');
    try {
      const sample = await fetchLiveSpaceWeather({ fetchImpl, signal: abort.signal });
      if (my !== gen || !state.live.on) return;
      sim.applyLiveSample(sample);
      nextAt = Date.now() + LIVE_POLL_MS;
    } catch (err) {
      if (my !== gen || !state.live.on) return;
      sim.setLiveStatus('error', err);
      nextAt = Date.now() + LIVE_RETRY_MS;
    } finally {
      busy = false;
      abort = null;
    }
  }

  function tick() {
    if (state.live.on && visible() && Date.now() >= nextAt) refresh();
  }

  function sync() {
    if (state.live.on && !timer) {
      gen++;
      nextAt = 0;
      timer = setInterval(tick, CHECK_MS);
      refresh();
    } else if (!state.live.on && timer) {
      clearInterval(timer);
      timer = null;
      gen++;
      abort?.abort();
    }
  }

  const offs = [events.on('live:update', sync)];
  const onVis = () => tick();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);

  return {
    /** Elle yenile (hata sonrası "Yeniden dene") */
    refresh() {
      nextAt = 0;
      refresh();
    },
    update() {},
    dispose() {
      for (const off of offs) off();
      if (timer) clearInterval(timer);
      abort?.abort();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    },
  };
}
