// =====================================================================
//  K.I.T.T. - VISIÓN: inicio con saludo, cámara y reconocimiento de caras
//  Las caras registradas se guardan SOLO en este aparato (localStorage).
// =====================================================================

const FACE_LIB_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/',
  'https://unpkg.com/@vladmandic/face-api@1.7.13/'
];
let faceLibBase = null;

let kittStarted = false;
let camStream = null;
let camTimer = null;
let modelsReady = false;
let scanning = false;
let faceMatcher = null;
let knownFaces = [];
try { knownFaces = JSON.parse(localStorage.getItem('kitt_faces')) || []; } catch (e) { knownFaces = []; }

let presentNames = [];      // personas registradas que la cámara ve ahora
let unknownCount = 0;       // caras que no reconoce
let lastGreet = {};         // nombre -> hora del último saludo
let lastCompanionGreet = 0;

const GREET_AGAIN_MIN = 30;     // volver a saludar a la misma persona después de 30 min
const COMPANION_AGAIN_MIN = 10; // aviso de acompañante desconocido cada 10 min como máximo

// ---------- Utilidades ----------
function saludoHora() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

// KITT habla por iniciativa propia (sin que le pregunten)
function kittSay(text) {
  if (!kittStarted || isSpeaking || isProcessing) return false;
  try { recognition.abort(); } catch (e) {}
  isListening = false;
  document.getElementById('transcript').innerText = `KITT: "${text}"`;
  speak(text);
  return true;
}

// Información para el cerebro de KITT: quién está en el auto
function presenceInfo() {
  if (!camStream) return "";
  const partes = [];
  if (presentNames.length) partes.push("Personas reconocidas por la cámara ahora mismo: " + presentNames.join(", ") + ".");
  if (unknownCount) partes.push(`Además hay ${unknownCount} persona(s) que no conoces.`);
  if (!partes.length) partes.push("La cámara no ve a nadie en este momento.");
  return "CÁMARA DEL AUTO: " + partes.join(" ");
}

// ---------- Pantalla de inicio ----------
function startKitt() {
  document.getElementById('start-screen').style.display = 'none';
  kittStarted = true;

  if (!API_KEY) configApiKey();

  // Despierta el audio (los navegadores lo exigen después de un toque)
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch (e) {}

  // Encender la cámara si estaba encendida la última vez
  if (localStorage.getItem('kitt_cam') === 'on') startCamera();

  // Saludo inicial y luego conversación automática
  if (API_KEY) {
    autoMode = true;
    updateTalkButton();
  }
  const saludo = `${saludoHora()}, David. Todos los sistemas de K.I.T.T. en línea. ¿A dónde vamos hoy?`;
  document.getElementById('transcript').innerText = `KITT: "${saludo}"`;
  isProcessing = false;
  speak(saludo);
}

// ---------- Carga de la librería de caras ----------
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}

async function loadFaceModels() {
  if (modelsReady) return;
  document.getElementById('status').innerText = "CARGANDO SISTEMA DE VISIÓN...";
  for (const base of FACE_LIB_SOURCES) {
    try {
      if (typeof faceapi === 'undefined') await loadScript(base + 'dist/face-api.js');
      const models = base + 'model/';
      await faceapi.nets.tinyFaceDetector.loadFromUri(models);
      await faceapi.nets.faceLandmark68Net.loadFromUri(models);
      await faceapi.nets.faceRecognitionNet.loadFromUri(models);
      faceLibBase = base;
      modelsReady = true;
      buildMatcher();
      document.getElementById('status').innerText = "VISIÓN EN LÍNEA";
      return;
    } catch (e) {
      console.warn("No se pudo cargar la visión desde", base, e);
    }
  }
  throw new Error("No se pudo cargar el sistema de visión (¿hay internet?)");
}

function buildMatcher() {
  if (!modelsReady || !knownFaces.length) { faceMatcher = null; return; }
  const labeled = knownFaces.map(f =>
    new faceapi.LabeledFaceDescriptors(f.name, f.descriptors.map(d => new Float32Array(d))));
  faceMatcher = new faceapi.FaceMatcher(labeled, 0.5);
}

