// Küçük bir olay yayıcı. Modüller arası gevşek bağlantı için kullanılır.
//
// Standart olaylar (payload):
//   'storm:launched'   { storm }                    — patlama + CME fırlatıldı
//   'storm:arrived'    { storm }                    — CME şoku Dünya'ya ulaştı (SSC)
//   'storm:ended'      { storm }
//   'flare'            { storm, flareClass, rScale } — Güneş patlaması (anında görülür)
//   'sep:onset'        { storm, sScale }            — Güneş enerjik parçacıkları geliyor
//   'cosmic:burst'     { intensity, rigidityGV, charge, particle, count, direction:[x,y,z]|null }
//                      direction: Dünya'dan kaynağa doğru birim vektör (parçacıklar −direction yönünde gelir); null → rastgele
//   'cosmic:impact'    { magLatDeg, rigidityGV, charge, kind }  — parçacık atmosfere ulaştı
//   'cosmic:escaped'   { rigidityGV, charge, kind }  — parçacık saptırıldı / uzaklaştı
//   'reversal:start'   {}
//   'reversal:end'     {}
//   'preset:applied'   { id, name }
//   'alert'            { level: 'info'|'warn'|'danger', text, simHours }
//   'layers:changed'   { layers }
//   'camera:preset'    { name }
//   'sim:reset'        {}

export class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] '${type}' işleyicisinde hata:`, err);
      }
    }
  }
}
