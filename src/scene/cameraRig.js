// Kamera önayarları ve yumuşak geçişler.

import * as THREE from 'three';
import { t } from '../i18n/index.js';

// label tembel özelliktir: etkin dile göre her okumada t() ile çözülür
const preset = (key, pos, target) => ({
  get label() {
    return t(`misc.camera.${key}`);
  },
  pos,
  target,
});

export const CAMERA_PRESETS = {
  overview: preset('overview', [26, 15, 38], [-4, 0, 0]),
  sun: preset('sun', [40, 7, 0.01], [0, 0, 0]),
  side: preset('side', [-6, 6, 70], [-12, 0, 0]),
  north: preset('north', [1.2, 4.6, 1.2], [0, 0.8, 0]),
  earth: preset('earth', [5.5, 2.2, 5.5], [0, 0, 0]),
  tail: preset('tail', [-38, 9, 20], [-6, 0, 0]),
  wide: preset('wide', [30, 45, 95], [6, 0, 0]),
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.tween = null;
    this.autoRotate = false;
    this.current = 'overview';
    // Kullanıcı yörüngede döndürüp/yakınlaştırınca kamera önayarı artık geçerli değildir: seçili düğme sönsün
    this._onUserStart = () => {
      this.tween = null;
      this.current = null;
    };
    controls.addEventListener?.('start', this._onUserStart);
  }

  goTo(name, duration = 1.8) {
    const p = CAMERA_PRESETS[name];
    if (!p) return;
    this.current = name;
    this.tween = {
      t: 0,
      duration,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: new THREE.Vector3(...p.pos),
      toTarget: new THREE.Vector3(...p.target),
    };
  }

  setAutoRotate(on) {
    this.autoRotate = on;
    if (on) this.current = null; // dönen görünüm hiçbir önayarla eşleşmez
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.35;
  }

  update(dt) {
    if (!this.tween) return;
    const tw = this.tween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const k = ease(tw.t);
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
    this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
    if (tw.t >= 1) this.tween = null;
  }
}
