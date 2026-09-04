/* Leaflet 을 걷어내고 MapLibre GL 로 옮기면서, 그리는 코드를 다시 쓰지 않으려고
   Leaflet 이 쓰던 이름만큼만 흉내낸 층이다. 우리가 실제로 쓰는 것만 있다.

   왜 옮겼나: 지도를 돌리려면 배경과 그 위의 노선·정류장이 같은 엔진 안에
   있어야 한다. Leaflet 안에 MapLibre 를 레이어로 얹어 두면 회전할 때 둘이
   따로 논다 — 실제로 그렇게 되었다.

   배율 셈: OpenFreeMap 타일은 512px 이라 MapLibre 배율이 Leaflet 보다 1 작다.
   호출부의 16·17 같은 숫자를 그대로 두려고 이 층에서 ±1 해 준다. */
(function (global) {
  const ZOFF = 1;
  const MIN_SLACK = 1.2;      // 최소 배율에서 이만큼은 더 밀린다

  /* ---------- 값 타입 ---------- */
  const asLL = v => Array.isArray(v) ? { lat: +v[0], lng: +v[1] }
                                     : { lat: +v.lat, lng: +v.lng };
  const toGL = v => { const p = asLL(v); return [p.lng, p.lat]; };

  function Point(x, y) { this.x = x; this.y = y; }
  Point.prototype = {
    add(p)        { return new Point(this.x + p.x, this.y + p.y); },
    subtract(p)   { return new Point(this.x - p.x, this.y - p.y); },
    divideBy(n)   { return new Point(this.x / n, this.y / n); },
    multiplyBy(n) { return new Point(this.x * n, this.y * n); },
    _round()      { this.x = Math.round(this.x); this.y = Math.round(this.y); return this; },
  };
  const point = (x, y) => (x instanceof Point ? x
                        : Array.isArray(x) ? new Point(x[0], x[1]) : new Point(x, y));

  function LatLngBounds(a, b) {
    this._s = Infinity; this._w = Infinity; this._n = -Infinity; this._e = -Infinity;
    if (Array.isArray(a) && !b && a.length && (Array.isArray(a[0]) || a[0]?.lat !== undefined)) {
      a.forEach(p => this.extend(p));
    } else if (a) { this.extend(a); if (b) this.extend(b); }
  }
  LatLngBounds.prototype = {
    extend(p) { const q = asLL(p);
      this._s = Math.min(this._s, q.lat); this._n = Math.max(this._n, q.lat);
      this._w = Math.min(this._w, q.lng); this._e = Math.max(this._e, q.lng); return this; },
    getSouth() { return this._s; }, getNorth() { return this._n; },
    getWest()  { return this._w; }, getEast()  { return this._e; },
    isValid()  { return this._s <= this._n && this._w <= this._e; },
    contains(p){ const q = asLL(p);
      return q.lat >= this._s && q.lat <= this._n && q.lng >= this._w && q.lng <= this._e; },
    toGL()     { return [[this._w, this._s], [this._e, this._n]]; },
  };

  /* ---------- 레이어 묶음 ----------
     Leaflet 에서는 지웠다 다시 그려도 쌌다(SVG 노드 갈아 끼우기). MapLibre 는
     소스·레이어를 만들고 없애는 값이 비싸고, 매 초 그러면 눈에 띄게 깜빡인다.
     버스를 고르면 자취를 1초마다 다시 그리므로 그대로 두면 못 쓴다.

     그래서 자리를 정해 두고 그 자리의 데이터만 갈아 끼운다. clearLayers 는
     자리 번호를 0 으로 되돌릴 뿐이고, 그리기가 끝난 뒤(마이크로태스크)
     남는 자리만 실제로 지운다. 마커는 DOM 이라 값이 싸므로 그냥 지운다. */
  let rank = 0;
  function LayerGroup() {
    this._slots = []; this._n = 0; this._dom = [];
    this._map = null; this._key = 'g' + (++uid); this._trimQueued = false;
    this._rank = ++rank;                     // 만든 차례 = 겹치는 차례
  }
  LayerGroup.prototype = {
    addTo(map) { this._map = map; map._groups.push(this); return this; },
    addLayer(l) { if (l._isMarker) this._dom.push(l); return this; },
    removeLayer(l) {
      const i = this._dom.indexOf(l); if (i >= 0) this._dom.splice(i, 1);
      if (l) l.remove(); return this;
    },
    hasLayer(l) { return this._dom.includes(l); },
    clearLayers() {
      for (const l of this._dom) l.remove();
      this._dom = [];
      this._n = 0;
      this._queueTrim();
      return this;
    },
    /* 다음 자리를 내준다 */
    _take() {
      const i = this._n++;
      if (!this._slots[i]) this._slots[i] = { id: this._key + '_' + i, kind: null, rank: this._rank, seq: i };
      this._queueTrim();
      return this._slots[i];
    },
    _queueTrim() {
      if (this._trimQueued) return;
      this._trimQueued = true;
      Promise.resolve().then(() => { this._trimQueued = false; this._trim(); });
    },
    _trim() {
      if (!this._map) return;
      for (let i = this._n; i < this._slots.length; i++) this._map._dropSlot(this._slots[i]);
      this._slots.length = this._n;
    },
  };

  /* ---------- 선 ----------
     선 하나에 소스·레이어 하나씩. 노선 다섯에 길찾기·버스 자취를 합쳐도
     수십 개라 이 편이 간단하고, 그린 순서가 그대로 겹치는 순서가 된다.
     (한 레이어에 몰아넣으면 흰 테두리와 색 선의 위아래를 정할 수 없다) */
  let uid = 0;
  function Polyline(latlngs, opts) {
    this._id = 'ln' + (++uid);
    this._coords = latlngs.map(toGL);
    this.options = opts || {};
    this._map = null;
  }
  Polyline.prototype = {
    addTo(target) {
      const map = target._map || target;
      this._map = map;
      this._slot = target._take ? target._take() : null;
      map._putLine(this);
      return this;
    },
    remove() { if (this._map && this._slot) this._map._dropSlot(this._slot); this._map = null; return this; },
    _spec() {
      const o = this.options;
      const paint = {
        'line-color': o.color || '#333',
        'line-width': o.weight == null ? 3 : o.weight,
        'line-opacity': o.opacity == null ? 1 : o.opacity,
      };
      if (o.dashArray) {
        // Leaflet 은 px, MapLibre 는 선 굵기의 배수로 센다
        const w = paint['line-width'] || 1;
        paint['line-dasharray'] = String(o.dashArray).split(/[ ,]+/).map(n => +n / w);
      }
      return {
        id: this._id, type: 'line', source: this._id,
        layout: { 'line-cap': o.lineCap || 'round', 'line-join': o.lineJoin || 'miter' },
        paint,
      };
    },
  };

  /* ---------- 원 (내 위치 정확도) ----------
     MapLibre 에는 미터 반지름 원이 없다. 다각형으로 만들어 그린다. */
  function Circle(latlng, opts) {
    this._id = 'ci' + (++uid);
    this._ll = asLL(latlng);
    this.options = opts || {};
    this._r = opts.radius || 0;
    this._map = null;
  }
  Circle.prototype = {
    addTo(target) {
      const map = target._map || target;
      this._map = map;
      this._slot = target._take ? target._take() : { id: this._id, kind: null };
      map._putCircle(this);
      return this;
    },
    remove() { if (this._map && this._slot) this._map._dropSlot(this._slot); this._map = null; return this; },
    setLatLng(ll) { this._ll = asLL(ll); if (this._map) this._map._putCircle(this); return this; },
    setRadius(r)  { this._r = r; if (this._map) this._map._putCircle(this); return this; },
    _ring() {
      const n = 48, out = [];
      const dLat = this._r / 111320;
      const dLng = this._r / (111320 * Math.cos(this._ll.lat * Math.PI / 180) || 1);
      for (let i = 0; i <= n; i++) {
        const t = i / n * 2 * Math.PI;
        out.push([this._ll.lng + dLng * Math.cos(t), this._ll.lat + dLat * Math.sin(t)]);
      }
      return out;
    },
  };

  /* ---------- 아이콘·마커 ----------
     Leaflet 의 iconAnchor(아이콘 안에서 좌표에 닿는 점)를 MapLibre 의
     offset(가운데에서의 어긋남)으로 바꾼다. */
  function DivIcon(o) { this.options = o || {}; }
  const divIcon = o => new DivIcon(o);

  function Marker(latlng, opts) {
    this._isMarker = true;
    this._ll = asLL(latlng);
    this.options = opts || {};
    this._handlers = {};
    this._map = null;
    const ic = this.options.icon ? this.options.icon.options : {};
    const el = document.createElement('div');
    el.className = 'gl-marker ' + (ic.className || '');
    el.innerHTML = ic.html || '';
    if (ic.iconSize) { el.style.width = ic.iconSize[0] + 'px'; el.style.height = ic.iconSize[1] + 'px'; }
    if (this.options.zIndexOffset) el.style.zIndex = String(this.options.zIndexOffset);
    if (this.options.interactive === false) el.style.pointerEvents = 'none';
    this._el = el;
    let off = [0, 0];
    if (ic.iconSize && ic.iconAnchor) {
      off = [ic.iconSize[0] / 2 - ic.iconAnchor[0], ic.iconSize[1] / 2 - ic.iconAnchor[1]];
    }
    this._offset = off;
  }
  Marker.prototype = {
    addTo(target) {
      const map = target._map || target;
      if (target.addLayer) target.addLayer(this);
      this._map = map;
      this._gl = new global.maplibregl.Marker({
        element: this._el, offset: this._offset, draggable: !!this.options.draggable,
        // 지도를 돌려도 아이콘은 똑바로 서 있어야 읽힌다
        rotationAlignment: 'viewport', pitchAlignment: 'viewport',
      }).setLngLat(toGL(this._ll)).addTo(map._gl);
      if (this.options.draggable) {
        this._gl.on('dragend', () => this._fire('dragend', { target: this }));
      }
      return this;
    },
    remove() { if (this._gl) this._gl.remove(); this._gl = null; this._map = null; return this; },
    setLatLng(ll) { this._ll = asLL(ll); if (this._gl) this._gl.setLngLat(toGL(this._ll)); return this; },
    getLatLng() { return this._gl ? (() => { const p = this._gl.getLngLat(); return { lat: p.lat, lng: p.lng }; })() : this._ll; },
    getElement() { return this._el; },
    on(type, fn) {
      (this._handlers[type] = this._handlers[type] || []).push(fn);
      if (type === 'click') this._el.addEventListener('click', e => { e.stopPropagation(); fn(e); });
      return this;
    },
    _fire(type, e) { (this._handlers[type] || []).forEach(f => f(e)); },
    // 지도 위 라벨은 이미 마커 안에 그리고 있어서, 여기서는 이름만 달아 둔다
    bindTooltip(text) { this._el.setAttribute('title', text); return this; },
  };

  /* ---------- 표지 ---------- */
  function Popup(o) { this.options = o || {}; this._gl = null; }
  Popup.prototype = {
    setLatLng(ll) { this._ll = asLL(ll); return this; },
    setContent(html) { this._html = html; return this; },
    openOn(map) {
      map.closePopup();
      const o = this.options;
      this._gl = new global.maplibregl.Popup({
        closeButton: !!o.closeButton, closeOnClick: true,
        className: o.className, maxWidth: (o.maxWidth || 240) + 'px',
        offset: o.offset ? [o.offset[0], o.offset[1]] : 0,
      }).setLngLat(toGL(this._ll)).setHTML(this._html).addTo(map._gl);
      map._popup = this._gl;
      this._gl.on('close', () => { if (map._popup === this._gl) map._popup = null; });
      return this;
    },
  };

  /* ---------- 지도 ---------- */
  function Map(id, opts) {
    const o = opts || {};
    this._groups = [];
    this._slots = new Set();
    this._popup = null;
    this._minZoom = 0; this._maxZoom = 20;
    this._gl = new global.maplibregl.Map({
      container: typeof id === 'string' ? id : id,
      style: o.style || { version: 8, sources: {}, layers: [] },
      center: toGL(o.center || [0, 0]),
      zoom: (o.zoom || 13) - ZOFF,
      attributionControl: false,
      dragRotate: true, pitchWithRotate: false, touchPitch: false,
      // 두 손가락 회전은 켜 두고 기울이기는 막는다 — 노선도에 기울기는 쓸 데가 없다
      maxPitch: 0,
    });
    this._gl.addControl(new global.maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this._gl.touchZoomRotate.enableRotation();
    // 스타일이 갈릴 때마다 우리가 얹은 것이 지워지므로 다시 얹는다
    /* 스타일을 갈면 우리가 얹은 소스·레이어가 함께 지워진다.
       그리고 스타일이 준비됐는지는 우리가 따로 센다 — isStyleLoaded() 는
       타일을 받는 중에도 false 가 되는데, 그때 style.load 를 기다리게 두면
       스타일은 이미 로드된 뒤라 그 이벤트가 다시 오지 않는다. 그렇게
       사라진 선들이 버스 자취를 흰 테두리만 남기고 있었다. */
    this._ready = false;
    this._gl.on('style.load', () => { this._ready = true; this._restore(); });
  }
  Map.prototype = {
    /* --- 자리에 얹기 --- *
     * 같은 자리는 만들지 않고 갈아 끼운다. 스타일이 아직 안 왔으면 미뤄 두고,
     * 스타일이 갈리면(_restore) 자리마다 마지막 모습으로 다시 얹는다. */
    _put(slot, kind, data, spec) {
      slot.kind = kind; slot.data = data; slot.spec = spec;
      this._slots.add(slot);
      const put = () => {
        if (slot.kind !== kind) return;            // 그 사이 다른 것이 들어왔다
        const src = this._gl.getSource(slot.id);
        if (src) src.setData(data);
        else this._gl.addSource(slot.id, { type: 'geojson', data });
        const lyr = this._gl.getLayer(slot.id);
        /* 어느 자리 앞에 끼울지 정해 준다. 그냥 얹으면 늦게 만들어진 것이
           늘 위로 가서, 버스 자취가 회색 노선 밑에 깔리는 일이 생긴다.
           묶음 순위 → 그 안의 차례 순으로 줄을 세운다. */
        if (!lyr) this._gl.addLayer({ ...spec, id: slot.id, source: slot.id }, this._before(slot));
        else for (const [k, v] of Object.entries(spec.paint)) {
          this._gl.setPaintProperty(slot.id, k, v);
        }
      };
      // 아직이면 자리만 적어 둔다 — style.load 에서 _restore 가 다 얹는다
      if (this._ready) put();
    },
    _putLine(l) {
      this._put(l._slot, 'line',
        { type: 'Feature', geometry: { type: 'LineString', coordinates: l._coords } },
        l._spec());
    },
    _putCircle(c) {
      this._put(c._slot, 'fill',
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [c._ring()] } },
        { type: 'fill', paint: {
            'fill-color': c.options.color || '#1a73e8',
            'fill-opacity': c.options.fillOpacity == null ? .1 : c.options.fillOpacity } });
    },
    /* 이 자리보다 위에 와야 할 것 중 가장 앞선 것 */
    _before(slot) {
      let best = null;
      for (const s of this._slots) {
        if (!s.kind || s === slot) continue;
        if (s.rank < slot.rank || (s.rank === slot.rank && s.seq <= slot.seq)) continue;
        if (!this._gl.getLayer(s.id)) continue;
        if (!best || s.rank < best.rank || (s.rank === best.rank && s.seq < best.seq)) best = s;
      }
      return best ? best.id : undefined;
    },
    _dropSlot(slot) {
      if (!slot) return;
      this._slots.delete(slot);
      slot.kind = null;
      // 스타일이 오기 전에는 지도에 물어보면 안 된다 (아직 아무것도 없다)
      if (!this._ready) return;
      if (this._gl.getLayer(slot.id)) this._gl.removeLayer(slot.id);
      if (this._gl.getSource(slot.id)) this._gl.removeSource(slot.id);
    },
    _restore() {
      // Set 은 넣은 차례를 지키므로 겹치는 위아래도 그대로 살아난다
      for (const s of this._slots) if (s.kind) this._put(s, s.kind, s.data, s.spec);
    },
    removeLayer(l) { if (l && l.remove) l.remove(); return this; },

    /* --- 카메라 --- */
    getZoom()    { return this._gl.getZoom() + ZOFF; },
    setZoom(z)   { this._gl.setZoom(z - ZOFF); return this; },
    zoomIn()     { this._gl.zoomIn(); return this; },
    zoomOut()    { this._gl.zoomOut(); return this; },
    getMinZoom() { return this._minZoom; },
    getMaxZoom() { return this._maxZoom; },
    /* 딱 막으면 손가락이 벽에 부딪힌 느낌이라, 조금 넘어갔다 돌아오게 둔다.
       실제 한계는 조금 아래로 열어 두고, 손을 떼면 제자리로 당긴다. */
    setMinZoom(z) {
      this._minZoom = z;
      this._gl.setMinZoom(Math.max(0, z - ZOFF - MIN_SLACK));
      if (!this._spring) {
        this._spring = true;
        this._gl.on('zoomend', () => {
          const lo = this._minZoom - ZOFF;
          if (this._gl.getZoom() < lo - 0.01) this._gl.easeTo({ zoom: lo, duration: 260 });
        });
      }
      return this;
    },
    setMaxZoom(z){ this._maxZoom = z; this._gl.setMaxZoom(z - ZOFF); return this; },
    getCenter()  { const c = this._gl.getCenter(); return { lat: c.lat, lng: c.lng }; },
    setView(ll, z) { this._gl.jumpTo({ center: toGL(ll), zoom: (z == null ? this.getZoom() : z) - ZOFF }); return this; },
    panTo(ll)    { this._gl.panTo(toGL(ll)); return this; },
    setMaxBounds(b) { this._gl.setMaxBounds(b.toGL()); return this; },
    getSize()    { const c = this._gl.getContainer(); return new Point(c.clientWidth, c.clientHeight); },
    getBearing() { return this._gl.getBearing(); },
    /* animate 없이 부르면 즉시 돌린다. 나침반 값은 초당 수십 번 들어오는데
       그때마다 rotateTo 로 애니메이션을 걸면 서로 잡아먹어 기어간다. */
    setBearing(d, animate) {
      if (animate) this._gl.rotateTo(d, { duration: 300 });
      else this._gl.setBearing(d);
      return this;
    },
    getBoundsZoom(b) {
      const cam = this._gl.cameraForBounds(b.toGL(), { padding: 0 });
      return cam ? cam.zoom + ZOFF : this.getZoom();
    },
    fitBounds(b, o) {
      o = o || {};
      const tl = o.paddingTopLeft || [0, 0], br = o.paddingBottomRight || [0, 0];
      this._gl.fitBounds(b.toGL(), {
        padding: { left: tl[0], top: tl[1], right: br[0], bottom: br[1] },
        maxZoom: o.maxZoom == null ? this._maxZoom - ZOFF : o.maxZoom - ZOFF,
        animate: o.animate !== false,
      });
      return this;
    },

    /* --- 좌표 --- */
    latLngToContainerPoint(ll) { const p = this._gl.project(toGL(ll)); return new Point(p.x, p.y); },
    containerPointToLatLng(p)  { const q = this._gl.unproject([p.x, p.y]); return { lat: q.lat, lng: q.lng }; },
    // 우리 쓰임에서는 컨테이너 좌표와 같은 뜻이다 (두 점의 중간을 잡는 데만 쓴다)
    latLngToLayerPoint(ll) { return this.latLngToContainerPoint(ll); },
    layerPointToLatLng(p)  { return this.containerPointToLatLng(p); },

    /* --- 사건 --- */
    on(type, fn) {
      const wrap = e => {
        if (e && e.lngLat) e.latlng = { lat: e.lngLat.lat, lng: e.lngLat.lng };
        fn(e);
      };
      for (const t of String(type).split(/\s+/)) {
        this._gl.on({ dragstart: 'dragstart', zoomend: 'zoomend', moveend: 'moveend',
                      click: 'click', contextmenu: 'contextmenu', rotate: 'rotate',
                      load: 'load', movestart: 'movestart' }[t] || t, wrap);
      }
      return this;
    },
    closePopup() { if (this._popup) { this._popup.remove(); this._popup = null; } return this; },
    getPane() { return null; },
    invalidateSize() { this._gl.resize(); return this; },
  };

  /* ---------- 사건 전파 막기 ---------- */
  const DomEvent = {
    disableClickPropagation(el) {
      for (const t of ['mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu'])
        el.addEventListener(t, e => e.stopPropagation());
      return this;
    },
    disableScrollPropagation(el) {
      for (const t of ['wheel', 'mousewheel'])
        el.addEventListener(t, e => e.stopPropagation());
      return this;
    },
  };

  global.L = {
    map: (id, o) => new Map(id, o),
    layerGroup: () => new LayerGroup(),
    polyline: (ll, o) => new Polyline(ll, o),
    circle: (ll, o) => new Circle(ll, o),
    marker: (ll, o) => new Marker(ll, o),
    divIcon,
    popup: o => new Popup(o),
    latLng: (a, b) => (b == null ? asLL(a) : { lat: +a, lng: +b }),
    latLngBounds: (a, b) => new LatLngBounds(a, b),
    point,
    DomEvent,
  };
})(window);
