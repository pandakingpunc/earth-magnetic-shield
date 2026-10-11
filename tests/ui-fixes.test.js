// @vitest-environment happy-dom
//
// Arayüz düzeltmeleri: bildirim birleştirme, kamera önayarı vurgusu, HUD (Dst/SSC, İstanbul gündüz, engellenen oran),
// topbar yardım düğmesi ve telefon günlük çekmecesi. WebGL gerekmez.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../src/core/events.js';
import { createState } from '../src/core/state.js';
import { SpaceWeatherSim } from '../src/core/simulation.js';
import { CameraRig } from '../src/scene/cameraRig.js';

function setupDom() {
  document.body.innerHTML = `
    <div id="app"></div><header id="topbar"></header><aside id="panel"></aside><aside id="hud"></aside>
    <section id="bottom"><div id="charts"></div><div id="log"></div></section>
    <div id="toasts"></div><div id="info-modal" hidden></div>`;
}

describe('bildirimler', () => {
  beforeEach(setupDom);

  it('aynı kategorideki art arda yükselmeler (S3 → S4 → S5) tek bildirimde birleşir; günlük hepsini tutar', async () => {
    const state = createState();
    const events = new EventBus();
    const { createLog } = await import('../src/ui/log.js');
    const log = createLog({ state, events });
    const sim = new SpaceWeatherSim(state, events);
    sim.alert('warn', '☢️ Radyasyon fırtınası S3', 'sep');
    sim.alert('danger', '☢️ Radyasyon fırtınası S4', 'sep');
    sim.alert('danger', '☢️ Radyasyon fırtınası S5', 'sep');
    sim.alert('info', 'başka bir olay');
    log.update(0.016);
    const toasts = [...document.querySelectorAll('.toast')];
    expect(toasts.length).toBe(2);
    const texts = toasts.map((t) => t.querySelector('.toast-text').textContent);
    expect(texts).toContain('☢️ Radyasyon fırtınası S5');
    expect(texts.some((t) => t.includes('S3') || t.includes('S4'))).toBe(false);
    expect(state.log.filter((l) => l.group === 'sep').length).toBe(3);
    log.dispose();
  });
});

describe('kamera önayarı vurgusu', () => {
  it('kullanıcı yörüngede döndürünce önayar seçimi kalkar', () => {
    const camera = new THREE.PerspectiveCamera();
    const listeners = {};
    const controls = {
      target: new THREE.Vector3(),
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
    };
    const rig = new CameraRig(camera, controls);
    rig.goTo('earth');
    expect(rig.current).toBe('earth');
    listeners.start();
    expect(rig.current).toBeNull();
    expect(rig.tween).toBeNull();
  });
});

describe('arayüz (HUD, üst çubuk)', () => {
  beforeEach(setupDom);

  async function build() {
    const state = createState();
    const events = new EventBus();
    const sim = new SpaceWeatherSim(state, events);
    state.perf = { fps: 60 };
    const ctx = {
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3() },
      renderer: {}, state, events, sim, textures: null, cameraRig: new CameraRig(new THREE.PerspectiveCamera(), { target: new THREE.Vector3() }),
      bloom: {}, layers: {},
    };
    const { createUI } = await import('../src/ui/ui.js');
    const ui = createUI(ctx);
    return { state, sim, ui, ctx };
  }

  it('HUD “Simülasyon” der, Dst > +15 nT iken “Sakin” demez, engellenen oran alan yokken %0', async () => {
    const { state, sim, ui } = await build();
    ui.update(0.2);
    expect(document.querySelector('.hud-live').textContent).toBe('Simülasyon');
    expect(document.querySelector('.hud-live').title).toContain('Gerçek veri değildir');
    // basınç sıçraması: Dst pozitif
    state.derived.dst = 60;
    ui.update(0.2);
    expect(document.querySelector('.dst-class .chip').textContent).toBe('Basınç sıçraması');
    // alan yok → engellenen oran %0
    sim.setFieldStrength(0);
    sim.update(1 / 60);
    ui.update(0.2);
    const row = [...document.querySelectorAll('.hud-row')].find((r) => r.textContent.includes('engellediği'));
    expect(row.textContent).toContain('%0');
  });

  it('İstanbul: oval ulaştı ama gündüzse “gündüz” gösterilir', async () => {
    const { state, ui } = await build();
    state.derived.turkeyAurora = 'overhead';
    state.derived.turkeyDark = false;
    state.derived.istanbulSunElevDeg = 40;
    ui.update(0.2);
    const row = [...document.querySelectorAll('.hud-row')].find((r) => r.textContent.includes('İstanbul'));
    expect(row.textContent).toContain('gündüz');
    state.derived.turkeyDark = true;
    state.derived.istanbulSunElevDeg = -30;
    ui.update(0.2);
    expect(row.textContent).toContain('tepede');
  });

  it('“?” düğmesi “Kısayollar ve kullanım” sayfasını açar; telefon günlük çekmecesi açılıp kapanır', async () => {
    const { ui } = await build();
    const help = [...document.querySelectorAll('#topbar button')].find((b) => b.textContent === '?');
    help.click();
    const modal = document.getElementById('info-modal');
    expect(modal.hidden).toBe(false);
    expect(modal.textContent).toContain('Kısayollar');
    expect(modal.querySelector('[aria-selected="true"]')?.textContent ?? '').toContain('Kısayollar');
    const logBtn = [...document.querySelectorAll('#topbar .tb-drawer')].find((b) => b.title === 'Günlük');
    expect(logBtn).toBeTruthy();
    logBtn.click();
    ui.update(0.2);
    expect(document.getElementById('log').classList.contains('open')).toBe(true);
    expect(logBtn.getAttribute('aria-expanded')).toBe('true');
    const hudBtn = [...document.querySelectorAll('#topbar .tb-drawer')].find((b) => b.title === 'Veri');
    hudBtn.click();
    ui.update(0.2);
    expect(document.getElementById('log').classList.contains('open')).toBe(false);
    expect(document.getElementById('hud').classList.contains('open')).toBe(true);
  });
});
