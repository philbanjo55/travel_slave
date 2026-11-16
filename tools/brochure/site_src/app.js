(function () {
  'use strict';
  var doc = document.documentElement; doc.classList.add('js');
  var trips = ['tetons', 'faroes'];
  var maps = {};
  var top = document.querySelector('.top');

  function current() { return document.body.getAttribute('data-trip'); }

  function show(key, anchor) {
    if (trips.indexOf(key) < 0) key = 'tetons';
    document.body.setAttribute('data-trip', key);
    trips.forEach(function (k) { document.getElementById(k).classList.toggle('on', k === key); });
    document.querySelectorAll('.switch a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('data-go') === key ? 'true' : 'false'); });
    document.title = key === 'faroes' ? 'Philm+Frame Trips: the Faroe Islands, May 2027' : 'Philm+Frame Trips: Grand Teton in winter';
    initMap(key);
    if (anchor) {
      var el = document.getElementById(anchor);
      if (el) {
        if (el.tagName === 'DETAILS') { el.open = true; el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 2200); }
        setTimeout(function () { var y = el.getBoundingClientRect().top + window.scrollY - 72; window.scrollTo({ top: y, behavior: 'instant' }); }, 30);
      }
    } else { window.scrollTo({ top: 0, behavior: 'instant' }); }
    onScroll();
  }

  function fromHash() {
    var h = decodeURIComponent((location.hash || '').slice(1));
    if (!h) return show(current() || 'tetons');
    var key = h.split('-')[0];
    show(key, trips.indexOf(h) >= 0 ? null : h);
  }

  // countdowns, understated
  function countdowns() {
    var now = Date.now();
    document.querySelectorAll('.countdown').forEach(function (el) {
      var s = Date.parse(el.getAttribute('data-start')), e = Date.parse(el.getAttribute('data-end'));
      if (isNaN(s)) return;
      var days = Math.ceil((s - now) / 864e5);
      el.textContent = now > e ? 'Home again, with a bag of exposed film.'
        : now >= s ? 'Happening now.'
        : days === 1 ? 'Leaving tomorrow.'
        : days + ' days to go.';
    });
  }

  // map: small and calm
  function initMap(key) {
    if (maps[key] || !window.L || !window.MAPS) return;
    var el = document.getElementById('map-' + key); if (!el) return;
    var data = window.MAPS[key];
    var accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#3a5f80';
    var map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    var bounds = [];
    var groups = {};
    data.stops.forEach(function (s) {
      var k = s.lat.toFixed(3) + ',' + s.lng.toFixed(3);
      (groups[k] = groups[k] || []).push(s);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], s = g[0], x = g.some(function (i) { return i.x; });
      var when = g.map(function (i) { return i.date; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
      L.circleMarker([s.lat, s.lng], x ? { radius: 7, color: '#fff', weight: 2, fillColor: accent, fillOpacity: 1 }
                                       : { radius: 5, color: '#7d8791', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindPopup('<b>' + esc(s.name) + '</b><br>' + esc(when)).addTo(map);
      bounds.push([s.lat, s.lng]);
    });
    data.hotels.forEach(function (h) {
      L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', html: '<span style="display:block;width:12px;height:12px;background:#1d2329;border:2px solid #fff;border-radius:2px"></span>', iconSize: [12, 12], iconAnchor: [6, 6] }), title: h.name })
        .bindPopup('<b>' + esc(h.name) + '</b>').addTo(map);
      bounds.push([h.lat, h.lng]);
    });
    map.fitBounds(bounds, { padding: [24, 24] });
    maps[key] = map;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function onScroll() {
    var hero = document.querySelector('.trip.on .hero');
    var h = hero ? hero.offsetHeight - 60 : 300;
    top.classList.toggle('solid', window.scrollY > h);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-go]');
    if (a) {
      e.preventDefault(); var k = a.getAttribute('data-go');
      if (location.hash !== '#' + k) history.pushState(null, '', '#' + k);
      show(k); return;
    }
    var p = e.target.closest('a[data-day]');
    if (p) {
      e.preventDefault(); var id = p.getAttribute('data-day');
      history.pushState(null, '', '#' + id); show(id.split('-')[0], id); return;
    }
    var t = e.target.closest('.toggle-all');
    if (t) {
      var ds = document.querySelectorAll('#' + t.getAttribute('data-trip') + ' details.day');
      var open = Array.prototype.some.call(ds, function (d) { return !d.open; });
      ds.forEach(function (d) { d.open = open; });
      t.textContent = open ? 'Close every day' : 'Open every day';
    }
  });
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('popstate', fromHash);
  window.addEventListener('scroll', onScroll, { passive: true });
  countdowns(); setInterval(countdowns, 60 * 60 * 1000);
  fromHash();
})();
