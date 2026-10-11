// Türkçe sözlük — düz, ad alanlı anahtarlar.
// Konu başına parça dosyalarından birleştirilir.
import core from './parts/core.tr.js';
import info from './parts/info.tr.js';
import sim from './parts/sim.tr.js';
import hud from './parts/hud.tr.js';
import panel from './parts/panel.tr.js';
import sceneA from './parts/sceneA.tr.js';
import sceneB from './parts/sceneB.tr.js';
import misc from './parts/misc.tr.js';

export default { ...core, ...info, ...sim, ...hud, ...panel, ...sceneA, ...sceneB, ...misc };
