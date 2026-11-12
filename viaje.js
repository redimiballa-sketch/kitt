// =====================================================================
//  K.I.T.T. - VIAJE: GPS, clima, navegación (Maps/Waze), música y llamadas
// =====================================================================

let gpsWatch = null;
let gps = null;              // { lat, lon, speedKmh, time }
let placeName = "";          // nombre del lugar (calle, ciudad)
let lastGeocode = null;      // { lat, lon, time }
let weather = null;          // datos de Open-Meteo
let weatherTime = 0;

// ---------- GPS ----------
function startGps() {
  if (!navigator.geolocation || gpsWatch !== null) return;
  gpsWatch = navigator.geolocation.watchPosition(onPosition, err => {
    console.warn("GPS:", err.message);
    document.getElementById('gps-info').innerText = "GPS SIN SEÑAL";
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function onPosition(pos) {
  const { latitude: lat, longitude: lon, speed } = pos.coords;
  gps = { lat, lon, speedKmh: speed != null ? Math.round(speed * 3.6) : null, time: Date.now() };
  updateGpsLabel();

  // Nombre del lugar: cada 2 minutos o al moverse ~300 m
  const moved = lastGeocode ? distanceKm(lastGeocode.lat, lastGeocode.lon, lat, lon) : 999;
  if (!lastGeocode || moved > 0.3 || Date.now() - lastGeocode.time > 120000) {
    lastGeocode = { lat, lon, time: Date.now() };
    reverseGeocode(lat, lon);
  }
  if (typeof onNavPosition === 'function') onNavPosition();
  // Clima: cada 15 minutos
  if (Date.now() - weatherTime > 15 * 60000) loadWeather(lat, lon);
}

function updateGpsLabel() {
  const el = document.getElementById('gps-info');
  if (!el || !gps) return;
  const vel = gps.speedKmh != null ? `${gps.speedKmh} KM/H` : "";
  const lugar = placeName ? placeName.split(',')[0].toUpperCase() : "GPS ACTIVO";
  el.innerText = [lugar, vel].filter(Boolean).join(" · ");
}

function distanceKm(a, b, c, d) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(c - a), dLon = toR(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&accept-language=es`);
    const d = await r.json();
    const a = d.address || {};
    placeName = [a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village, a.state]
      .filter(Boolean).join(", ");
    updateGpsLabel();
  } catch (e) { console.warn("No se pudo obtener el nombre del lugar:", e); }
}

// ---------- Clima (Open-Meteo, gratis y sin clave) ----------
const WEATHER_CODES = {
  0: "despejado", 1: "mayormente despejado", 2: "parcialmente nublado", 3: "nublado",
  45: "con neblina", 48: "con neblina helada", 51: "con llovizna ligera", 53: "con llovizna",
  55: "con llovizna fuerte", 61: "con lluvia ligera", 63: "con lluvia", 65: "con lluvia fuerte",
  71: "con nevada ligera", 73: "con nevada", 75: "con nevada fuerte", 80: "con chubascos ligeros",
  81: "con chubascos", 82: "con chubascos fuertes", 95: "con tormenta", 96: "con tormenta y granizo", 99: "con tormenta fuerte"
};

async function loadWeather(lat, lon) {
  weatherTime = Date.now();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,precipitation` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&timezone=auto&forecast_days=2`;
    weather = await (await fetch(url)).json();
  } catch (e) { console.warn("No se pudo obtener el clima:", e); }
}

function weatherText() {
  if (!weather?.current) return "";
  const c = weather.current, d = weather.daily;
  const hoy = `Ahora: ${Math.round(c.temperature_2m)}°C, ${WEATHER_CODES[c.weather_code] || "estado desconocido"}.` +
    ` Hoy: mínima ${Math.round(d.temperature_2m_min[0])}°C, máxima ${Math.round(d.temperature_2m_max[0])}°C,` +
    ` probabilidad de lluvia ${d.precipitation_probability_max[0]}%.`;
  const manana = d.time.length > 1
    ? ` Mañana: ${WEATHER_CODES[d.weather_code[1]] || ""}, ${Math.round(d.temperature_2m_min[1])}-${Math.round(d.temperature_2m_max[1])}°C, lluvia ${d.precipitation_probability_max[1]}%.`
    : "";
  return hoy + manana;
}

// ---------- Información para el cerebro de KITT ----------
function travelInfo() {
  const partes = [];
  if (gps) {
    partes.push(`UBICACIÓN ACTUAL DEL AUTO: ${placeName || "desconocida"} (lat ${gps.lat.toFixed(5)}, lon ${gps.lon.toFixed(5)}).`);
    if (gps.speedKmh != null) partes.push(`VELOCIDAD ACTUAL: ${gps.speedKmh} km/h.`);
  } else {
    partes.push("UBICACIÓN: el GPS no está disponible ahora.");
  }
  const clima = weatherText();
  if (clima) partes.push("CLIMA EN LA UBICACIÓN ACTUAL: " + clima);
  if (nav) partes.push(`NAVEGACIÓN ACTIVA hacia ${nav.destName}: faltan aprox. ${nav.remainingKm.toFixed(1)} km.`);
  if (music) partes.push(`MÚSICA SONANDO AHORA: ${music.query}.`);

  partes.push(`ACCIONES QUE PUEDES EJECUTAR: si David te pide algo de esto, responde MUY breve y añade AL FINAL una etiqueta oculta:
- Ir a un lugar / ruta / navegar: [ACCION:NAVEGAR|destino] (pon el destino con ciudad, ej. "Parque Sesquicentenario, Riobamba"). El mapa se muestra dentro de ti y das las indicaciones por voz.
- Si pide específicamente Waze: [ACCION:WAZE|destino]
- Cancelar o terminar la ruta: [ACCION:CANCELAR_RUTA|-]
- Poner música / una canción / un artista / una radio: [ACCION:MUSICA|lo que quiere escuchar]
- Detener o quitar la música: [ACCION:PARAR_MUSICA|-]
- Llamar a alguien: [ACCION:LLAMAR|número] solo si conoces el número (por la memoria o porque David lo dijo); si no lo conoces, pídeselo.
Usa como máximo una acción por respuesta. No menciones la etiqueta en tu respuesta.`);
  return partes.join("\n  ");
}

// ---------- Ejecutar acciones ----------
function handleActions(reply) {
  const m = reply.match(/\[ACCION:\s*([A-ZÁÉÍÓÚ_]+)\s*\|\s*(.*?)\]/i);
  const limpio = reply.replace(/\[ACCION:.*?\]/gi, '').trim();
  if (!m) return limpio;
  const tipo = m[1].toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const valor = m[2].trim();

  switch (tipo) {
    case 'NAVEGAR':       startNavigation(valor); break;
    case 'CANCELAR_RUTA': stopNavigation(); break;
    case 'MUSICA':        playMusic(valor); break;
    case 'PARAR_MUSICA':  stopMusic(); break;
    case 'WAZE':   showActionButton({ url: `https://waze.com/ul?q=${encodeURIComponent(valor)}&navigate=yes`, label: `WAZE: ${valor}` }); break;
    case 'LLAMAR': showActionButton({ url: `tel:${valor.replace(/[^\d+]/g, '')}`, label: `LLAMAR: ${valor}` }); break;
  }
  return limpio;
}

function showActionButton(action) {
  const box = document.getElementById('action-box');
  const btn = document.getElementById('action-btn');
  btn.innerText = "▶ " + action.label.toUpperCase();
  btn.onclick = () => { openAction(action.url); box.style.display = 'none'; };
  box.style.display = 'flex';
  clearTimeout(showActionButton._t);
  showActionButton._t = setTimeout(() => { box.style.display = 'none'; }, 60000);
}

function openAction(url) {
  if (url.startsWith('tel:')) { location.href = url; return; }
  window.open(url, '_blank');
}

function closeActionBox() {
  document.getElementById('action-box').style.display = 'none';
}

// ---------- Avisos por voz en cola (para no interrumpir a KITT) ----------
const announceQueue = [];
function announce(text) { announceQueue.push(text); }
setInterval(() => {
  if (!announceQueue.length || typeof kittSay !== 'function') return;
  if (kittSay(announceQueue[0])) announceQueue.shift();
}, 700);

// =====================================================================
//  PANTALLA SIEMPRE ENCENDIDA
// =====================================================================
let wakeLock = null;
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { console.warn("No se pudo mantener la pantalla encendida:", e.message); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && typeof kittStarted !== 'undefined' && kittStarted) keepScreenOn();
});

