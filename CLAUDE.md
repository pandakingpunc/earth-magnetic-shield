# Manyetik Kalkan — Claude Code proje notları

Dünya'nın manyetik kalkanının (manyetosfer) etkileşimli 3B simülasyonu. Güneş fırtınası / kozmik ışın tetikleme,
güç ayarları, Van Allen kuşakları, auroralar, uydular, kutup tersinmesi, tarihî fırtına önayarları.

**Sıradaki işler `docs/HANDOFF.md` dosyasında.** Yeni bir oturumda önce onu oku ve görevleri sırayla yap.

## Kullanıcı hakkında

- Kullanıcı Türkçe konuşur; ona Türkçe yanıt ver.
- Alt ajanlar (Agent aracı / Workflow `agent()`) **Sonnet 5.5** ile çalıştırılmalı (`model: 'sonnet'`). Kullanıcının açık isteği.
- Belirsiz bir karar varsa (ör. depo adı, yazar adı) kullanıcıya **sor**; tahmin edip dışa dönük işlem yapma.

## Komutlar

```bash
npm install          # bağımlılıklar
npm run dev          # geliştirme sunucusu (http://localhost:5173)
npm test             # vitest: fizik + duman (WebGL'siz, happy-dom) + düzeltme testleri — hepsi geçmeli
npm run build        # üretim derlemesi (dist/)
```

Her değişiklikten sonra `npm test` ve `npm run build` çalıştır. Gölgelendirici (GLSL) hataları testlerde
yakalanmaz; mümkünse tarayıcıda konsolu kontrol et.

## Mimari (ayrıntı: `docs/ARCHITECTURE.md`)

- Vite 8 + Three.js 0.186.1, saf JavaScript ES modülleri (TypeScript yok). Yeni bağımlılığı gerekmedikçe ekleme.
- `src/core/` — `state.js` (tek doğruluk kaynağı), `simulation.js` (uzay havası motoru, tetikleyiciler, uyarılar),
  `events.js`, `geo.js` (koordinatlar), `format.js` (sayı biçimi), `constants.js`.
- `src/physics/` — manyetopoz (Shue 1998), dipol alanı, göreli Boris parçacık itici, Kp/Dst/NOAA ölçekleri,
  fırtına profilleri ve tarihî önayarlar. Testli; formülleri değiştirirken testleri güncelle.
- `src/scene/` — Three.js katmanları (her biri `constructor(ctx)`, `update(visDt, simDt, realDt)`, `dispose()`),
  görünürlüğü `state.params.layers` bayraklarından kendisi ayarlar.
- `src/ui/` — üst çubuk, kontrol paneli, HUD, grafikler, günlük/bildirimler, bilgi penceresi, kısayollar.
- `src/main.js` — oluşturucu, EffectComposer (4× MSAA HalfFloat hedef → NaN temizleme geçişi → bloom → çıkış),
  ana döngü, etiket çakışma önleyici. `window.__sim` hata ayıklama nesnesidir.
- Koordinatlar: 1 birim = 1 Dünya yarıçapı; +X Güneş'e doğru, +Y ekliptik kuzeyi, +Z şafak tarafı.

## Kurallar ve tuzaklar

- Kod stili: 2 boşluk, tek tırnak, noktalı virgül, kısa Türkçe yorumlar (çevredeki kodla uyumlu).
- Katmanlar state'i yalnızca okur; eylemler `ctx.sim.*` tetikleyicileriyle yapılır.
- Sıcak döngülerde kare başına bellek ayırma yapma.
- GLSL: ara değerlerle (varying) `exp`/`pow`/bölme yapıyorsan önce `clamp` et. MSAA altında parça gölgelendirici
  üçgen dışındaki örnek noktalarında da çalışır, değer taşarsa sonsuz üretir. (Aurora'da bu yüzden ekran kararıyordu.)
  `main.js` içindeki NaN temizleme geçişini kaldırma.
- Bloom eşiği 0.6; yalnızca HDR parlak öğeler parlar. Yeni parlak efektleri buna göre ayarla.
- Arayüz iki dillidir (TR/EN): kullanıcıya görünen her metin `t()` ile `src/i18n/parts/*.{tr,en}.js` sözlüklerinden gelir.
  Yeni metin eklerken iki dile de anahtar ekle; `tests/i18n.test.js` eksik anahtarı ve İngilizce arayüzde kalan Türkçe'yi yakalar.
  Durum kodları dilden bağımsızdır (ör. `turkeyAurora`: 'none' | 'horizon' | 'visible' | 'overhead').

## Git

- Depo: https://github.com/pandakingpunc/earth-magnetic-shield (açık, `main` dalı). Lisans: MIT © 2026 Mustafa Karatum.
- Zenodo yayını GitHub entegrasyonuyla yapılır (`.zenodo.json`, `CITATION.cff`). DOI'yi bekleme; kullanıcı DOI'yi kendisi
  alıp verecek, sonra `docs/HANDOFF.md` Görev 4'ü uygula.
