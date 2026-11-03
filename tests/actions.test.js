// Üst çubuk / panel / kısayol düğmeleri ctx.actions eylemlerini gerçekten çağırır.
// Regresyon: createUI ctx'in sığ kopyasını alır; actions nesnesi ondan ÖNCE oluşturulup sonradan doldurulmalıdır (main.js).
// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createState } from '../src/core/state.js';
import { EventBus } from '../src/core/events.js';
import { SpaceWeatherSim } from '../src/core/simulation.js';
import { CameraRig } from '../src/scene/cameraRig.js';

describe('arayüz eylemleri (ctx.actions)', () => {
  it('createUI sonrası doldurulan actions üst çubuk, panel ve P kısayolundan çağrılır', async () => {
    document.body.innerHTML = `
      <div id="app"></div><header id="topbar"></header><aside id="panel"></aside><aside id="hud"></aside>
      <section id="bottom"><div id="charts"></div><div id="log"></div></section>
      <div id="toasts"></div><div id="info-modal" hidden></div>`;
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 3000);
    const controls = { target: new THREE.Vector3(), update() {}, autoRotate: false, autoRotateSpeed: 1 };
    const state = createState({ startEpochMs: Date.UTC(2026, 9, 11, 12, 0, 0) });
    state.perf = { fps: 60 };
    const events = new EventBus();
    const sim = new SpaceWeatherSim(state, events);
    const ctx = { camera, controls, state, events, sim, cameraRig: new CameraRig(camera, controls), layers: {}, textures: {} };

    ctx.actions = {}; // main.js ile aynı sıra: önce boş nesne, createUI, sonra işlevler
    const { createUI } = await import('../src/ui/ui.js');
    createUI(ctx);
    const copyLink = vi.fn();
    const screenshot = vi.fn();
    Object.assign(ctx.actions, { copyLink, screenshot });

    const tb = document.getElementById('topbar');
    tb.querySelector('button[aria-keyshortcuts="P"]').click();
    expect(screenshot).toHaveBeenCalledTimes(1);
    [...tb.querySelectorAll('button')].find((b) => b.textContent === '🔗').click();
    expect(copyLink).toHaveBeenCalledTimes(1);

    const pn = document.getElementById('panel');
    [...pn.querySelectorAll('button')].find((b) => b.textContent.startsWith('🔗')).click();
    [...pn.querySelectorAll('button')].find((b) => b.textContent.startsWith('📷')).click();
    expect(copyLink).toHaveBeenCalledTimes(2);
    expect(screenshot).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    expect(screenshot.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
