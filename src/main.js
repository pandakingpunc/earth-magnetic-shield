// Giriş noktası: oluşturucu, sahne, kamera, katmanlar, arayüz ve ana döngü.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import './style.css';
import { createState } from './core/state.js';
import { EventBus } from './core/events.js';
import { SpaceWeatherSim } from './core/simulation.js';
import { loadTextures } from './scene/textures.js';
import { CameraRig } from './scene/cameraRig.js';
import { declutterLabels } from './scene/labels.js';
import { StarfieldLayer } from './scene/starfield.js';
import { SunLayer } from './scene/sun.js';
import { EarthLayer } from './scene/earth.js';
import { MagnetosphereLayer } from './scene/magnetosphere.js';
import { SolarWindLayer } from './scene/solarWind.js';
import { CosmicRayLayer } from './scene/cosmicRays.js';
import { RadiationBeltLayer } from './scene/radiationBelts.js';
import { AuroraLayer } from './scene/aurora.js';
import { SatelliteLayer } from './scene/satellites.js';
import { createUI } from './ui/ui.js';
import { t, applyDocumentLang } from './i18n/index.js';

const SANITIZE_SHADER = {
  name: 'SanitizeShader',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = min(c, vec4(64.0));
    }
  `,
};

/** index.html Türkçe yedek metin taşır; etkin dile göre sayfa dilini, başlığı, açıklamayı ve yükleme ekranını ayarlar. */
function localizeStaticText() {
  applyDocumentLang(); // <html lang> ve <title>
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  const title = document.querySelector('#loading .loading-title');
  if (title) title.textContent = t('app.title');
  const text = document.getElementById('loading-text');
  if (text) text.textContent = t('misc.loading.init');
}

async function main() {
  const app = document.getElementById('app');
  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loading-text');

  // antialias kapalı: kenar yumuşatma aşağıdaki MSAA'lı EffectComposer hedefinde yapılır; varsayılan çerçeve
  // tamponuna yalnızca OutputPass'in tek tam ekran dörtgeni gider
  const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.id = 'labels';
  app.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 3000);
  if (camera.aspect < 1) {
    camera.fov = Math.min(72, 45 / Math.pow(camera.aspect, 0.6));
    camera.updateProjectionMatrix();
  }
  camera.position.set(26, 15, 38);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.35;
  controls.maxDistance = 320;
  controls.target.set(-4, 0, 0);

  // Sahne, 4× MSAA'lı HDR hedefe çizilir: alan çizgileri ve parçacık izleri tırtıklı görünmez
  const pr = renderer.getPixelRatio();
  const msaaTarget = new THREE.WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr, {
    type: THREE.HalfFloatType,
    samples: pr > 1.5 ? 2 : 4,
  });
  const composer = new EffectComposer(renderer, msaaTarget);
  composer.addPass(new RenderPass(scene, camera));
  // Güvenlik geçişi: herhangi bir gölgelendiricinin ürettiği NaN/sonsuz pikseller bloom bulanıklığıyla tüm ekrana
  // yayılıp görüntüyü karartır. Bloom'dan önce bu pikselleri temizle ve aşırı HDR değerleri kırp.
  composer.addPass(new ShaderPass(SANITIZE_SHADER));
  // Eşik yüksek tutulur: yalnızca gerçekten parlak (HDR) öğeler (Güneş, aurora, parçacık başları) parlar
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const state = createState();
  const events = new EventBus();
  const sim = new SpaceWeatherSim(state, events);

  const textures = await loadTextures(renderer, (done, total) => {
    if (loadingText) loadingText.textContent = t('misc.loading.textures', { done, total });
  });

  const cameraRig = new CameraRig(camera, controls);
  const ctx = { scene, camera, renderer, controls, state, events, sim, textures, cameraRig, bloom };

  // Katmanlar (sıra: arka plandan öne)
  const layers = {
    stars: new StarfieldLayer(ctx),
    sun: new SunLayer(ctx),
    earth: new EarthLayer(ctx),
    magnetosphere: new MagnetosphereLayer(ctx),
    solarWind: new SolarWindLayer(ctx),
    belts: new RadiationBeltLayer(ctx),
    aurora: new AuroraLayer(ctx),
    cosmicRays: new CosmicRayLayer(ctx),
    satellites: new SatelliteLayer(ctx),
  };
  ctx.layers = layers;

  state.perf = { fps: 60 };
  const ui = createUI(ctx);

  // Dar/dikey ekranlarda görüş alanını genişlet ki manyetosfer sığsın
  const fitFov = (aspect) => (aspect < 1 ? Math.min(72, 45 / Math.pow(aspect, 0.6)) : 45);

  let lastW = -1;
  let lastH = -1;
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Gizli sekme/panelde boyut 0 olabilir: sıfır boyutlu çerçeve tamponu oluşturma
    if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
    lastW = w;
    lastH = h;
    camera.aspect = w / h;
    camera.fov = fitFov(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  // Yükleme sırasında kaçırılan boyut değişikliklerini de yakala (dokular yüklenirken pencere değişmiş olabilir)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(document.documentElement);
  onResize();

  // Gizli nesneler (CME, tersinme şeritleri, parlama kabukları…) ilk kullanımda gölgelendirici derleyip kare atlamasın:
  // yükleme ekranı arkasında hepsini bir kez görünür yapıp çiz, sonra eski hâline getir.
  // (Derleme, gerçek karelerle aynı render hedefi/ton eşlemesi için composer üzerinden yapılır.)
  function warmUpShaders() {
    const hidden = [];
    scene.traverse((o) => {
      if (o !== scene && o.visible === false) hidden.push({ o, culled: o.frustumCulled });
    });
    for (const h of hidden) {
      h.o.visible = true;
      h.o.frustumCulled = false;
    }
    try {
      composer.render();
    } catch (err) {
      console.warn('[gölgelendirici ısınması başarısız]', err);
    }
    for (const h of hidden) {
      h.o.visible = false;
      h.o.frustumCulled = h.culled;
    }
  }
  warmUpShaders();

  if (loading) {
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 900);
  }
  sim.alert('info', t('misc.welcome'));

  const timer = new THREE.Timer();
  timer.connect(document); // sekme gizliyken büyük zaman sıçramalarını önler
  let declutterTick = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;

  function frame(timestamp) {
    timer.update(timestamp);
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1); // simülasyon/katmanlar için kırpılmış
    const { simDt, visDt } = sim.update(dt);
    for (const layer of Object.values(layers)) {
      try {
        layer.update(visDt, simDt, dt);
      } catch (err) {
        console.error('[katman güncelleme hatası]', err);
      }
    }
    cameraRig.update(dt);
    controls.update();
    ui.update(dt);
    document.body.classList.toggle('hide-labels', !state.params.layers.labels);
    composer.render();
    labelRenderer.render(scene, camera);
    if (++declutterTick % 6 === 0 && state.params.layers.labels) declutterLabels(labelRenderer.domElement);

    fpsAcc += Math.min(rawDt, 1); // FPS göstergesi kırpılmamış süreyi kullanır (yavaş karelerde 10'a takılmasın)
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      state.perf.fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
  }
  renderer.setAnimationLoop(frame);

  // Geliştirme/hata ayıklama için
  window.__sim = { state, sim, events, layers, scene, camera, renderer, composer, bloom, ui, controls, cameraRig };
}

localizeStaticText();
main().catch((err) => {
  console.error(err);
  const text = document.getElementById('loading-text');
  if (text) text.textContent = t('misc.loading.failed', { message: err.message });
});
