let API_KEY = localStorage.getItem('kitt_api_key') || '';
let memories = JSON.parse(localStorage.getItem('kitt_memories')) || [];
let chatHistory = [];
let isListening = false;
let isSpeaking = false;
let waveInterval = null;

// Crear LEDs del modulador
const rows = 10;
for (let c = 0; c < 3; c++) {
  const col = document.getElementById(`col-${c}`);
  for (let r = 0; r < rows; r++) {
    const led = document.createElement('div');
    led.className = 'led';
    led.id = `led-${c}-${r}`;
    col.appendChild(led);
  }
}
updateMemoryCount();

// Animación de luces al hablar
function startWave() {
  if (waveInterval) clearInterval(waveInterval);
  waveInterval = setInterval(() => {
    const centerLevel = Math.floor(Math.random() * 8) + 2;
    const sideLevel = Math.max(1, centerLevel - 2);
    setColumnLeds(1, centerLevel);
    setColumnLeds(0, sideLevel);
    setColumnLeds(2, sideLevel);
  }, 90);
}

function stopWave() {
  clearInterval(waveInterval);
  setColumnLeds(0, 0);
  setColumnLeds(1, 0);
  setColumnLeds(2, 0);
}

function setColumnLeds(colIndex, level) {
  const mid = Math.floor(rows / 2);
  for (let r = 0; r < rows; r++) {
    const dist = Math.abs(r - mid);
    const led = document.getElementById(`led-${colIndex}-${r}`);
    if (level > 0 && dist < Math.ceil(level / 2)) {
      led.classList.add('active');
    } else {
      led.classList.remove('active');
    }
  }
}

function configApiKey() {
  const key = prompt("Ingresa tu Google Gemini API Key:", API_KEY);
  if (key) {
    API_KEY = key.trim();
    localStorage.setItem('kitt_api_key', API_KEY);
    alert("API Key guardada correctamente.");
  }
}

function updateMemoryCount() {
  document.getElementById('mem-count').innerText = `MEMORIAS: ${memories.length}`;
}

// Reconocimiento de voz (Oídos)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = 'es-EC';
recognition.continuous = false;
recognition.interimResults = false;

// ===== MODO CONVERSACIÓN AUTOMÁTICA =====
// Al activar KITT, escucha -> responde -> vuelve a escuchar solo, hasta que lo detengas
let autoMode = false;
let isProcessing = false;

function updateTalkButton() {
  document.getElementById('btn-talk').innerText = autoMode ? "DETENER KITT" : "HABLAR CON KITT";
}

function startListening() {
  if (!autoMode || isListening || isSpeaking || isProcessing) return;
  try { recognition.start(); } catch (e) { /* ya estaba escuchando */ }
}

// Se llama cuando KITT termina de hablar
function afterSpeech() {
  updateTalkButton();
  if (autoMode) setTimeout(startListening, 400);
}

recognition.onstart = () => {
  isListening = true;
  listenStartedAt = Date.now();
  document.getElementById('status').innerText = "ESCUCHANDO...";
};

recognition.onresult = async (event) => {
  const userText = event.results[0][0].transcript;
  document.getElementById('transcript').innerText = `David: "${userText}"`;
  await processWithKitt(userText);
};

recognition.onerror = (event) => {
  isListening = false;
  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
    autoMode = false;
    document.getElementById('status').innerText = "SIN PERMISO DE MICRÓFONO";
    updateTalkButton();
  }
};

recognition.onend = () => {
  isListening = false;
  if (autoMode && !isSpeaking && !isProcessing) {
    // Silencio o fin de frase: volver a escuchar automáticamente
    setTimeout(startListening, 300);
  } else if (!autoMode && !isSpeaking) {
    document.getElementById('status').innerText = "EN ESPERA";
  }
};

