// panel sözlük parçası (tr) — kontrol paneli (#panel): bölümler, denetimler, katman adları
export default {
  // genel
  'panel.help.title': 'Bu konu hakkında bilgi',
  'panel.help.aria': '{title} hakkında bilgi',
  'panel.pct': '%{v}',

  // birimler (zaman ölçeği)
  'panel.unit.hourPerSec': 'sa/s',
  'panel.unit.minPerSec': 'dk/s',
  'panel.unit.sec': 'sn',
  'panel.unit.min': 'dk',

  // mevsim ipuçları (eksen eğikliği)
  'panel.season.northTilt': 'kuzey kutbu Güneş’e eğik',
  'panel.season.southTilt': 'güney kutbu Güneş’e eğik',
  'panel.season.equinox': 'ekinoks, eksen Güneş’e dik',
  'panel.season.northPart': 'kuzey kutbu kısmen Güneş’e eğik',
  'panel.season.southPart': 'güney kutbu kısmen Güneş’e eğik',

  // fırtına evreleri
  'panel.phase.transit': 'CME yolda %{pct}',
  'panel.phase.sheath': 'Şok kılıfı',
  'panel.phase.cloud': 'Manyetik bulut',
  'panel.phase.recovery': 'Toparlanma',
  'panel.phase.ended': 'Sona erdi',

  // parçacık adları
  'panel.particle.proton': 'Proton',
  'panel.particle.electron': 'Elektron',
  'panel.particle.alpha': 'Alfa',

  // 1. Güneş fırtınası
  'panel.storm.title': '☀️ Güneş Fırtınası',
  'panel.storm.strength': 'Fırtına gücü',
  'panel.storm.preview': '{flare} patlaması · {v} km/s CME · ~{h} sa yolculuk · Beklenen G{g}, Dst ≈ {dst} nT',
  'panel.storm.trigger': 'Fırtınayı Tetikle',
  'panel.storm.triggerTitle': 'Güneş patlaması + CME fırlat (F)',
  'panel.storm.historicHead': 'Tarihî olaylar',
  'panel.storm.historic': 'Tarihî olay',
  'panel.storm.replay': 'Olayı Canlandır',
  'panel.storm.activeHead': 'Aktif fırtınalar',
  'panel.storm.none': 'Şu an yolda ya da etkin bir fırtına yok.',
  'panel.storm.meta': '{flare} patlaması · {v} km/s · beklenen G{g}',

  // 2. Kozmik ışınlar
  'panel.cosmic.title': '🌌 Kozmik Işınlar',
  'panel.cosmic.gcr': 'Galaktik kozmik ışın akısı',
  'panel.cosmic.gcrSub': 'Şu anki bağıl akı: %{pct} (fırtınada Forbush azalması)',
  'panel.cosmic.burst': 'Patlama şiddeti',
  'panel.cosmic.burstVal': '%{pct} · ~{n} parçacık',
  'panel.cosmic.energy': 'Parçacık enerjisi (sertlik)',
  'panel.cosmic.kinetic': 'Kinetik enerji ≈ {e} ({name})',
  'panel.cosmic.particle': 'Parçacık türü',
  'panel.cosmic.hintNoShield': 'Manyetik kalkan yok: her enerjideki parçacık tüm enlemlere serbestçe ulaşır.',
  'panel.cosmic.hintAll': 'Bu sertlikteki parçacıklar ekvator dahil her manyetik enleme dikey ulaşabilir (Störmer kesmesi).',
  'panel.cosmic.hintLat': 'Bu sertlikteki parçacıklar yalnızca ≥ {lat}° manyetik enlemlere dikey ulaşabilir (Störmer kesmesi).',
  'panel.cosmic.fire': 'Kozmik Işın Patlaması',
  'panel.cosmic.fireTitle': 'Seçili parçacıklardan oluşan bir patlama gönder (K)',

  // 3. Güneş rüzgârı
  'panel.wind.title': '🌬️ Güneş Rüzgârı (arka plan)',
  'panel.wind.speed': 'Hız',
  'panel.wind.density': 'Yoğunluk',
  'panel.wind.effective': 'Etkin (fırtına): {v} {unit}',
  'panel.wind.bzSouth': 'güneye (fırtına açar)',
  'panel.wind.bzNorth': 'kuzeye (sakin)',
  'panel.wind.bzFlat': 'yatay (etkisiz)',

  // 4. Manyetik alan
  'panel.field.title': '🧲 Manyetik Alan',
  'panel.field.strength': 'Alan gücü',
  'panel.field.moment': 'Dipol momenti ≈ {v} × 10²² A·m²',
  'panel.field.shield': 'Kalkan',
  'panel.field.tilt': 'Gerçekçi dipol eğimi (~9.4°)',
  'panel.field.polarity': 'Kutupluluk:',
  'panel.field.polNormal': 'Normal',
  'panel.field.polReversed': 'Ters',
  'panel.field.reversal': 'Kutup Tersinmesi Başlat',
  'panel.field.reversalTitle': 'Dipol zayıflar, kutup gezinir ve ters döner (T)',
  'panel.field.reversalPct': 'Tersinme %{pct}',
  'panel.field.reversalInfo': 'Kutup tersinmesi nedir?',
  'panel.field.scenarios': 'Senaryolar',
  'panel.field.scenarioDefault': 'Hazır bir senaryoyu tek tıkla uygula.',

  // 5. Katmanlar
  'panel.layers.title': '👁️ Katmanlar',
  'layer.fieldLines': 'Alan çizgileri',
  'layer.magnetopause': 'Manyetopoz',
  'layer.bowShock': 'Yay şoku',
  'layer.solarWind': 'Güneş rüzgârı',
  'layer.radiationBelts': 'Van Allen kuşakları',
  'layer.aurora': 'Auroralar',
  'layer.cosmicRays': 'Kozmik ışınlar',
  'layer.satellites': 'Uydular',
  'layer.labels': 'Etiketler',
  'layer.stars': 'Yıldızlar',
  'layer.moon': 'Ay',
  'layer.sunEarthLine': 'Güneş–Dünya hattı',
  'layer.axes': 'Eksenler',

  // 6. Kamera
  'panel.camera.title': '🎥 Kamera',
  'panel.camera.autoRotate': 'Otomatik dönüş',

  // 7. Zaman
  'panel.time.title': '⏱️ Zaman',
  'panel.time.scale': 'Zaman ölçeği',
  'panel.time.dayAbout': '1 simülasyon günü ≈ {v}',
  'panel.time.warpActive': 'CME yolda, zaman hızlandırıldı: {rate}',
  'panel.time.visual': 'Parçacık animasyon hızı',
  'panel.time.season': 'Mevsim (yılın günü)',
  'panel.time.day': 'Gün {d}',
  'panel.time.warp': 'CME yolculuğunda zamanı hızlandır',
  'panel.time.pauseTitle': 'Duraklat / devam et (Boşluk)',
  'panel.time.pause': '⏸ Duraklat',
  'panel.time.resume': '▶ Devam Et',
  'panel.time.reset': '↺ Sıfırla',
  'panel.time.resetTitle': 'Simülasyonu sakin koşullara döndür (Shift+R)',

  // alt bilgi
  'panel.foot.helpPre': 'Yardım için ',
  'panel.foot.helpPost': ' tuşuna bas',
  'panel.foot.shortcuts': 'Kısayollar ve kullanım',
};
