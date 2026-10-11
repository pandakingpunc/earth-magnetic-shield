// İngilizce sözlük — düz, ad alanlı anahtarlar.
// Konu başına parça dosyalarından birleştirilir.
import core from './parts/core.en.js';
import info from './parts/info.en.js';
import sim from './parts/sim.en.js';
import hud from './parts/hud.en.js';
import panel from './parts/panel.en.js';
import sceneA from './parts/sceneA.en.js';
import sceneB from './parts/sceneB.en.js';
import misc from './parts/misc.en.js';

export default { ...core, ...info, ...sim, ...hud, ...panel, ...sceneA, ...sceneB, ...misc };
