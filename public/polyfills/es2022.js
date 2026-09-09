/* HammerTrack — ES2022 shims for older Android System WebViews and Samsung
   Internet (Chromium < 93). The page gets the same shims inline from
   app/layout.tsx; this file exists for WEB WORKERS, which have their own
   global: MapLibre's worker code calls Object.hasOwn while building line
   buckets, and that took /map down on Brian's phone three more times on
   Sep 8 after the page-side fix (task #42). Loaded into every MapLibre
   worker via importScriptInWorkers (lib/maplibre-setup.ts). Plain ES5 —
   the whole point is running where the new syntax does not. */
(function () {
  if (typeof Object.hasOwn !== 'function') {
    Object.defineProperty(Object, 'hasOwn', {
      value: function (o, k) { return Object.prototype.hasOwnProperty.call(Object(o), k); },
      writable: true, configurable: true,
    });
  }
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      value: function (n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this[n]; },
      writable: true, configurable: true,
    });
  }
})();
