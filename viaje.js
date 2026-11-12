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

  partes.push(`ACCIONES QUE PUEDES EJECUTAR: si David te pide algo de esto, responde brevemente y añade AL FINAL una etiqueta oculta:
- Ir a un lugar / ruta / navegar: [ACCION:NAVEGAR|destino] (pon el destino con ciudad, ej. "Parque Sesquicentenario, Riobamba"). Si pide usar Waze: [ACCION:WAZE|destino]
- Poner música / una canción / un artista: [ACCION:MUSICA|lo que quiere escuchar]
- Llamar a alguien: [ACCION:LLAMAR|número] solo si conoces el número (por la memoria o porque David lo dijo); si no lo conoces, pídeselo.
Usa como máximo una acción por respuesta. No menciones la etiqueta en tu respuesta.`);
  return partes.join("\n  ");
}

// ---------- Ejecutar acciones ----------
function buildActionUrl(tipo, valor) {
  const q = encodeURIComponent(valor);
  switch (tipo) {
    case 'NAVEGAR': return { url: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`, label: `RUTA A ${valor}` };
    case 'WAZE':    return { url: `https://waze.com/ul?q=${q}&navigate=yes`, label: `WAZE: ${valor}` };
    case 'MUSICA':  return { url: `https://www.youtube.com/results?search_query=${q}`, label: `MÚSICA: ${valor}` };
    case 'LLAMAR':  return { url: `tel:${valor.replace(/[^\d+]/g, '')}`, label: `LLAMAR: ${valor}` };
  }
  return null;
}

// Se llama desde kitt.js con la respuesta de Gemini; devuelve el texto sin etiquetas
function handleActions(reply) {
  const m = reply.match(/\[ACCION:\s*(NAVEGAR|WAZE|MUSICA|MÚSICA|LLAMAR)\s*\|\s*(.*?)\]/i);
  const limpio = reply.replace(/\[ACCION:.*?\]/gi, '').trim();
  if (!m) return limpio;

  const tipo = m[1].toUpperCase().replace('Ú', 'U');
  const action = buildActionUrl(tipo, m[2].trim());
  if (!action) return limpio;
  showActionButton(action);
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
