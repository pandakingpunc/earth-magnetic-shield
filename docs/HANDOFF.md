# Devir: sıradaki görevler

**Durum (11 Ekim 2026):** Dört görevin tamamı bitti. Zenodo DOI: [10.5281/zenodo.23297412](https://doi.org/10.5281/zenodo.23297412).

Bu dosya, projeye yeni bir Claude Code oturumunda devam etmek içindir. Görevleri **sırayla** yap. Her görev
bitince kullanıcıya kısa bir Türkçe özet ver ve bir sonrakine geç.

Başlamadan önce: `CLAUDE.md` ve `docs/ARCHITECTURE.md` dosyalarını oku. Ardından `npm install`, `npm test` ve
`npm run build` çalıştır; başlangıçta her şey yeşil olmalı (65 test).

---

## Görev 1 — İngilizce dil modu (TR / EN)

Amaç: Arayüzün tamamı Türkçe ve İngilizce kullanılabilsin. Varsayılan dil tarayıcı diline göre seçilsin
(`tr*` → Türkçe, diğerleri → İngilizce). Kullanıcı üst çubuktaki **TR | EN** düğmesiyle dili değiştirebilsin.

### Tasarım

1. `src/i18n/index.js`:
   - `t(key, params)`: `{name}` biçimindeki yer tutucuları doldurur. Eksik anahtarda anahtarın kendisini döndürür
     ve geliştirmede `console.warn` yazar.
   - `getLang()`, `setLang(lang)` ve `LANGS`.
   - Dil seçim sırası: URL `?lang=tr|en` → `localStorage['lang']` → `navigator.language`.
   - `setLang` değeri kaydeder ve sayfayı yeniden yükler. Bu en sağlam yol; canlı yeniden çizim gerekmez.
   - `document.documentElement.lang` değerini ve sayfa başlığını ayarlar.
2. `src/i18n/tr.js` ve `src/i18n/en.js`: düz, ad alanlı anahtarlar, ör. `panel.storm.title`,
   `alert.flare`, `hud.kp.title`, `scene.label.magnetopause`, `info.magnetosphere.body`.
3. `src/core/format.js` dile duyarlı olsun:
   - TR: ondalık virgül, ince boşlukla binlik ayracı.
   - EN: ondalık nokta, virgülle binlik ayracı.
   - Gerçek eksi işareti (−) iki dilde de kalsın.
   - Tarih ve ay adları da dile göre olsun.
4. Dil bağımsız durum kodları:
   - `state.derived.turkeyAurora` → `'none' | 'horizon' | 'visible' | 'overhead'`.
   - Bunu kullanan tüm yerleri güncelle: `physics/indices.js` `auroraVisibility`, `core/simulation.js`,
     `scene/aurora.js` (`GLOW_BY_STATUS`), `ui/hud.js` ve testler.
   - Görünen metin `t()` ile gelsin. Durumda saklanan başka Türkçe kod varsa onları da dönüştür.
5. Çevrilecek yerler (Türkçe karakter sayısına göre en yoğundan aza):
   - Arayüz ve uyarılar: `ui/info.js` (9 bilgi konusunun tamamı, düzgün ve bilimsel doğrulukta İngilizce),
     `ui/hud.js`, `core/simulation.js` (tüm uyarı metinleri ve `SCENARIOS`), `ui/panel.js`.
   - Sahne etiketleri: `scene/*.js`.
   - Fizik tarafındaki görünen metinler: `physics/indices.js` (`SCALE_LABELS`, `riskLabel`),
     `physics/stormProfile.js` (`STORM_PRESETS` adları/açıklamaları, `strengthLabel`),
     `physics/dipole.js` (`PARTICLES` etiketleri).
   - Diğer UI dosyaları: `ui/charts.js`, `ui/log.js`, `ui/topbar.js`, `scene/cameraRig.js`
     (`CAMERA_PRESETS` etiketleri).
   - Yükleme ekranı: `index.html` ve `main.js`.
   - Katman adları: panel.
   - Özel adlar aynen kalır: İstanbul, Türksat, Québec, Carrington, Gannon vb.
   - "İstanbul'dan aurora" göstergesi iki dilde de kalır (EN: "Aurora from Istanbul").
6. Üst çubuğa **TR | EN** anahtarı ekle:
   - Erişilebilir olsun (`aria-pressed`).
   - Mobil düzende (≤420 px) saati taşırmasın.
7. Kod yorumları Türkçe kalabilir. Yalnızca kullanıcıya görünen metinler çevrilecek.

### Kabul ölçütleri

- Yeni test `tests/i18n.test.js`:
  - `tr` ve `en` sözlüklerinde aynı anahtar kümesi olmalı.
  - Boş değer olmamalı.
  - Yer tutucular (`{x}`) iki dilde eşleşmeli.
- Yeni duman testi: arayüz happy-dom altında `lang=en` ile kurulsun. Tüm düğmelere tıklandıktan ve senaryolar
  çalıştıktan sonra `document.body.textContent` içinde Türkçe'ye özgü harf (`çğıöşüÇĞİÖŞÜ`) **kalmamalı**.
  İzin listesi: özel adlar (İstanbul, Türksat, Québec…).
- `npm test` (tümü) ve `npm run build` geçmeli.
- Mümkünse tarayıcıda iki dili de aç:
  - Konsolda hata olmamalı.
  - Uzun İngilizce metinler panellerde taşmamalı.
- README:
  - `README.md` Türkçe kalsın.
  - Aynı içerikte `README.en.md` ekle.
  - İkisinin başına karşılıklı dil bağlantısı koy.

---

## Görev 2 — Git deposu + GitHub'a push (MIT lisansı)

Kullanıcı bu adımı açıkça istedi. Durum: `gh` CLI, `pandakingpunc` hesabıyla giriş yapmış. Git kullanıcı adı
`pandakingpunc`.

1. **Kullanıcıya tek seferde sor:**
   - LICENSE / CITATION / Zenodo'da görünecek tam ad (varsayılan: `pandakingpunc`).
   - Depo adı (öneri: `manyetik-kalkan`).
   - Depo herkese açık olacak, çünkü Zenodo yalnızca açık depoları arşivler. Bunu kullanıcıya belirt.
2. `LICENSE` (MIT, `Copyright (c) 2026 <ad>`) ekle.
3. `package.json` güncelle:
   - `"license": "MIT"`, `"author"`, `"repository"`, `"homepage"`.
   - `"version": "1.0.0"`.
4. `.gitignore` kontrolü:
   - Mevcut: `node_modules/`, `dist/`.
   - Ekle: `.claude/settings.local.json`.
   - Sır veya büyük dosya commit'lenmesin.
5. `git init -b main` → tüm dosyaları ekle → ilk commit.
6. `gh repo create <ad> --public --source . --push --description "<kısa açıklama>"`.
7. Depo konusu etiketleri: `gh repo edit --add-topic` ile `magnetosphere`, `space-weather`, `threejs`,
   `simulation`, `solar-storm`, `cosmic-rays`, `education`.

---

## Görev 3 — Zenodo yayını (DOI'yi BEKLEME)

Zenodo, GitHub entegrasyonuyla çalışır: depo Zenodo'da etkinleştirildikten **sonra** oluşturulan her GitHub
release'i otomatik arşivlenir ve DOI alır.

1. Kullanıcıdan şunu yapmasını iste ve onay bekle. Zenodo girişi kullanıcının hesabıdır, sen yapamazsın:
   1. https://zenodo.org adresine GitHub ile giriş.
   2. Account → GitHub sekmesi.
   3. "Sync now".
   4. `<ad>` deposunun anahtarını **ON** yap.
2. Kökte `.zenodo.json` oluştur:
   - `title`: "Manyetik Kalkan: Interactive 3D Earth Magnetosphere Simulation".
   - `description`: İngilizce, birkaç paragraf.
   - `upload_type: "software"`, `license: "MIT"`.
   - `creators`: `[{ "name": "<Soyad, Ad>" }]`.
   - `keywords`, `language: "eng"`, `version: "1.0.0"`.
   - İsteğe bağlı `related_identifiers`: GitHub deposu.
3. `CITATION.cff` (cff-version 1.2.0):
   - Alanlar: başlık, yazar, `version: 1.0.0`, `date-released`, `license: MIT`, `repository-code`.
   - **DOI alanını koyma**; yerine `# doi: 10.5281/zenodo.XXXXXXX  (Zenodo DOI eklenecek)` yorum satırı bırak.
4. README dosyaları:
   - `README.md` ve `README.en.md` başına DOI rozeti için yer tutucu yorum ekle:
     `<!-- DOI: Zenodo DOI'si eklenecek -->`.
   - "Atıf / Citation" bölümü ekle.
5. Commit + push.
6. Sürüm etiketi ve release:
   ```bash
   gh release create v1.0.0 --title "v1.0.0" --notes "<Türkçe + İngilizce sürüm notları>"
   ```
7. **Zenodo'yu yoklama, DOI'yi bekleme.** Kullanıcıya şunu söyle:
   - Release oluşturuldu.
   - Birkaç dakika içinde Zenodo → Upload sayfasında DOI görünecek.
   - DOI'yi alınca sana yapıştırması yeterli.

---

## Görev 4 — Kullanıcı DOI'yi verince

Kullanıcı `10.5281/zenodo.NNNNNNN` biçiminde bir DOI yapıştırdığında:

1. `CITATION.cff` içinde yorum satırını gerçek `doi: 10.5281/zenodo.NNNNNNN` alanıyla değiştir.
2. `README.md` ve `README.en.md` içindeki yer tutucu yorumu rozetle değiştir:
   ```markdown
   [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.NNNNNNN.svg)](https://doi.org/10.5281/zenodo.NNNNNNN)
   ```
   Atıf bölümüne DOI'yi ekle.
3. Commit + push. Yeni release gerekmez.
   - Not: Zenodo'nun "concept DOI"su tüm sürümleri, sürüm DOI'si yalnız v1.0.0'ı gösterir.
   - Kullanıcı hangisini verirse onu kullan.

---

## Durum özeti (devir anı)

- 65/65 test geçiyor, derleme temiz, tarayıcı konsolunda hata yok.
- Son yapılan önemli düzeltmeler:
  - MSAA + aurora gölgelendiricisi kaynaklı ekran kararması giderildi.
  - Bloom'dan önce NaN temizleme geçişi eklendi.
  - Sıfır boyutla açılma hatası giderildi.
  - Eşzamanlı fırtına sınırı (6) eklendi.
- Bilinen bilinçli sınırlamalar: ölçeksiz uzaklıklar, sıkıştırılmış zaman, Kp'nin 9'da yumuşak doyumu, etki
  tahminlerinin (doz, GPS hatası…) eğitsel/kaba olması. README'de ve bilgi penceresinde yazıyor.