const detectorOptions = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

// ---------- Cámara ----------
async function startCamera() {
  try {
    await loadFaceModels();
    const savedId = localStorage.getItem('kitt_cam_id');
    const videoOpts = savedId
      ? { deviceId: { exact: savedId }, width: 640, height: 480 }
      : { facingMode: 'user', width: 640, height: 480 };
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: videoOpts, audio: false });
    } catch (e) {
      // La cámara guardada ya no existe: usar la de siempre
      localStorage.removeItem('kitt_cam_id');
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    }
    const track = camStream.getVideoTracks()[0];
    console.log("Cámara en uso:", track.label);
    blackFrames = 0;
    await refreshCameraList();
    const video = document.getElementById('cam-video');
    video.srcObject = camStream;
    await video.play();
    document.getElementById('cam-box').style.display = 'block';
    document.getElementById('btn-cam').innerText = "APAGAR CÁMARA";
    localStorage.setItem('kitt_cam', 'on');
    clearInterval(camTimer);
    camTimer = setInterval(scanFaces, 1500);
  } catch (e) {
    console.error("Cámara:", e);
    document.getElementById('status').innerText = "CÁMARA NO DISPONIBLE";
    stopCamera(false);
  }
}

function stopCamera(save = true) {
  clearInterval(camTimer);
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null;
  presentNames = []; unknownCount = 0;
  document.getElementById('cam-box').style.display = 'none';
  document.getElementById('btn-cam').innerText = "CÁMARA";
  if (save) localStorage.setItem('kitt_cam', 'off');
}

function toggleCamera() {
  if (camStream) stopCamera(); else startCamera();
}

// ---------- Reconocimiento continuo ----------
async function scanFaces() {
  if (scanning || !modelsReady || !camStream) return;
  scanning = true;
  try {
    const video = document.getElementById('cam-video');
    // ¿La imagen está completamente negra? (cámara tapada, apagada o la equivocada)
    if (isFrameBlack(video)) {
      blackFrames++;
      document.getElementById('cam-label').innerText = "IMAGEN NEGRA - CÁMBIALA CON ⟳";
      if (blackFrames === 4 && cameraList.length > 1 && !autoSwitched) {
        autoSwitched = true;
        console.warn("Imagen negra: probando otra cámara automáticamente");
        switchCamera();
      }
      return;
    }
    blackFrames = 0;

    const dets = await faceapi.detectAllFaces(video, detectorOptions())
      .withFaceLandmarks().withFaceDescriptors();

    const names = [];
    let unknown = 0;
    let biggestUnknown = null;
    for (const d of dets) {
      if (faceMatcher) {
        const m = faceMatcher.findBestMatch(d.descriptor);
        if (m.label !== 'unknown') { names.push(m.label); continue; }
      }
      unknown++;
      if (!biggestUnknown || d.detection.box.area > biggestUnknown.detection.box.area) biggestUnknown = d;
    }
    // Guardar muestras del rostro nuevo mientras KITT pregunta si registrarlo
    unknownStreak = unknown ? unknownStreak + 1 : 0;
    if (biggestUnknown) lastUnknownDescriptor = Array.from(biggestUnknown.descriptor);
    if (pendingFace && biggestUnknown && pendingFace.samples.length < 6) {
      pendingFace.samples.push(Array.from(biggestUnknown.descriptor));
    }
    presentNames = [...new Set(names)];
    unknownCount = unknown;

    document.getElementById('cam-label').innerText =
      dets.length === 0 ? "SIN OCUPANTES DETECTADOS"
        : [...presentNames, ...(unknown ? [`${unknown} DESCONOCIDO(S)`] : [])].join(" · ").toUpperCase();

    greetPeople(dets.length);
  } catch (e) {
    console.warn("Error al analizar la cámara:", e);
  } finally {
    scanning = false;
  }
}