// =====================================================================
//  NAVEGACIÓN DENTRO DE KITT (mapa + indicaciones por voz)
// =====================================================================
let nav = null;          // { destName, dest:[lat,lon], steps, stepIdx, coords, remainingKm, offRoute, lastReroute }
let navMap = null, navRouteLayer = null, navMeMarker = null, navDestMarker = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((ok, fail) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}

async function geocodeDestination(q) {
  let url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(q)}`;
  if (gps) {
    const d = 0.6;   // buscar primero cerca de donde estás
    url += `&viewbox=${gps.lon - d},${gps.lat + d},${gps.lon + d},${gps.lat - d}`;
  }
  const r = await (await fetch(url)).json();
  if (!r.length) throw new Error("Destino no encontrado");
  return { lat: parseFloat(r[0].lat), lon: parseFloat(r[0].lon), name: r[0].display_name };
}

async function getRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}` +
              `?overview=full&geometries=geojson&steps=true`;
  const r = await (await fetch(url)).json();
  if (r.code !== 'Ok' || !r.routes.length) throw new Error("No hay ruta");
  return r.routes[0];
}

async function startNavigation(destText) {
  try {
    if (!gps) { announce("David, todavía no tengo señal de GPS. Intentaré trazar la ruta en cuanto la tenga."); }
    await loadLeaflet();
    const dest = await geocodeDestination(destText);
    openNavPanel();
    nav = { destName: destText, dest, steps: [], stepIdx: 0, coords: [], remainingKm: 0,
            offRoute: 0, lastReroute: 0, announcedNear: false };
    if (gps) await computeRoute(true);
    else drawDestinationOnly();
  } catch (e) {
    console.warn("Navegación:", e);
    announce(`Lo siento, David. No encontré una ruta hacia ${destText}.`);
  }
}

