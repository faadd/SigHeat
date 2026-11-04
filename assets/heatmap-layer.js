/* Leaflet adapter for SigHeat's local, normalized heatmap. No remote heatmap API. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, require("./heatmap.js"));
  else root.SigHeatHeatLayer = factory(root, root.SigHeatHeatmap);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, H) {
  "use strict";
  function create(L, options = {}) {
    if (!L?.Layer || !H) throw new Error("Modul heatmap atau Leaflet belum tersedia.");
    const HeatLayer = L.Layer.extend({
      initialize() { this._samples = []; this._frame = null; },
      onAdd(map) {
        this._map = map;
        this._canvas = L.DomUtil.create("canvas", "sigheat-heat-layer leaflet-zoom-hide");
        this._canvas.setAttribute("aria-hidden", "true");
        this._canvas.style.pointerEvents = "none";
        map.getPane("overlayPane").appendChild(this._canvas);
        this._queueDraw();
      },
      onRemove() {
        if (this._frame != null && root.cancelAnimationFrame) root.cancelAnimationFrame(this._frame);
        this._frame = null;
        this._canvas?.remove();
        this._canvas = null;
        this._map = null;
      },
      // Leaflet binds/unbinds these handlers with the layer's lifecycle.
      getEvents() { return { moveend: this._queueDraw, zoomend: this._queueDraw, resize: this._queueDraw }; },
      setSamples(samples) {
        this._samples = Array.isArray(samples) ? samples.slice() : [];
        this._queueDraw();
        return this;
      },
      _queueDraw() {
        if (!this._map || !this._canvas || this._frame != null) return;
        if (root.requestAnimationFrame) this._frame = root.requestAnimationFrame(() => { this._frame = null; this._draw(); });
        else this._draw();
      },
      _draw() {
        if (!this._map || !this._canvas) return;
        try {
          const map = this._map, size = map.getSize();
          const width = Math.max(1, Math.round(size.x)), height = Math.max(1, Math.round(size.y));
          const canvas = this._canvas, ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D tidak tersedia pada browser ini.");
          // Store a reduced raster; CSS stretches it to the viewport, keeping memory bounded.
          canvas.style.width = width + "px";
          canvas.style.height = height + "px";
          L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
          const a = map.containerPointToLatLng([width / 2, height / 2]);
          const b = map.containerPointToLatLng([width / 2 + 1, height / 2]);
          const metersPerPixel = map.distance(a, b);
          const radiusPx = 35 / metersPerPixel;
          if (!Number.isFinite(radiusPx) || radiusPx < 2) {
            canvas.width = 1; canvas.height = 1;
            options.onRender?.({ coveredCells: 0, zoomTooWide: true });
            return;
          }
          const projected = this._samples.map((p) => {
            const screen = map.latLngToContainerPoint([p.latitude, p.longitude]);
            return { x: screen.x, y: screen.y, value: p.value };
          });
          const raster = H.buildRaster(projected, width, height, { radiusPx, pixelStep: 2 });
          canvas.width = raster.width;
          canvas.height = raster.height;
          const image = ctx.createImageData(raster.width, raster.height);
          image.data.set(raster.data);
          ctx.putImageData(image, 0, 0);
          options.onRender?.({ coveredCells: raster.coveredCells, zoomTooWide: false });
        } catch (error) {
          // Clear stale color instead of leaving an obsolete surface on the map.
          if (this._canvas) { this._canvas.width = 1; this._canvas.height = 1; }
          options.onRender?.({ coveredCells: 0, error: String(error.message || error) });
        }
      },
    });
    return new HeatLayer();
  }
  return { create };
});