function greetPeople(totalFaces) {
  const now = Date.now();

  // 1) Saludar por su nombre a las personas registradas
  for (const n of presentNames) {
    if (!lastGreet[n] || now - lastGreet[n] > GREET_AGAIN_MIN * 60000) {
      if (kittSay(`${saludoHora()}, ${n}. Qué gusto tenerte a bordo.`)) lastGreet[n] = now;
      return;
    }
  }

  // 2) Rostro nuevo: preguntar si se registra (se ve al menos 3 veces seguidas = ~4 s)
  if (unknownCount > 0 && unknownStreak >= 3 && !pendingFace &&
      now - lastNewFaceAsk > ASK_AGAIN_MIN * 60000 && lastUnknownDescriptor) {
    const pregunta = totalFaces >= 2
      ? "Detecto un acompañante nuevo a bordo. ¿Quieres que registre su rostro?"
      : "Detecto un rostro nuevo. ¿Quieres que lo registre?";
    if (kittSay(pregunta)) {
      lastNewFaceAsk = now;
      pendingFace = { stage: 'confirm', samples: [lastUnknownDescriptor], time: now };
    }
  }
}

// ---------- Registro de caras ----------
function toggleFacesModal() {
  const box = document.getElementById('faces-box');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  renderFacesList();
  box.style.display = 'block';
}

function renderFacesList() {
  const list = document.getElementById('faces-list');
  list.innerHTML = knownFaces.length
    ? knownFaces.map((f, i) =>
        `<li>${f.name} <button class="mini" onclick="deleteFace(${i})">BORRAR</button></li>`).join('')
    : '<li>Nadie registrado todavía.</li>';
}

async function registerFace() {
  const input = document.getElementById('face-name');
  const name = input.value.trim();
  const msg = document.getElementById('faces-msg');
  if (!name) { msg.innerText = "Escribe el nombre de la persona."; return; }

  if (!camStream) {
    msg.innerText = "Encendiendo la cámara...";
    await startCamera();
    if (!camStream) { msg.innerText = "No se pudo encender la cámara."; return; }
  }

  msg.innerText = `${name}: mira a la cámara y mueve un poco la cabeza...`;
  const video = document.getElementById('cam-video');
  const samples = [];
  for (let i = 0; i < 8 && samples.length < 5; i++) {
    await new Promise(r => setTimeout(r, 500));
    const d = await faceapi.detectSingleFace(video, detectorOptions())
      .withFaceLandmarks().withFaceDescriptor();
    if (d) samples.push(Array.from(d.descriptor));
  }

  if (samples.length < 3) {
    msg.innerText = "No vi bien la cara. Busca más luz y vuelve a intentar.";
    return;
  }

  const existing = knownFaces.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.descriptors.push(...samples);
  else knownFaces.push({ name, descriptors: samples });
  localStorage.setItem('kitt_faces', JSON.stringify(knownFaces));
  buildMatcher();
  lastGreet[name] = Date.now();   // no saludar enseguida a quien se acaba de registrar

  input.value = '';
  msg.innerText = `✔ ${name} registrado.`;
  renderFacesList();
  kittSay(`Registro completado. Encantado de conocerte, ${name}.`);
}

function deleteFace(i) {
  if (!confirm(`¿Borrar a ${knownFaces[i].name} del reconocimiento?`)) return;
  knownFaces.splice(i, 1);
  localStorage.setItem('kitt_faces', JSON.stringify(knownFaces));
  buildMatcher();
  renderFacesList();
}


// ---------- Elegir cámara ----------
let cameraList = [];
let blackFrames = 0;
let autoSwitched = false;
const _probe = document.createElement('canvas');
_probe.width = 32; _probe.height = 24;

function isFrameBlack(video) {
  if (!video.videoWidth) return true;
  const ctx = _probe.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, 32, 24);
  const px = ctx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
  return sum / (px.length / 4 * 3) < 6;   // brillo promedio casi cero
}

