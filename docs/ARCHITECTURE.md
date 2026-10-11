# Mimari ve Modül Sözleşmeleri

Bu belge, projedeki modüllerin birbirleriyle nasıl konuştuğunu tanımlar. Yeni kod yazmadan önce oku.

## Teknoloji

- Vite + Three.js `0.186.1` (yalnızca `three` ve `three/addons/...`). **Yeni bağımlılık ekleme.**
- Saf JavaScript ES modülleri (TypeScript yok). 2 boşluk girinti, tek tırnak, noktalı virgül.
- Kullanıcıya görünen tüm metinler **Türkçe**. Kod yorumları Türkçe, kısa.
- Testler: `npm test` (vitest, `tests/`). Derleme: `npx vite build`.

## Birimler ve koordinatlar

- 1 sahne birimi = 1 Dünya yarıçapı (Re = 6371 km). Dünya orijinde, yarıçapı 1.
- GSE benzeri eksenler: **+X Güneş'e doğru**, **+Y ekliptik kuzeyi**, **+Z şafak (dawn)** tarafı. Gece tarafı / manyetokuyruk −X'tedir.
- Güneş görsel olarak `(SUN_SCENE_DISTANCE=48, 0, 0)` konumunda, yarıçapı `SUN_VISUAL_RADIUS=4.2` (ölçeksiz).
- Dünya'nın gövde yönelimi `state.frame.earthQuaternion` (eksen eğikliği + günlük dönüş). Dünya-yerel koordinatlar three.js `SphereGeometry` + eşdikdörtgen doku ile uyumludur: boylam 0 → yerel +X, boylam −90° → yerel +Z, kuzey → yerel +Y. Dönüşümler `src/core/geo.js` içinde (`latLonToLocal`, `localToWorld`, `magneticBasis`, `magneticToWorld`, `magneticLatitudeDeg`).
- `state.frame.dipoleAxis`: sahne koordinatlarında **kuzey jeomanyetik kutup** yönü (birim vektör, dünya ile döner, ~9.4° eğik). Tersinme sırasında gezinir.
- `state.frame.spinAxis`: dönme ekseni (mevsime göre Güneş'e eğilir).

## İki zaman tabanı

`sim.update(realDt)` → `{ simDt, visDt }`. Her katman `update(visDt, simDt, realDt)` alır.

- **simDt (saat)**: fiziksel simülasyon zamanı. Dünya'nın dönüşü, fırtına evreleri, Dst, yörüngeler (uydular `state.time.simHours`'tan konum hesaplar).
- **visDt (görsel saniye)**: parçacık animasyonları için. Duraklatılınca 0; `state.time.visualSpeed` ile ölçeklenir. Güneş rüzgârı gerçek hızla gösterilemeyeceği için görsel hız fiziksel hızla **orantılıdır** (`VISUAL.solarWindRePerSecAt400 * v/400`).
- **realDt**: duraklatmadan bağımsız gerçek kare süresi (ör. parıltı/titreşim gibi her zaman canlı efektler için; isteğe bağlı).

CME Güneş'ten Dünya'ya giderken (`storm.arrived === false`) simülasyon zamanı otomatik hızlanır (`state.time.fastForward`), böylece gerçek 1–3 günlük yolculuk ~4–10 saniyede görünür ve tüm zaman ölçekleri tutarlı kalır.

## Katman sözleşmesi (`src/scene/*.js`)

```js
export class XLayer {
  constructor(ctx) { /* nesneleri oluştur, this.group'u ctx.scene'e ekle */ }
  update(visDt, simDt, realDt) { /* ctx.state'i oku, görseli güncelle */ }
  dispose() { /* geometri/malzeme/doku serbest bırak, sahneden çıkar */ }
}
```

`ctx` içeriği: `{ scene, camera, renderer, controls, state, events, sim, textures, cameraRig, bloom, layers }`
(`layers` tüm katmanlar oluşturulduktan sonra eklenir).

Kurallar:
- Katman **kendi görünürlüğünü** `state.params.layers.<bayrak>` okuyarak her karede ayarlar.
- State'i **yalnızca okur**. Fiziksel durumu değiştirme; tetikleyiciler `ctx.sim` metotlarıdır. (İstisna: `cosmic:impact` / `cosmic:escaped` olaylarını yaymak.)
- Her karede bellek ayırma yapma (Vector3 vb. önceden ayır). Parçacıklar için `BufferGeometry` + `setDrawRange`/`needsUpdate`.
- Parlama (bloom) aktiftir: parlak/eklemeli (additive) malzemeler doğal olarak parlar. Saydam kabuklarda `depthWrite: false`.
- Etiketler için `src/scene/labels.js` → `makeLabel(text, variant)` (CSS2D). `labels` bayrağı genel olarak `body.hide-labels` ile yönetilir.
- Dokular `ctx.textures.*` (ağ yoksa `null` olabilir → prosedürel yedek zorunlu).
- Performans hedefi: tüm sahne orta seviye bir dizüstünde 60 FPS. Katman başına CPU bütçesi ~1–2 ms/kare.