function toggleConversation() {
  if (!API_KEY) {
    configApiKey();
    return;
  }
  if (autoMode) {
    // Detener todo
    autoMode = false;
    try { recognition.abort(); } catch (e) {}
    stopSpeaking();
    document.getElementById('status').innerText = "EN ESPERA";
    updateTalkButton();
    return;
  }
  autoMode = true;
  if (isSpeaking) stopSpeaking();
  updateTalkButton();
  startListening();
}

// Modelos a probar en orden: si uno está saturado, se usa el siguiente
const KITT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

async function askGemini(systemPrompt) {
  const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models/";
  let lastError = null;

  for (const model of KITT_MODELS) {
    for (let intento = 1; intento <= 2; intento++) {
      const response = await fetch(`${baseUrl}${model}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: chatHistory
        })
      });
      const data = await response.json();

      if (response.ok && data.candidates) return data;

      console.warn(`Modelo ${model} (intento ${intento}) falló:`, data);
      lastError = new Error(data.error?.message || "Respuesta inválida");

      // Solo reintentar si Google está saturado (503) o por límite de uso (429)
      if (response.status !== 503 && response.status !== 429) break;
      document.getElementById('status').innerText = "RECALIBRANDO ENLACE...";
      await new Promise(r => setTimeout(r, 1500 * intento));
    }
  }
  throw lastError;
}

// Cerebro y Memoria con Gemini
async function processWithKitt(userText) {
  if (!API_KEY) {
    configApiKey();
    return;
  }

  isProcessing = true;
  document.getElementById('status').innerText = "PROCESANDO...";

  const systemPrompt = `Eres K.I.T.T., una inteligencia artificial autónoma instalada en el vehículo clásico de David. 
  Llama siempre a tu piloto por su nombre: David.
  Tu personalidad es leal, analítica, protectora con David, educada y con un ligero toque de humor seco o sarcasmo elegante.
  Habla de forma natural, concisa y directa (ideal para conversar mientras se conduce, sin textos largos ni listas).
  
  MEMORIAS GUARDADAS DE DAVID Y EL AUTO:
  ${memories.length > 0 ? memories.join('\n- ') : 'Aún no hay recuerdos previos.'}
  
  ${modeInstruction()}

  ${typeof presenceInfo === 'function' ? presenceInfo() : ''}

  ${typeof travelInfo === 'function' ? travelInfo() : ''}

  INSTRUCCIÓN DE MEMORIA: Si David menciona algún dato nuevo e importante sobre sí mismo, sus gustos, planes, mantenimiento del auto o experiencias, al final de tu respuesta añade exactamente una etiqueta oculta así: [MEMORIA: dato resumido en una frase corta]. Si no hay nada nuevo que recordar, no pongas la etiqueta.`;

  chatHistory.push({ role: "user", parts: [{ text: userText }] });
  if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);

  try {
    const data = await askGemini(systemPrompt);

    // Unir TODAS las partes del texto (Gemini a veces divide la respuesta en varios pedazos)
    const cand = data.candidates[0];
    let reply = (cand.content?.parts || [])
      .filter(p => p.text && !p.thought)
      .map(p => p.text)
      .join('')
      .trim();
    if (cand.finishReason && cand.finishReason !== 'STOP') {
      console.warn("La respuesta terminó por:", cand.finishReason);
    }
    if (!reply) reply = "Mis disculpas, David. No logré formular una respuesta.";

    // Extraer nueva memoria
    const memMatch = reply.match(/\[MEMORIA:\s*(.*?)\]/);
    if (memMatch) {
      const newFact = memMatch[1].trim();
      memories.push(`${new Date().toLocaleDateString()}: ${newFact}`);
      localStorage.setItem('kitt_memories', JSON.stringify(memories));
      updateMemoryCount();
      reply = reply.replace(/\[MEMORIA:.*?\]/, '').trim();
    }

    isProcessing = false;
    if (typeof handleActions === 'function') reply = handleActions(reply);
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
    document.getElementById('transcript').innerText = `KITT: "${reply}"`;
    speak(reply);

  } catch (error) {
    isProcessing = false;
    console.error(error);
    document.getElementById('status').innerText = "ERROR DE CONEXIÓN";
    speak("Mis disculpas, David. Tengo problemas para enlazar con mi núcleo de datos.");
  }
}
// Voz mejorada de KITT
function speak(text) {
  if (!voiceEnabled) {
    // Voz apagada: solo una animación corta de luces
    startWave();
    setTimeout(() => {
      stopWave();
      document.getElementById('status').innerText = "EN ESPERA";
      afterSpeech();
    }, 1200);
    return;
  }
  isSpeaking = true;
  document.getElementById('status').innerText = "K.I.T.T. HABLANDO...";
  if (voiceType === 'rapida') {
    // En celulares (Android) casi nunca hay voz de hombre en el navegador:
    // en ese caso se usa la voz de Google (VOZ KITT), que sí es masculina
    waitForVoices().then(voices => {
      if (pickKittVoice(voices)) { speakBrowser(text); return; }
      if (!avisoSinVozHombre) {
        avisoSinVozHombre = true;
        console.warn("Este aparato no tiene voz de hombre en español: uso la voz de Google.");
      }
      speakGemini(text).catch(() => speakBrowser(text));
    });
    return;
  }
  speakGemini(text).catch(err => {
    console.warn("Voz de Gemini no disponible, uso la voz del navegador:", err);
    speakBrowser(text);
  });
}

// Voz de respaldo (la del navegador)
// ---- Elegir UNA voz de hombre y usar SIEMPRE la misma ----
const VOCES_HOMBRE = ['Jorge', 'Luis', 'Alvaro', 'Gonzalo', 'Tomas', 'Lorenzo', 'Alex', 'Andres', 'Emilio',
                      'Federico', 'Gerardo', 'Mateo', 'Sebastian', 'Mario', 'Rodrigo', 'Carlos', 'Roberto',
                      'Raul', 'Pablo', 'Alonso', 'Arnau', 'Dario', 'Saul', 'Teo', 'Yago', 'Javier', 'Marcelo'];
let kittVoiceName = localStorage.getItem('kitt_voice_name') || null;
let avisoSinVozHombre = false;

// Las voces de Edge cargan con retraso: esperar hasta que estén listas
function waitForVoices() {
  return new Promise(resolve => {
    const ya = window.speechSynthesis.getVoices();
    if (ya.length) return resolve(ya);
    const t = setTimeout(() => resolve(window.speechSynthesis.getVoices()), 2500);
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      clearTimeout(t);
      resolve(window.speechSynthesis.getVoices());
    }, { once: true });
  });
}

function pickKittVoice(allVoices) {
  const voices = allVoices.filter(v => v.lang.toLowerCase().startsWith('es'));
  // 1) la voz que ya se usó antes (para que nunca cambie)
  if (kittVoiceName) {
    const misma = voices.find(v => v.name === kittVoiceName);
    if (misma) return misma;
  }
  const esHombre = v => VOCES_HOMBRE.some(n => v.name.includes(n));
  // 2) voz natural (no robótica) de hombre, preferir Latinoamérica
  const elegida = voices.find(v => esHombre(v) && v.name.includes('Natural') && /Ecuador|Mexico|México|Colombia/i.test(v.name))
               || voices.find(v => esHombre(v) && v.name.includes('Natural'))
               || voices.find(v => esHombre(v));
  if (elegida && elegida.name.includes('Natural')) {
    kittVoiceName = elegida.name;                       // recordar solo las voces buenas
    localStorage.setItem('kitt_voice_name', kittVoiceName);
  }
  return elegida || null;
}

async function speakBrowser(text, onDone, intento = 1) {
  isSpeaking = true;
  document.getElementById('status').innerText = "K.I.T.T. HABLANDO...";

  const voice = pickKittVoice(await waitForVoices());
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
    console.log("Voz usada:", voice.name);
  } else {
    utterance.lang = 'es-MX';
    console.warn("No encontré voz de hombre en español.");
  }
  utterance.pitch = 0.95;
  utterance.rate = MODES[kittMode].rate;

  utterance.onstart = () => startWave();
  let terminado = false;
  const terminar = () => {
    if (terminado) return;          // evitar que se ejecute dos veces
    terminado = true;
    kittUtterance = null;
    if (onDone) { stopWave(); onDone(); return; }
    stopWave();
    isSpeaking = false;
    document.getElementById('status').innerText = "EN ESPERA";
    afterSpeech();
  };
  utterance.onend = terminar;
  utterance.onerror = (ev) => {
    // Las voces "Natural" usan internet: si fallan, reintentar una vez con la MISMA voz
    if (!terminado && intento === 1 && ev.error !== 'interrupted' && ev.error !== 'canceled') {
      terminado = true;
      console.warn("La voz falló (", ev.error, "), reintentando...");
      setTimeout(() => speakBrowser(text, onDone, 2), 300);
      return;
    }
    terminar();
  };

  // Guardar la referencia: si no, el navegador a veces "olvida" avisar que terminó de hablar
  kittUtterance = utterance;
  kittUtteranceStart = Date.now();
  window.speechSynthesis.speak(utterance);
}

// Precargar voces del sistema
window.speechSynthesis.onvoiceschanged = () => {
  window.speechSynthesis.getVoices();
};

// Visualización de memoria
function toggleMemoryModal() {
  const box = document.getElementById('memory-box');
  if (box.style.display === 'block') {
    box.style.display = 'none';
  } else {
    const list = document.getElementById('memory-list');
    list.innerHTML = memories.map(m => `<li>${m}</li>`).join('') || '<li>Sin recuerdos aún.</li>';
    box.style.display = 'block';
  }
}

function clearMemory() {
  if (confirm("¿Seguro que deseas borrar la memoria de KITT?")) {
    memories = [];
    localStorage.removeItem('kitt_memories');
    updateMemoryCount();
    toggleMemoryModal();
  }
}


// ===== TABLERO: botones y modos =====
let voiceEnabled = localStorage.getItem('kitt_voice') !== 'off';
let kittMode = localStorage.getItem('kitt_mode') || 'normal';

const MODES = {
  calma:  { rate: 0.95, prompt: "MODO ACTUAL: CALMA. Habla con un tono tranquilo, pausado y relajante." },
  normal: { rate: 1.02, prompt: "MODO ACTUAL: NORMAL. Habla con tu estilo habitual." },
  alerta: { rate: 1.12, prompt: "MODO ACTUAL: ALERTA. Responde muy breve, directo y enfocado, como en una situación urgente." }
};
if (!MODES[kittMode]) kittMode = 'normal';

function modeInstruction() {
  return MODES[kittMode].prompt;
}

function setMode(mode) {
  kittMode = mode;
  localStorage.setItem('kitt_mode', mode);
  ['calma', 'normal', 'alerta'].forEach(m => {
    document.getElementById('mode-' + m).classList.toggle('on', m === mode);
    document.getElementById('ind-' + m).classList.toggle('on', m === mode);
  });
  document.getElementById('status').innerText = "MODO " + mode.toUpperCase();
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem('kitt_voice', voiceEnabled ? 'on' : 'off');
  document.getElementById('btn-voz').classList.toggle('on', voiceEnabled);
  document.getElementById('btn-voz').classList.toggle('off', !voiceEnabled);
  if (!voiceEnabled) stopSpeaking();
  document.getElementById('status').innerText = voiceEnabled ? "VOZ ACTIVADA" : "VOZ SILENCIADA";
}

function resetChat() {
  chatHistory = [];
  document.getElementById('transcript').innerText = "Conversación reiniciada.";
  document.getElementById('status').innerText = "EN ESPERA";
}

function sayTime() {
  const now = new Date();
  const hora = now.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
  const texto = `David, son las ${hora}.`;
  document.getElementById('transcript').innerText = `KITT: "${texto}"`;
  speak(texto);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

function lightTest() {
  let level = 0, up = true, steps = 0;
  const t = setInterval(() => {
    level += up ? 1 : -1;
    if (level >= rows) up = false;
    if (level <= 0) up = true;
    [0, 1, 2].forEach(c => setColumnLeds(c, level));
    if (++steps > rows * 4) { clearInterval(t); stopWave(); }
  }, 60);
}

// Estado inicial del tablero
setMode(kittMode);
document.getElementById('btn-voz').classList.toggle('on', voiceEnabled);
document.getElementById('btn-voz').classList.toggle('off', !voiceEnabled);
document.getElementById('status').innerText = "EN ESPERA";


// ===== VOZ ESTILO KITT (Gemini TTS + efecto electrónico) =====
// Puedes probar otras voces de Gemini: "Charon", "Orus", "Iapetus", "Algieba", "Fenrir"
const KITT_VOICE = "Charon";
// Orden: primero el modelo de voz más rápido
const KITT_TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
let workingTtsModel = null;   // se recuerda el modelo que funcionó para no perder tiempo
// (Solo se envía el texto de la respuesta, para que KITT no lea instrucciones en voz alta)

let audioCtx = null;
let currentSource = null;
let analyserTimer = null;
let speechToken = 0;          // sirve para cancelar una respuesta a mitad

function stopSpeaking() {
  speechToken++;
  window.speechSynthesis.cancel();
  if (currentSource) { try { currentSource.stop(); } catch (e) {} currentSource = null; }
  clearInterval(analyserTimer);
  stopWave();
  isSpeaking = false;
}

// Divide la respuesta: la PRIMERA frase sola (para empezar a hablar rápido) y el resto junto
function splitForSpeech(text) {
  const m = text.match(/^.*?[.!?…](\s|$)/s);
  if (!m || m[0].length >= text.length - 3 || m[0].length < 8) return [text];
  return [m[0].trim(), text.slice(m[0].length).trim()];
}

async function speakGemini(text) {
  const myToken = ++speechToken;
  if (currentSource) { try { currentSource.stop(); } catch (e) {} currentSource = null; }
  const pieces = splitForSpeech(text);

  // Pedimos el audio de todos los pedazos A LA VEZ; el primero llega rápido porque es corto
  const audios = pieces.map(p => fetchTtsBuffer(p));
  audios.forEach(a => a.catch(() => {}));   // evita avisos si alguno falla

  const first = await audios[0];            // si el primero falla, se usa la voz del navegador
  if (myToken !== speechToken) return;
  await playBuffer(first);

  for (let i = 1; i < pieces.length; i++) {
    if (myToken !== speechToken) return;
    try {
      const buf = await audios[i];
      if (myToken !== speechToken) return;
      await playBuffer(buf);
    } catch (e) {
      console.warn("Pedazo de voz falló, uso voz del navegador:", e.message);
      await new Promise(res => speakBrowser(pieces[i], res));
    }
  }
  if (myToken === speechToken) finishSpeaking();
}

function finishSpeaking() {
  clearInterval(analyserTimer);
  stopWave();
  isSpeaking = false;
  currentSource = null;
  document.getElementById('status').innerText = "EN ESPERA";
  afterSpeech();
}

async function fetchTtsBuffer(text) {
  const models = workingTtsModel ? [workingTtsModel] : KITT_TTS_MODELS;
  let lastErr = null;
  for (const model of models) {
    try {
      const buf = await fetchTtsModel(text, model);
      workingTtsModel = model;
      return buf;
    } catch (e) {
      console.warn(`Voz con ${model} falló:`, e.message);
      lastErr = e;
    }
  }
  throw lastErr;
}

async function fetchTtsModel(text, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: KITT_VOICE } } }
      }
    })
  });
  const data = await response.json();
  const audioB64 = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!response.ok || !audioB64) throw new Error(data.error?.message || "Sin audio");

  // Gemini entrega audio PCM 16 bits, 24000 Hz, mono
  const bytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const buffer = audioCtx.createBuffer(1, pcm.length, 24000);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  return buffer;
}

// Reproduce un audio con el efecto de "computadora del auto" y mueve las luces
async function playBuffer(buffer) {
  await audioCtx.resume();
  return new Promise(resolve => {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = MODES[kittMode].rate >= 1.1 ? 1.04 : 1.0;

    const highpass = audioCtx.createBiquadFilter();   // quita graves (parlante del tablero)
    highpass.type = 'highpass'; highpass.frequency.value = 160;

    const presence = audioCtx.createBiquadFilter();   // brillo metálico
    presence.type = 'peaking'; presence.frequency.value = 2800; presence.gain.value = 5; presence.Q.value = 1.2;

    const delay = audioCtx.createDelay();              // eco muy corto = timbre electrónico
    delay.delayTime.value = 0.011;
    const feedback = audioCtx.createGain(); feedback.gain.value = 0.28;
    const wet = audioCtx.createGain(); wet.gain.value = 0.35;

    const comp = audioCtx.createDynamicsCompressor();
    const analyser = audioCtx.createAnalyser(); analyser.fftSize = 512;

    src.connect(highpass); highpass.connect(presence);
    presence.connect(comp);
    presence.connect(delay); delay.connect(feedback); feedback.connect(delay);
    delay.connect(wet); wet.connect(comp);
    comp.connect(analyser); analyser.connect(audioCtx.destination);

    const samples = new Uint8Array(analyser.fftSize);
    clearInterval(waveInterval);
    clearInterval(analyserTimer);
    analyserTimer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) { const v = (s - 128) / 128; sum += v * v; }
      const level = Math.min(rows, Math.round(Math.sqrt(sum / samples.length) * 45));
      setColumnLeds(1, level);
      setColumnLeds(0, Math.max(0, level - 2));
      setColumnLeds(2, Math.max(0, level - 2));
    }, 50);

    src.onended = () => { clearInterval(analyserTimer); resolve(); };
    currentSource = src;
    src.start();
  });
}


// ===== TIPO DE VOZ =====
// "rapida" = voz de hombre de Edge (instantánea) | "kitt" = voz de Google con efecto (más lenta)
let voiceType = localStorage.getItem('kitt_voice_type') || 'rapida';

function updateVoiceTypeButton() {
  const b = document.getElementById('btn-voice-type');
  if (b) b.innerHTML = voiceType === 'rapida' ? 'VOZ<br>RÁPIDA' : 'VOZ<br>KITT';
}

function toggleVoiceType() {
  voiceType = voiceType === 'rapida' ? 'kitt' : 'rapida';
  localStorage.setItem('kitt_voice_type', voiceType);
  updateVoiceTypeButton();
  document.getElementById('status').innerText = voiceType === 'rapida' ? "VOZ RÁPIDA ACTIVADA" : "VOZ KITT ACTIVADA";
}
updateVoiceTypeButton();

function sayDate() {
  const fecha = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const texto = `David, hoy es ${fecha}.`;
  document.getElementById('transcript').innerText = `KITT: "${texto}"`;
  speak(texto);
}


// ===== VIGILANTE: que KITT nunca se quede "dormido" en modo automático =====
let kittUtterance = null;
let kittUtteranceStart = 0;
let listenStartedAt = 0;
let speakingSince = 0;

setInterval(() => {
  if (!autoMode || isProcessing) { speakingSince = 0; return; }

  if (isSpeaking) {
    if (!speakingSince) speakingSince = Date.now();
    // La voz del navegador terminó pero no avisó
    if (kittUtterance && !window.speechSynthesis.speaking && !window.speechSynthesis.pending && Date.now() - kittUtteranceStart > 3000) {
      kittUtterance.onend();
    }
    // Seguro general: nadie habla más de 90 segundos
    if (Date.now() - speakingSince > 90000) { stopSpeaking(); afterSpeech(); }
    return;
  }
  speakingSince = 0;

  // El micrófono se quedó "colgado" escuchando sin avisar
  if (isListening && Date.now() - listenStartedAt > 20000) {
    try { recognition.abort(); } catch (e) {}
    isListening = false;
  }
  if (!isListening) startListening();
}, 2000);
