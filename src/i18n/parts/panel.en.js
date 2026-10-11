// panel dictionary part (en) — control panel (#panel): sections, controls, layer names
export default {
  // general
  'panel.help.title': 'About this topic',
  'panel.help.aria': 'About {title}',
  'panel.pct': '{v}%',

  // units (time scale)
  'panel.unit.hourPerSec': 'h/s',
  'panel.unit.minPerSec': 'min/s',
  'panel.unit.sec': 's',
  'panel.unit.min': 'min',

  // season hints (axial tilt)
  'panel.season.northTilt': 'north pole tilted toward the Sun',
  'panel.season.southTilt': 'south pole tilted toward the Sun',
  'panel.season.equinox': 'equinox, axis perpendicular to the Sun',
  'panel.season.northPart': 'north pole partly tilted toward the Sun',
  'panel.season.southPart': 'south pole partly tilted toward the Sun',

  // storm phases
  'panel.phase.transit': 'CME in transit {pct}%',
  'panel.phase.sheath': 'Shock sheath',
  'panel.phase.cloud': 'Magnetic cloud',
  'panel.phase.recovery': 'Recovery',
  'panel.phase.ended': 'Ended',

  // particle names
  'panel.particle.proton': 'Proton',
  'panel.particle.electron': 'Electron',
  'panel.particle.alpha': 'Alpha',

  // 1. Solar storm
  'panel.storm.title': '☀️ Solar Storm',
  'panel.storm.strength': 'Storm strength',
  'panel.storm.preview': '{flare} flare · {v} km/s CME · ~{h} h transit · Expected G{g}, Dst ≈ {dst} nT',
  'panel.storm.trigger': 'Trigger Storm',
  'panel.storm.triggerTitle': 'Launch a solar flare + CME (F)',
  'panel.storm.historicHead': 'Historic events',
  'panel.storm.historic': 'Historic event',
  'panel.storm.replay': 'Replay Event',
  'panel.storm.activeHead': 'Active storms',
  'panel.storm.none': 'No storm is in transit or active right now.',
  'panel.storm.meta': '{flare} flare · {v} km/s · expected G{g}',

  // 2. Cosmic rays
  'panel.cosmic.title': '🌌 Cosmic Rays',
  'panel.cosmic.gcr': 'Galactic cosmic ray flux',
  'panel.cosmic.gcrSub': 'Current relative flux: {pct}% (Forbush decrease during storms)',
  'panel.cosmic.burst': 'Burst intensity',
  'panel.cosmic.burstVal': '{pct}% · ~{n} particles',
  'panel.cosmic.energy': 'Particle energy (rigidity)',
  'panel.cosmic.kinetic': 'Kinetic energy ≈ {e} ({name})',
  'panel.cosmic.particle': 'Particle type',
  'panel.cosmic.hintNoShield': 'No magnetic shield: particles of any energy reach all latitudes freely.',
  'panel.cosmic.hintAll': 'Particles of this rigidity can reach every magnetic latitude, including the equator, along a vertical path (Störmer cutoff).',
  'panel.cosmic.hintLat': 'Particles of this rigidity can reach only magnetic latitudes ≥ {lat}° along a vertical path (Störmer cutoff).',
  'panel.cosmic.fire': 'Cosmic Ray Burst',
  'panel.cosmic.fireTitle': 'Send a burst of the selected particles (K)',

  // 3. Solar wind
  'panel.wind.title': '🌬️ Solar Wind (background)',
  'panel.wind.speed': 'Speed',
  'panel.wind.density': 'Density',
  'panel.wind.effective': 'Effective (storm): {v} {unit}',
  'panel.wind.bzSouth': 'southward (drives storms)',
  'panel.wind.bzNorth': 'northward (quiet)',
  'panel.wind.bzFlat': 'horizontal (no effect)',

  // 4. Magnetic field
  'panel.field.title': '🧲 Magnetic Field',
  'panel.field.strength': 'Field strength',
  'panel.field.moment': 'Dipole moment ≈ {v} × 10²² A·m²',
  'panel.field.shield': 'Shield',
  'panel.field.tilt': 'Realistic dipole tilt (~9.4°)',
  'panel.field.polarity': 'Polarity:',
  'panel.field.polNormal': 'Normal',
  'panel.field.polReversed': 'Reversed',
  'panel.field.reversal': 'Start Pole Reversal',
  'panel.field.reversalTitle': 'The dipole weakens, the pole wanders and flips (T)',
  'panel.field.reversalPct': 'Reversal {pct}%',
  'panel.field.reversalInfo': 'What is a pole reversal?',
  'panel.field.scenarios': 'Scenarios',
  'panel.field.scenarioDefault': 'Apply a ready-made scenario with one click.',

  // 5. Layers
  'panel.layers.title': '👁️ Layers',
  'layer.fieldLines': 'Field lines',
  'layer.magnetopause': 'Magnetopause',
  'layer.bowShock': 'Bow shock',
  'layer.solarWind': 'Solar wind',
  'layer.radiationBelts': 'Van Allen belts',
  'layer.aurora': 'Auroras',
  'layer.cosmicRays': 'Cosmic rays',
  'layer.satellites': 'Satellites',
  'layer.labels': 'Labels',
  'layer.stars': 'Stars',
  'layer.moon': 'Moon',
  'layer.sunEarthLine': 'Sun–Earth line',
  'layer.axes': 'Axes',

  // 6. Camera
  'panel.camera.title': '🎥 Camera',
  'panel.camera.autoRotate': 'Auto-rotate',

  // 7. Time
  'panel.time.title': '⏱️ Time',
  'panel.time.scale': 'Time scale',
  'panel.time.dayAbout': '1 simulation day ≈ {v}',
  'panel.time.warpActive': 'CME in transit, time accelerated: {rate}',
  'panel.time.visual': 'Particle animation speed',
  'panel.time.season': 'Season (day of year)',
  'panel.time.day': 'Day {d}',
  'panel.time.warp': 'Accelerate time during CME transit',
  'panel.time.pauseTitle': 'Pause / resume (Space)',
  'panel.time.pause': '⏸ Pause',
  'panel.time.resume': '▶ Resume',
  'panel.time.reset': '↺ Reset',
  'panel.time.resetTitle': 'Return the simulation to quiet conditions (Shift+R)',

  // footer
  'panel.foot.helpPre': 'Press ',
  'panel.foot.helpPost': ' for help',
  'panel.foot.shortcuts': 'Shortcuts & usage',
};