| Katman | Dosya | Bayraklar |
|---|---|---|
| Yıldızlar | `starfield.js` | `stars` |
| Güneş + ışık | `sun.js` | (her zaman), `sunEarthLine` |
| Dünya + atmosfer + Ay + eksenler | `earth.js` | `moon`, `axes` |
| Manyetosfer (alan çizgileri, manyetopoz, yay şoku) | `magnetosphere.js` | `fieldLines`, `magnetopause`, `bowShock` |
| Güneş rüzgârı + CME | `solarWind.js` | `solarWind` |
| Van Allen kuşakları | `radiationBelts.js` | `radiationBelts` |
| Auroralar | `aurora.js` | `aurora` |
| Kozmik ışınlar + SEP | `cosmicRays.js` | `cosmicRays` |
| Uydular | `satellites.js` | `satellites` |

## Arayüz sözleşmesi (`src/ui/*.js`)

`src/ui/ui.js` her bileşeni `createX(uiCtx)` ile oluşturur ve her karede `update(dt)` çağırır.
`uiCtx = { ...ctx, ui: { toggleHidden(), openInfo(topic) } }`.

| Bileşen | Dosya | Kapsayıcı | Stil dosyası |
|---|---|---|---|
| Üst çubuk (başlık, saat, G/S/R rozetleri, oynat/duraklat) | `topbar.js` | `#topbar` | `panel.css` |
| Kontrol paneli | `panel.js` | `#panel` | `panel.css` |
| Bilgi penceresi | `info.js` (`open(topic)`) | `#info-modal` | `panel.css` |
| Klavye kısayolları | `shortcuts.js` (`setupShortcuts(uiCtx)`) | — | — |
| Veri paneli (HUD) | `hud.js` | `#hud` | `hud.css` |
| Grafikler | `charts.js` | `#charts` | `hud.css` |
| Olay günlüğü + bildirimler | `log.js` | `#log`, `#toasts` | `hud.css` |

Genel düzen ve tasarım belirteçleri (`--panel-bg`, `--accent`, `.glass` …) `src/style.css` içindedir; bileşenler kendi CSS dosyalarını JS içinden `import './panel.css'` ile yükler. Arayüz `state.params`'a yazabilir ve `ctx.sim` tetikleyicilerini çağırır.

## Durum (`src/core/state.js`)

Tam şekil için dosyaya bak. Önemli alanlar:

- `state.params` — kullanıcı ayarları (güneş rüzgârı, alan gücü, fırtına gücü, kozmik ayarlar, katman bayrakları).
- `state.sw` — etkin güneş rüzgârı: `speed` (km/s), `density` (cm⁻³), `by`, `bz`, `bt` (nT), `pdyn` (nPa), `mach`.
- `state.derived` — `r0`, `alpha` (manyetopoz), `rbs` (yay şoku burnu), `dipoleMoment` (işaretli), `quadrupole`, `shieldStrength`, `kp`, `dst`, `g/s/r`, `xrayFlux`, `flareClass`, `sepPfu`, `gcrRelative`, `auroraLat`, `auroraWidth`, `auroraIntensity`, `turkeyAurora` (yalnızca enlem), `istanbulMagLat` (canlı dipol ekseninden, mutlak), `istanbulSunElevDeg`, `turkeyDark` (Güneş < −12°), `plasmapauseL`, `belts{inner,outer,slot}`, `reconnection{dayside,nightside}`, `impacts{issDose, flightDose, groundDose, gpsError, dragFactor, gridRisk, geoExposed}`, `atmosphericEscape`, `dipoleTiltDeg`.
- `state.frame` — `earthQuaternion`, `spinAxis`, `dipoleAxis`, `utHours`, `dayOfYear`.
- `state.storms[]` — aktif fırtınalar: `phase` ('transit'|'sheath'|'cloud'|'recovery'), `transitProgress` (0..1), `arrived`, `vPeak`, `strength`, `flareClass` …
- `state.reversal` — `{ active, progress }`.
- `state.history` — 0.25 saatlik örnekler: `t, kp, dst, bz, speed, density, r0, sep, gcr` (son 96 saat).
- `state.log[]` — `{ simHours, level, text }`.
- `state.cosmic.stats` — `{ spawned, impacts, escaped, polarImpacts, equatorialImpacts }` (kozmik katman `spawned`'ı artırır).
- `state.time` — `simHours`, `timeScale`, `visualSpeed`, `paused`, `fastForward`, `effectiveRate`, `startEpochMs`.
- `state.perf.fps`.

## Simülasyon tetikleyicileri (`ctx.sim`)

- `triggerSolarStorm({ strength?, presetId? })`
- `triggerCosmicBurst({ intensity?, rigidityGV?, particle?, direction? })`
- `startPoleReversal()`, `setFieldStrength(f)`, `setDayOfYear(doy)`
- `applyPreset(id)` — fırtına önayarları (`STORM_PRESETS`: `carrington1859`, `quebec1989`, `halloween2003`, `gannon2024`) ve senaryolar (`SCENARIOS`: `quiet`, `highSpeedStream`, `noShield`, `laschamp`, `reversal`)
- `reset()`, `alert(level, text, group?)` — `group` ('sep' | 'g' | 'dst') aynı kategorideki art arda yükselmelerin arayüzde tek bildirimde birleşmesini sağlar (günlük hepsini tutar)
- Duraklatılmışken de her kare `_substep(0)` çalışır: kaydırıcı, önayar ve sıfırlama etkisi türetilmiş değerlere/HUD’a hemen yansır (zaman ilerlemez, çağrı tekrarlanabilirdir)

## Olaylar (`ctx.events`)

`src/core/events.js` başındaki listeye bak: `flare`, `storm:launched`, `storm:arrived`, `storm:ended`, `sep:onset`, `cosmic:burst`, `cosmic:impact`, `cosmic:escaped`, `reversal:start`, `reversal:end`, `preset:applied`, `alert`, `camera:preset`, `sim:reset`.

## Ortak biçimlendirme (`src/core/format.js`)

Kullanıcıya görünen tüm sayılar (HUD, grafikler, uyarı metinleri, sahne etiketleri) buradaki `nf`, `nfs`, `nfSigned`, `nint` ile yazılır: ondalık **virgül**, gerçek eksi (−), −0 yok, binlik ayırıcı ince boşluk. `toFixed` çıktısını doğrudan kullanıcıya gösterme. `ui/panel.js` bunları yeniden dışa aktarır.

## Fizik kütüphanesi (`src/physics/`)

- `magnetopause.js`: `dynamicPressure`, `shueParams`, `magnetopauseRadius(θ, r0, α)`, `insideMagnetopause`, `magnetosonicMach`, `bowShockStandoff`, `bowShockRadius(θ, rbs)`, `insideBowShock`, `sheathVelocity(out, x, y, z, d, U)` (Rankine yarı-cismi akışı, −X yönünde).
- `dipole.js`: `dipoleField`, `quadrupoleField`, `magneticField(out, x, y, z, model)`, `fieldModelFromState(state, model?)`, `dipoleLinePoint(L, lat)`, `invariantLatitude(L)`, `stormerCutoffGV`, `minLatitudeForRigidity`, `rigidityToKineticGeV`, `kineticGeVToRigidity`, `PARTICLES`, `traceFieldLine(start, model, opts)`.
- `particles.js`: `borisStep`, `adaptiveStep`, `advanceParticle(p, distance, model, opts)` — yol uzunluğu parametreli göreli Boris itici (`p = {pos, dir, rigidity, charge}`).
- `indices.js`: Kp, Dst, aurora, NOAA ölçekleri (G5 yalnızca Kp ≈ 9), `impactEstimates`, `riskLabel`, `SCALE_LABELS`; Dst sınıfları için tek tablo `DST_THRESHOLDS` + `dstClass` (HUD, bilgi tablosu ve uyarılar kullanır); `cosmicBlockedFraction(M)` kalkanın engellediği galaktik kozmik ışın oranının analitik tahmini (parçacık sayaçlarından türetilmez).
- `stormProfile.js`: `STORM_PRESETS` (bsPeak’ler gözlenen Dst’yi üretecek biçimde ayarlı), `stormParamsFromStrength`, `predictStormOutcome` (simülasyonla aynı Dst*/Kp modeli üzerinden zaman tümlevi), `strengthLabel` (beklenen G düzeyinden), `createStorm`, zaman profilleri.