function drawDestinationOnly() {
  if (navDestMarker) navMap.removeLayer(navDestMarker);
  navDestMarker = L.circleMarker([nav.dest.lat, nav.dest.lon], { radius: 9, color: '#22e03a', fillOpacity: 1 }).addTo(navMap);
  navMap.setView([nav.dest.lat, nav.dest.lon], 15);
}

async function computeRoute(first) {
  const route = await getRoute(gps, nav.dest);
  nav.steps = route.legs[0].steps;
  nav.stepIdx = 1;   // el paso 0 es la salida
  nav.coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
  nav.remainingKm = route.distance / 1000;
  nav.lastReroute = Date.now();
  nav.offRoute = 0;
  nav.announcedNear = false;

  if (navRouteLayer) navMap.removeLayer(navRouteLayer);
  navRouteLayer = L.polyline(nav.coords, { color: '#ff2a2a', weight: 6, opacity: 0.9 }).addTo(navMap);
  drawDestinationOnly();
  navMap.fitBounds(navRouteLayer.getBounds(), { padding: [30, 30] });
  updateNavInfo(route.duration);

  const min = Math.max(1, Math.round(route.duration / 60));
  if (first) {
    const primera = nav.steps[1] ? " " + stepText(nav.steps[1]) : "";
    announce(`Ruta trazada, David: ${nav.remainingKm.toFixed(1)} kilómetros, unos ${min} minutos.${primera}`);
  } else {
    announce("Recalculando ruta.");
  }
}