async function refreshCameraList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  cameraList = devices.filter(d => d.kind === 'videoinput');
  console.log("Cámaras encontradas:", cameraList.map(d => d.label || d.deviceId));
  const sel = document.getElementById('cam-select');
  if (!sel) return;
  const current = camStream?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.innerHTML = cameraList.map((d, i) =>
    `<option value="${d.deviceId}" ${d.deviceId === current ? 'selected' : ''}>${d.label || 'Cámara ' + (i + 1)}</option>`).join('');
}

async function chooseCamera(deviceId) {
  localStorage.setItem('kitt_cam_id', deviceId);
  stopCamera(false);
  await startCamera();
}

async function switchCamera() {
  if (cameraList.length < 2) {
    document.getElementById('cam-label').innerText = "SOLO HAY UNA CÁMARA";
    return;
  }
  const current = camStream?.getVideoTracks()[0]?.getSettings().deviceId;
  const idx = cameraList.findIndex(d => d.deviceId === current);
  const next = cameraList[(idx + 1) % cameraList.length];
  await chooseCamera(next.deviceId);
}


// ---------- Diálogo por voz para registrar un rostro nuevo ----------
let pendingFace = null;          // { stage: 'confirm' | 'name', samples: [...], time }
let unknownStreak = 0;
let lastUnknownDescriptor = null;
let lastNewFaceAsk = 0;
const ASK_AGAIN_MIN = 3;         // si dices que no, vuelve a preguntar después de 3 minutos

function normalizar(t) {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[.,;:!¡?¿"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extraerNombre(texto) {
  let t = texto.replace(/[.,;:!¡?¿"]/g, ' ').trim();
  t = t.replace(/^(se llama|me llamo|mi nombre es|su nombre es|es|soy|registralo como|regístralo como|ponle|llamalo|llámalo)\s+/i, '');
  const palabras = t.split(/\s+/).filter(Boolean).slice(0, 2);
  return palabras.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

function kittReply(text) {
  document.getElementById('transcript').innerText = `KITT: "${text}"`;
  speak(text);
}

// Devuelve true si la frase era parte del registro (y no debe ir a Gemini)
async function handleFaceDialog(userText) {
  if (!pendingFace) return false;
  if (Date.now() - pendingFace.time > 90000) { pendingFace = null; return false; }   // se venció
  const t = normalizar(userText);

  if (pendingFace.stage === 'confirm') {
    if (/^(si|claro|dale|ok|okay|bueno|por favor|registralo|registrala|hazlo|afirmativo|de acuerdo)\b/.test(t)) {
      pendingFace.stage = 'name';
      pendingFace.time = Date.now();
      kittReply("Perfecto. ¿Cuál es su nombre?");
      return true;
    }
    if (/^(no|nunca|despues|luego|negativo|todavia no|ahora no)\b/.test(t)) {
      pendingFace = null;
      kittReply("Entendido, David. No lo registraré.");
      return true;
    }
    pendingFace = null;          // habló de otra cosa: seguir la conversación normal
    return false;
  }

  if (pendingFace.stage === 'name') {
    const name = extraerNombre(userText);
    if (!name) { kittReply("No entendí el nombre. ¿Me lo repites?"); return true; }
    const samples = pendingFace.samples;
    pendingFace = null;
    if (samples.length < 2) {
      kittReply("No logré captar bien el rostro. Pídele que mire a la cámara y lo intentamos de nuevo.");
      lastNewFaceAsk = 0;
      return true;
    }
    const existing = knownFaces.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.descriptors.push(...samples);
    else knownFaces.push({ name, descriptors: samples });
    localStorage.setItem('kitt_faces', JSON.stringify(knownFaces));
    buildMatcher();
    lastGreet[name] = Date.now();
    renderFacesList();
    kittReply(`Registro completado. Encantado de conocerte, ${name}.`);
    return true;
  }
  return false;
}

// Conectar el diálogo con lo que escucha KITT (voz y texto)
const _processWithKittOriginal = processWithKitt;
processWithKitt = async function (userText) {
  if (await handleFaceDialog(userText)) return;
  return _processWithKittOriginal(userText);
};
