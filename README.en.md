[Türkçe](README.md) | **English**

<!-- DOI: Zenodo DOI to be added -->

# 🌍 Manyetik Kalkan (Magnetic Shield) — Earth's Magnetosphere Simulation

An interactive 3D simulation that brings Earth's magnetic shield (the magnetosphere) to life with real physics models.
Trigger solar storms and cosmic rays and adjust their strength; watch how the shield is compressed, how it deflects
particles, how auroras spread, and how it all affects technology.

## Features

**Solar storms**
- Trigger a storm with the strength slider (Weak → Carrington class): X-ray flare → solar energetic particles (SEP) → coronal mass ejection (CME)
- Time automatically speeds up during the CME's journey; when the shock arrives, the magnetopause visibly compresses
- Historic events: **Carrington 1859**, **Québec 1989**, **Halloween 2003**, **Gannon (May) 2024**
- Kp, Dst and NOAA G/S/R scales, substorms, Forbush decrease

**Cosmic rays**
- Background galactic cosmic ray flux and adjustable burst intensity
- Energy/rigidity setting (0.05–100 GV), proton / electron / alpha particle selection
- Particles are actually tracked in the dipole field with a relativistic Boris pusher: low-energy ones are steered toward the poles or turned back, high-energy ones reach the equator and produce air showers in the atmosphere
- Fraction of cosmic rays blocked by the shield (analytic estimate from the galactic spectrum and the Störmer cutoff; 0% if there is no field) and visual particle counters

**Magnetic field**
- Field strength (0–200%), shield switch-off (Mars-like induced magnetosphere, atmospheric loss)
- Pole reversal animation, Laschamp event scenario
- Solar wind speed, density and IMF Bz/By settings

**Visualization**
- Day/night Earth, clouds, atmosphere, seasonal axial tilt, realistic dipole tilt
- Magnetopause (Shue et al. 1998), bow shock, field lines, magnetotail, plasma sheet
- Van Allen belts and the gyration–bounce–drift motion of trapped particles
- Animated aurora curtains; a **"Can the aurora be seen from Istanbul?"** indicator (oval latitude + Sun below the horizon)
- Satellites: ISS, GPS constellation, GEO satellites including Türksat, South Atlantic Anomaly
- Live charts (Dst, Kp, Bz, wind speed), event log, educational info windows

**Language**
- TR/EN switch in the top bar; the default language follows the browser language
- The `?lang=en` / `?lang=tr` URL parameter also selects the language; the choice is saved in localStorage

## Running

Requirement: Node.js 20+

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Use `npm run build` for a production build and `npm test` for the tests.

## Shortcuts

| Key | Action |
|---|---|
| Space | Pause / resume |
| F | Trigger solar storm |
| K | Cosmic ray burst |
| T | Pole reversal |
| 1–7 | Camera presets |
| H | Hide interface |
| L | Toggle labels |
| I | Info |
| Shift+R | Reset |

## Physics models

- Magnetopause: Shue et al. (1998); bow shock: Spreiter / Farris & Russell
- Magnetosheath flow: Rankine half-body (α = 0.5 Shue surface)
- Coupling and Kp: Newell et al. (2007, 2008); Kp 9 is a soft-saturated, compressed approximation
- Ring current (Dst): O'Brien & McPherron (2000)
- Auroral boundary: Starkov (1994) + extreme-storm extension; plasmapause: Carpenter & Anderson (1992)
- Cosmic ray access: Störmer theory, relativistic Boris pusher

**Limitations:** Distances are not to scale (the Sun is actually ~23,500 Re away), time scales are compressed,
and the magnetic field is a dipole + deformation model. Impact estimates such as dose and GPS error are rough approximations for educational purposes.

Earth textures: NASA Blue Marble (via the three.js example textures). If there is no network, a procedural fallback appearance is used.

## Project structure

```
src/
  core/      state, events, simulation engine, coordinate helpers, shared number formatting (Turkish)
  physics/   magnetopause, dipole field, particle pusher, indices, storm profiles
  scene/     Three.js layers (Earth, Sun, magnetosphere, wind, cosmic rays, belts, aurora, satellites)
  ui/        control panel, data panel, charts, log, info window
tests/       physics unit tests and WebGL-free smoke tests
docs/        architecture and module contracts
```

## Citation

If you use this software, please cite it as follows (details: [CITATION.cff](CITATION.cff)):

> Karatum, M. (2026). *Earth Magnetic Shield (Manyetik Kalkan): Interactive 3D Magnetosphere and Space-Weather Simulation* (Version 1.0.0) [Computer software]. Zenodo. DOI: _to be added_

## License

[MIT](LICENSE) © 2026 Mustafa Karatum