function updateNavInfo(durationSec) {
  const el = document.getElementById('nav-info');
  if (!el || !nav) return;
  const next = nav.steps[nav.stepIdx];
  const eta = durationSec ? ` · ${Math.max(1, Math.round(durationSec / 60))} MIN` : "";
  el.innerText = `${nav.remainingKm.toFixed(1)} KM${eta}` + (next ? ` · ${stepText(next).toUpperCase()}` : "");
}

const DIRS = {
  left: "gira a la izquierda", right: "gira a la derecha", 'slight left': "mantente a la izquierda",
  'slight right': "mantente a la derecha", 'sharp left': "gira bruscamente a la izquierda",
  'sharp right': "gira bruscamente a la derecha", uturn: "da la vuelta en U", straight: "sigue recto"
};

function stepText(step) {
  const man = step.maneuver || {};
  const via = step.name ? ` por ${step.name}` : "";
  switch (man.type) {
    case 'arrive': return "Llegarás a tu destino";
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return `En la redondela, toma la ${man.exit || 1}ª salida${via}`;
    case 'merge': return `Incorpórate${via}`;
    case 'fork': return `En la bifurcación, ${DIRS[man.modifier] || "continúa"}${via}`;
    case 'end of road': return `Al final de la calle, ${DIRS[man.modifier] || "gira"}${via}`;
    case 'new name': case 'continue': return `Continúa${via}`;
    default: {
      const d = DIRS[man.modifier] || "continúa";
      return d.charAt(0).toUpperCase() + d.slice(1) + via;
    }
  }
}

// Distancia mínima (km) del auto a la línea de la ruta
function distanceToRouteKm(lat, lon) {
  let min = Infinity;
  for (let i = 0; i < nav.coords.length; i += 3) {
    const d = distanceKm(lat, lon, nav.coords[i][0], nav.coords[i][1]);
    if (d < min) min = d;
  }
  return min;
}

function onNavPosition() {
  if (!nav || !navMap || !gps) return;
  const here = [gps.lat, gps.lon];

  if (!navMeMarker) navMeMarker = L.circleMarker(here, { radius: 8, color: '#ffffff', fillColor: '#ff2a2a', fillOpacity: 1 }).addTo(navMap);
  else navMeMarker.setLatLng(here);

  // Si todavía no había ruta (no había GPS), calcularla ahora
  if (!nav.coords.length) { computeRoute(true).catch(() => {}); return; }

  navMap.panTo(here, { animate: true });

  // ¿Llegamos?
  const toDest = distanceKm(gps.lat, gps.lon, nav.dest.lat, nav.dest.lon);
  nav.remainingKm = toDest;
  if (toDest < 0.04) {
    announce(`Has llegado a tu destino, David.`);
    stopNavigation(true);
    return;
  }

  // ¿Nos salimos de la ruta? → recalcular
  if (distanceToRouteKm(gps.lat, gps.lon) > 0.08) nav.offRoute++; else nav.offRoute = 0;
  if (nav.offRoute >= 3 && Date.now() - nav.lastReroute > 20000) {
    computeRoute(false).catch(() => {});
    return;
  }

  // Indicaciones paso a paso
  const step = nav.steps[nav.stepIdx];
  if (step) {
    const [slon, slat] = step.maneuver.location;
    const d = distanceKm(gps.lat, gps.lon, slat, slon) * 1000;   // metros
    if (!nav.announcedNear && d < 150 && d > 35) {
      announce(`En ${Math.round(d / 10) * 10} metros, ${stepText(step).charAt(0).toLowerCase() + stepText(step).slice(1)}.`);
      nav.announcedNear = true;
    } else if (d <= 35) {
      if (!nav.announcedNear) announce(stepText(step) + ".");
      nav.stepIdx++;
      nav.announcedNear = false;
    }
  }
  updateNavInfo();
}

function openNavPanel() {
  document.getElementById('nav-panel').style.display = 'flex';
  if (!navMap) {
    navMap = L.map('nav-map', { zoomControl: false, attributionControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap © CARTO'
    }).addTo(navMap);
    navMap.setView(gps ? [gps.lat, gps.lon] : [-1.6636, -78.6546], 15);
  }
  setTimeout(() => navMap.invalidateSize(), 200);
}

