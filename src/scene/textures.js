// Dünya/Ay dokularını yükler. Ağ yoksa veya yükleme başarısız olursa ilgili alan null döner;
// katmanlar bu durumda prosedürel yedek görünüm kullanmalıdır.

import * as THREE from 'three';

// three.js deposundaki NASA kaynaklı gezegen dokuları (sabit sürüm)
const BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets/';

const SOURCES = {
  earthDay: { file: 'earth_atmos_2048.jpg', color: true },
  earthNight: { file: 'earth_lights_2048.png', color: true },
  earthClouds: { file: 'earth_clouds_1024.png', color: false },
  earthSpecular: { file: 'earth_specular_2048.jpg', color: false },
  earthNormal: { file: 'earth_normal_2048.jpg', color: false },
  moon: { file: 'moon_1024.jpg', color: true },
};

const TIMEOUT_MS = 12000;

function loadOne(loader, url) {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.warn('[doku] zaman aşımı:', url);
        resolve(null);
      }
    }, TIMEOUT_MS);
    loader.load(
      url,
      (tex) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(tex);
      },
      undefined,
      () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        console.warn('[doku] yüklenemedi, prosedürel yedek kullanılacak:', url);
        resolve(null);
      },
    );
  });
}

/**
 * @returns {Promise<{earthDay:THREE.Texture|null, earthNight:THREE.Texture|null, earthClouds:THREE.Texture|null,
 *   earthSpecular:THREE.Texture|null, earthNormal:THREE.Texture|null, moon:THREE.Texture|null}>}
 */
export async function loadTextures(renderer, onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const keys = Object.keys(SOURCES);
  let done = 0;
  onProgress(0, keys.length);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const results = await Promise.all(
    keys.map(async (key) => {
      const src = SOURCES[key];
      const tex = await loadOne(loader, BASE + src.file);
      done++;
      onProgress(done, keys.length);
      if (tex) {
        tex.colorSpace = src.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = Math.min(8, maxAniso);
      }
      return [key, tex];
    }),
  );
  return Object.fromEntries(results);
}
