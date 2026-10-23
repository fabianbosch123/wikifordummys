/**
 * Ersetzt js/PreConfig.js von draw.io: alle Adressen zeigen auf den eigenen Server (/draw/ auf der Domain des Wikis)
 * statt auf app.diagrams.net. Externe Dienste schaltet zusätzlich der Parameter stealth=1 ab.
 * location.protocol/host statt location.origin: Im abgeschotteten Rahmen ist der eigene Ursprung "null".
 */
window.DRAWIO_PUBLIC_BUILD = true;
window.DRAWIO_BASE_URL = location.protocol + '//' + location.host + '/draw';
window.DRAWIO_VIEWER_URL = window.DRAWIO_BASE_URL + '/js/viewer.min.js';
window.DRAWIO_LIGHTBOX_URL = window.DRAWIO_BASE_URL;
window.DRAW_MATH_URL = 'math4/es5';
// Kein Export-Server: PDF über den Druckdialog, PNG/SVG rechnet der Browser selbst
window.EXPORT_URL = null;
window.DRAWIO_CONFIG = null;
window.urlParams['sync'] = 'manual';

/**
 * Im abgeschotteten Rahmen gibt es weder localStorage noch sessionStorage (der Zugriff wirft einen Fehler).
 * Ohne lädt draw.io keine Einstellungen und baut Seitenleiste und Formatbereich nicht auf. Ersatz im Arbeitsspeicher:
 * Einstellungen gelten nur, solange der Editor offen ist; Zeichnungen speichert ohnehin das Wiki.
 */
(function () {
  function memoryStorage() {
    var data = {};
    var has = function (k) {
      return Object.prototype.hasOwnProperty.call(data, k);
    };
    return {
      getItem: function (k) {
        return has(String(k)) ? data[String(k)] : null;
      },
      setItem: function (k, v) {
        data[String(k)] = String(v);
      },
      removeItem: function (k) {
        delete data[String(k)];
      },
      clear: function () {
        data = {};
      },
      key: function (i) {
        return Object.keys(data)[i] || null;
      },
      get length() {
        return Object.keys(data).length;
      },
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      if (window[name]) return;
    } catch {
      // abgeschottet, weiter mit Ersatz
    }
    try {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
      if (name === 'localStorage') window.isLocalStorage = true;
    } catch {
      // draw.io läuft dann ohne gespeicherte Einstellungen
    }
  });
})();