function stopNavigation(silent) {
  nav = null;
  if (navMap) {
    if (navRouteLayer) { navMap.removeLayer(navRouteLayer); navRouteLayer = null; }
    if (navDestMarker) { navMap.removeLayer(navDestMarker); navDestMarker = null; }
  }
  document.getElementById('nav-panel').style.display = 'none';
  if (silent !== true) document.getElementById('status').innerText = "RUTA CANCELADA";
}

function openInGoogleMaps() {
  if (!nav) return;
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${nav.dest.lat},${nav.dest.lon}&travelmode=driving`, '_blank');
}

// =====================================================================
//  MÚSICA DENTRO DE KITT (YouTube incrustado, o radio por internet)
// =====================================================================
let music = null;   // { query, kind: 'youtube'|'radio', el }
const PIPED = ['https://api.piped.private.coffee', 'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de'];

async function searchYoutubeIds(q) {
  for (const base of PIPED) {
    try {
      const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`);
      if (!r.ok) continue;
      const d = await r.json();
      const ids = (d.items || []).filter(i => i.type === 'stream' && i.url)
        .map(i => (i.url.match(/v=([\w-]{11})/) || [])[1]).filter(Boolean);
      if (ids.length) return ids.slice(0, 10);
    } catch (e) { /* probar el siguiente servidor */ }
  }
  return [];
}

async function searchRadio(q) {
  const base = 'https://all.api.radio-browser.info/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=1';
  for (const p of [`&name=${encodeURIComponent(q)}`, `&tag=${encodeURIComponent(q.toLowerCase())}`]) {
    try {
      const d = await (await fetch(base + p)).json();
      if (d.length && d[0].url_resolved) return d[0];
    } catch (e) {}
  }
  return null;
}

async function playMusic(q) {
  stopMusic(true);
  document.getElementById('music-title').innerText = "BUSCANDO: " + q.toUpperCase();
  document.getElementById('music-bar').style.display = 'flex';

  const ids = await searchYoutubeIds(q);
  const holder = document.getElementById('music-player');
  if (ids.length) {
    const [first, ...rest] = ids;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${first}?autoplay=1&enablejsapi=1&playsinline=1` +
                 (rest.length ? `&playlist=${rest.join(',')}` : '');
    iframe.allow = 'autoplay; encrypted-media';
    iframe.width = '220'; iframe.height = '124';
    holder.appendChild(iframe);
    music = { query: q, kind: 'youtube', el: iframe, volume: 100 };
    document.getElementById('music-title').innerText = "♪ " + q.toUpperCase();
    return;
  }

  const station = await searchRadio(q);
  if (station) {
    const audio = new Audio(station.url_resolved);
    audio.play().catch(() => {});
    holder.appendChild(audio);
    music = { query: q, kind: 'radio', el: audio, volume: 100 };
    document.getElementById('music-title').innerText = "📻 " + station.name.trim().toUpperCase();
    return;
  }

  document.getElementById('music-bar').style.display = 'none';
  showActionButton({ url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, label: `YOUTUBE: ${q}` });
}

function stopMusic(silent) {
  if (music) {
    if (music.kind === 'radio') music.el.pause();
    music.el.remove();
  }
  music = null;
  document.getElementById('music-player').innerHTML = '';
  document.getElementById('music-bar').style.display = 'none';
}

function setMusicVolume(v) {
  if (!music || music.volume === v) return;
  music.volume = v;
  if (music.kind === 'radio') music.el.volume = v / 100;
  else music.el.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [v] }), '*');
}

// Bajar la música mientras KITT escucha o habla (para que te entienda)
setInterval(() => {
  if (!music) return;
  const ocupado = (typeof isListening !== 'undefined' && isListening) || (typeof isSpeaking !== 'undefined' && isSpeaking);
  setMusicVolume(ocupado ? 15 : 100);
}, 300);
