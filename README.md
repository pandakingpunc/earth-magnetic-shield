**Türkçe** | [English](README.en.md)

<!-- DOI: Zenodo DOI'si eklenecek -->

# 🌍 Manyetik Kalkan — Dünya'nın Manyetosfer Simülasyonu

Dünya'nın manyetik kalkanını (manyetosfer) gerçek fizik modelleriyle canlandıran etkileşimli 3B simülasyon.
Güneş fırtınası ve kozmik ışın tetikleyip güçlerini ayarlayabilir; kalkanın nasıl sıkıştığını, parçacıkları
nasıl saptırdığını, auroraların nasıl yayıldığını ve teknolojiye etkilerini izleyebilirsin.

## Özellikler

**Güneş fırtınaları**
- Güç kaydırıcısıyla (Zayıf → Carrington sınıfı) fırtına tetikleme: X-ışını patlaması → güneş enerjik parçacıkları (SEP) → koronal kütle atımı (CME)
- CME yolculuğu sırasında zaman otomatik hızlanır; şok varışında manyetopoz gözle görülür biçimde sıkışır
- Tarihî olaylar: **Carrington 1859**, **Québec 1989**, **Cadılar Bayramı 2003**, **Gannon (Mayıs) 2024**
- Kp, Dst ve NOAA G/S/R ölçekleri, alt fırtınalar (substorm), Forbush azalması

**Kozmik ışınlar**
- Arka plan galaktik kozmik ışın akısı ve patlama yoğunluğu ayarı
- Enerji/sertlik ayarı (0.05–100 GV), proton / elektron / alfa parçacığı seçimi
- Parçacıklar dipol alanında göreli Boris itici ile gerçekten izlenir: düşük enerjililer kutuplara yönelir veya geri döner, yüksek enerjililer ekvatora ulaşır, atmosferde hava sağanağı oluşturur
- Kalkanın engellediği kozmik ışın oranı (galaktik spektrum ve Störmer kesmesinden analitik tahmin; alan yoksa %0) ve görsel parçacık sayaçları

**Manyetik alan**
- Alan gücü (%0–200), kalkanı kapatma (Mars benzeri indüklenmiş manyetosfer, atmosfer kaybı)
- Kutup tersinmesi animasyonu, Laschamp olayı senaryosu
- Güneş rüzgârı hızı, yoğunluğu ve IMF Bz/By ayarları

**Görselleştirme**
- Gece/gündüz Dünya, bulutlar, atmosfer, mevsime göre eksen eğikliği, gerçekçi dipol eğimi
- Manyetopoz (Shue 1998), yay şoku, alan çizgileri, manyetokuyruk, plazma tabakası
- Van Allen kuşakları ve tuzaklanmış parçacıkların sarmal–sekme–sürüklenme hareketi
- Animasyonlu aurora perdeleri; **İstanbul'dan aurora görünür mü?** göstergesi (oval enlemi + Güneş’in ufkun altında olması)
- Uydular: ISS, GPS takımyıldızı, Türksat dahil GEO uyduları, Güney Atlantik Anomalisi
- Canlı grafikler (Dst, Kp, Bz, rüzgâr hızı), olay günlüğü, eğitsel bilgi pencereleri

**Dil**
- Üst çubukta TR/EN anahtarı; varsayılan dil tarayıcı dilinden seçilir
- `?lang=en` / `?lang=tr` URL parametresi de dili belirler; seçim localStorage'da saklanır

## Çalıştırma

Gereksinim: Node.js 20+

```bash
npm install
npm run dev
```

Tarayıcıda `http://localhost:5173` adresini aç. Üretim derlemesi için `npm run build`, testler için `npm test`.

## Kısayollar

| Tuş | İşlev |
|---|---|
| Boşluk | Duraklat / devam |
| F | Güneş fırtınası tetikle |
| K | Kozmik ışın patlaması |
| T | Kutup tersinmesi |
| 1–7 | Kamera önayarları |
| H | Arayüzü gizle |
| L | Etiketleri aç/kapat |
| I | Bilgi |
| Shift+R | Sıfırla |

## Fizik modelleri

- Manyetopoz: Shue ve ark. (1998); yay şoku: Spreiter / Farris & Russell
- Manyetokılıf akışı: Rankine yarı-cismi (α = 0.5 Shue yüzeyi)
- Bağlaşım ve Kp: Newell ve ark. (2007, 2008); Kp 9’da yumuşak doyuma sokulmuş, sıkıştırılmış yaklaşık bir değerdir
- Halka akımı (Dst): O'Brien & McPherron (2000)
- Aurora sınırı: Starkov (1994) + aşırı fırtına uzantısı; plazmapoz: Carpenter & Anderson (1992)
- Kozmik ışın erişimi: Störmer kuramı, göreli Boris itici

**Sınırlamalar:** Uzaklıklar ölçeksizdir (Güneş gerçekte ~23 500 Re uzakta), zaman ölçekleri sıkıştırılmıştır,
manyetik alan dipol + deformasyon modelidir. Doz, GPS hatası gibi etki tahminleri eğitsel amaçlı kaba yaklaşımlardır.

Dünya dokuları: NASA Blue Marble (three.js örnek dokuları üzerinden). Ağ yoksa prosedürel yedek görünüm kullanılır.

## Proje yapısı

```
src/
  core/      durum, olaylar, simülasyon motoru, koordinat yardımcıları, ortak sayı biçimi (Türkçe)
  physics/   manyetopoz, dipol alanı, parçacık itici, indeksler, fırtına profilleri
  scene/     Three.js katmanları (Dünya, Güneş, manyetosfer, rüzgâr, kozmik ışınlar, kuşaklar, aurora, uydular)
  ui/        kontrol paneli, veri paneli, grafikler, günlük, bilgi penceresi
tests/       fizik birim testleri ve WebGL'siz duman testleri
docs/        mimari ve modül sözleşmeleri
```

## Atıf

Bu yazılımı kullanırsan lütfen şöyle atıf yap (ayrıntılar: [CITATION.cff](CITATION.cff)):

> Karatum, M. (2026). *Earth Magnetic Shield (Manyetik Kalkan): Interactive 3D Magnetosphere and Space-Weather Simulation* (Sürüm 1.0.0) [Yazılım]. Zenodo. DOI: _eklenecek_

## Lisans

[MIT](LICENSE) © 2026 Mustafa Karatum
