// misc dictionary part (en): top bar, shortcuts, camera, loading screen.
// Physics labels (NOAA scales, risk, Dst class, particle names, historical presets) live in the sim part.
export default {
  // Top bar
  'misc.topbar.subtitle': 'Earth’s magnetosphere simulation',
  'misc.topbar.clockTitle': 'Simulation clock (UTC)',
  'misc.topbar.clock': '{dm}, {y} · {time} UT',
  'misc.topbar.ff': '⏩ CME in transit · time ×{n}',
  'misc.topbar.scale.g': 'Geomagnetic storm',
  'misc.topbar.scale.s': 'Solar radiation storm',
  'misc.topbar.scale.r': 'Radio blackout',
  'misc.topbar.pause': 'Pause',
  'misc.topbar.resume': 'Resume',
  'misc.topbar.pauseTitle': 'Pause (Space)',
  'misc.topbar.resumeTitle': 'Resume (Space)',
  'misc.topbar.pauseAria': 'Pause',
  'misc.topbar.resumeAria': 'Resume',
  'misc.topbar.resetTitle': 'Reset simulation (Shift+R)',
  'misc.topbar.resetAria': 'Reset simulation',
  'misc.topbar.hideTitle': 'Hide / show interface (H)',
  'misc.topbar.hideAria': 'Hide or show the interface',
  'misc.topbar.infoTitle': 'Info and help (I)',
  'misc.topbar.infoAria': 'Info and help',
  'misc.topbar.fpsTitle': 'Frames per second',
  'misc.topbar.drawer.panel': 'Controls',
  'misc.topbar.drawer.hud': 'Data',
  'misc.topbar.drawer.log': 'Log',

  // Region labels (accessibility)
  'misc.a11y.panel': 'Control panel',
  'misc.a11y.hud': 'Space weather data',

  // Camera presets
  'misc.camera.overview': 'Overview',
  'misc.camera.sun': 'From the Sun',
  'misc.camera.side': 'Side (Tail)',
  'misc.camera.north': 'North Pole',
  'misc.camera.earth': 'Near Earth',
  'misc.camera.tail': 'Night Side',
  'misc.camera.wide': 'Wide View',

  // Loading screen and startup
  'misc.loading.init': 'Starting…',
  'misc.loading.textures': 'Loading textures… {done}/{total}',
  'misc.loading.failed': 'Could not start: {message}. Does your browser support WebGL?',
  'misc.welcome': '🌍 Simulation started. Use the left panel to trigger a solar storm or a cosmic ray burst.',

  // Quality, share, screenshot, accessibility, context loss
  'misc.quality.title': 'Graphics quality',
  'misc.quality.auto': 'Auto',
  'misc.quality.autoEff': 'Auto ({level})',
  'misc.quality.high': 'High',
  'misc.quality.medium': 'Medium',
  'misc.quality.low': 'Low',
  'misc.quality.changed': 'Graphics quality set to {level} to keep the frame rate smooth.',
  'misc.quality.raised': 'Graphics quality raised to {level}.',
  'misc.topbar.copyLinkTitle': 'Copy a link to this view',
  'misc.topbar.copyLinkAria': 'Copy shareable link',
  'misc.topbar.shotTitle': 'Save screenshot (P)',
  'misc.topbar.shotAria': 'Save screenshot',
  'misc.share.copied': 'Link copied to the clipboard.',
  'misc.share.copyFailed': 'Could not copy the link automatically: {url}',
  'misc.shot.saved': 'Screenshot saved: {name}',
  'misc.shot.failed': 'Could not capture a screenshot.',
  'misc.a11y.canvas': 'Interactive 3D view of Earth’s magnetosphere. Arrow keys move the view; scroll or pinch to zoom.',
  'misc.gl.lost': 'Graphics context lost — reload the page to continue.',
  'misc.gl.reload': 'Reload',
};
