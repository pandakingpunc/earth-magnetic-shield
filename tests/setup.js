// Tüm testler varsayılan olarak Türkçe çalışır (node'un navigator.language değeri ortamdan ortama değişir).
// İngilizce sınayan testler setLang('en', { reload: false }) çağırır.
import { setLang } from '../src/i18n/index.js';

setLang('tr', { reload: false });
