/* =========================
   app.js — Pickeo rápido Zebra
   ========================= */

/* ---------- Helpers DOM ---------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const scanInput   = $('#scan');
const estadoEl    = $('#estado');
const pillbarEl   = $('#pillbar');
const tbodyOk     = $('#tablaValidos');
const tbodyBad    = $('#tablaInvalidos');

/* ---------- Estado ---------- */
// Mapa maestro: key => {codigo, articulo, color, talle}
const codeInfo = new Map();

// Contadores y listas
const counts        = new Map(); // key => qty
const invalidCounts = new Map(); // raw => qty
let totalOk = 0, totalBad = 0;

// Parámetros de UX/Performance
const SCAN_IDLE_MS = 90; // Confirmar si no viene Enter (ideal DataWedge)
let idleTimer = null;

// Buffer opcional por ráfagas (p.ej. pegado)
const queue = [];
let rafFlush = null;

// Wake Lock para que no se apague la pantalla
let wakeLock = null;

/* =========================================
   1) CARGA DE EQUIVALENCIAS (Web Worker)
   ========================================= */
function ingestRow(codigo, articulo, color, talle) {
  // Normalización leve
  const norm = (s) =>
    (s ?? '')
      .toString()
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,''); // sin tildes

  codigo  = norm(codigo);
  articulo= norm(articulo);
  color   = norm(color);
  talle   = norm(talle);

  // Key primaria: "codigo|color|talle"
  // Si tu CSV NO trae color/talle, igual funciona (quedan vacíos).
  const key = `${codigo}|${color}|${talle}`;
  codeInfo.set(key, { codigo, articulo, color, talle });

  // Indexes alternativos útiles:
  // - directo por código sólo (para guns donde escanean SKU plano)
  if (!codeInfo.has(codigo)) {
    codeInfo.set(codigo, { codigo, articulo, color, talle });
  }

  // - tripleta tipo "ART!COLOR!TALLE"
  const triple = `${articulo}!${color}!${talle}`;
  if (!codeInfo.has(triple)) {
    codeInfo.set(triple, { codigo, articulo, color, talle });
  }
}

async function loadPrimaryWorker() {
  return new Promise((resolve) => {
    try {
      const w = new Worker('equivalencia.worker.js');
      w.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'row') {
          ingestRow(msg.codigo, msg.articulo, msg.color, msg.talle);
        } else if (msg.type === 'done') {
          w.terminate();
          resolve();
        }
      };
      // Carga el CSV desde la raíz del sitio
      w.postMessage('equivalencia.csv');
    } catch (err) {
      console.error('Worker error:', err);
      resolve(); // seguimos para no bloquear la app
    }
  });
}

/* =========================================
   2) RENDER IN-PLACE (sin repintar toda la tabla)
   ========================================= */
function rowIdFor(key) { return `row_${hashKey(key)}`; }
function invRowIdFor(code) { return `inv_${hashKey(code)}`; }

// Hash liviano para IDs de elementos
function hashKey(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16);
}

function ensureValidoRow(key) {
  let tr = document.getElementById(rowIdFor(key));
  if (tr) return tr;

  const info = codeInfo.get(key) || { codigo: key, articulo: '-', color: '-', talle: '-' };
  tr = document.createElement('tr');
  tr.id = rowIdFor(key);
  tr.innerHTML = `
    <td style="background:#fff"></td>
    <td>${escapeHtml(info.codigo)}</td>
    <td>${escapeHtml(info.articulo)}</td>
    <td>${escapeHtml(info.color)}</td>
    <td>${escapeHtml(info.talle)}</td>
    <td class="count">0</td>
  `;
  tbodyOk.appendChild(tr);
  renumerarTabla(tbodyOk);
  return tr;
}

function ensureInvalidoRow(code) {
  let tr = document.getElementById(invRowIdFor(code));
  if (tr) return tr;
  tr = document.createElement('tr');
  tr.id = invRowIdFor(code);
  tr.innerHTML = `
    <td style="background:#fff"></td>
    <td>${escapeHtml(code)}</td>
    <td class="count">0</td>
  `;
  tbodyBad.appendChild(tr);
  renumerarTabla(tbodyBad);
  return tr;
}

function renumerarTabla(tbody) {
  let i = 1;
  $$('#' + tbody.id + ' tr').forEach((r) => {
    const first = r.firstElementChild;
    if (first) first.textContent = i++;
  });
}

function bumpCountCell(tr, qty) {
  const cell = tr.querySelector('.count');
  if (cell) cell.textContent = qty;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

/* =========================================
   3) LÓGICA DE ESCANEO
   ========================================= */
function setEstado(ok, msg) {
  estadoEl.textContent = msg || (ok ? 'Listo.' : 'Listo, sin base.');
  estadoEl.style.color = ok ? '#2e7d32' : '#b71c1c';
}

function updatePills() {
  pillbarEl.innerHTML = `
    <div class="pill">Total: ${totalOk + totalBad}</div>
    <div class="pill">Válidos: ${totalOk}</div>
    <div class="pill">Inválidos: ${totalBad}</div>
    <div class="pill">Items distintos: ${counts.size}</div>
  `;
}

function commitScan(rawValue) {
  const val = (rawValue ?? '').trim();
  if (!val) return;

  // Estrategias de match:
  // 1) Exacto (codigo|color|talle, codigo solo, tripleta "ART!COLOR!TALLE")
  // 2) Si viene "CODIGO!COLOR!TALLE" lo probamos directo.
  let key = null;

  if (codeInfo.has(val)) {
    key = val; // exacto
  } else {
    // Si viene formateado con '!' tratamos directo
    if (val.includes('!') || val.includes('|')) {
      const t = val.replace(/\s+/g, '');
      if (codeInfo.has(t)) key = t;
    }
    // Si no, intentamos por código “plano” (mayúsculas, sin espacios)
    if (!key) {
      const flat = val.toUpperCase().replace(/\s+/g, '');
      // Buscar coincidencia por código “plano”
      // (Nota: codeInfo guardó cada “codigo” como key también)
      if (codeInfo.has(flat)) key = flat;
    }
  }

  if (key) {
    // Válido
    const newQty = (counts.get(key) || 0) + 1;
    counts.set(key, newQty);
    totalOk++;

    const tr = ensureValidoRow(key);
    bumpCountCell(tr, newQty);
    okBeep();
  } else {
    // Inválido
    const newBad = (invalidCounts.get(val) || 0) + 1;
    invalidCounts.set(val, newBad);
    totalBad++;

    const tr = ensureInvalidoRow(val);
    bumpCountCell(tr, newBad);
    errorBeep();
  }

  updatePills();
  // Dejar listo para el próximo
  stickFocusSoon();
  scanInput.select();
}

function handleInputChange() {
  // Confirmación por inactividad: si DataWedge no agrega ENTER
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    commitScan(scanInput.value);
    scanInput.value = '';
  }, SCAN_IDLE_MS);
}

function handleKeydown(e) {
  if (e.key === 'Enter') {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    commitScan(scanInput.value);
    scanInput.value = '';
    e.preventDefault();
  }
}

/* Batch por ráfagas (pegar varias líneas) */
function enqueue(v) {
  if (!v) return;
  queue.push(v);
  if (!rafFlush) rafFlush = requestAnimationFrame(flushQueue);
}

function flushQueue() {
  rafFlush = null;
  const batch = queue.splice(0, queue.length);
  for (const v of batch) commitScan(v);
}

/* =========================================
   4) AUDIO (beeps simples reusables)
   ========================================= */
let audioCtx = null, okOsc = null, errOsc = null, okGain = null, errGain = null;

function getCtx() { return audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)()); }

function okBeep() {
  try {
    const ctx = getCtx();
    okOsc?.stop(); okGain?.disconnect();
    okOsc = ctx.createOscillator(); okGain = ctx.createGain();
    okOsc.frequency.value = 880; okGain.gain.value = 0.05;
    okOsc.connect(okGain).connect(ctx.destination);
    okOsc.start(); setTimeout(()=>{ okOsc.stop(); }, 90);
  } catch {}
}
function errorBeep() {
  try {
    const ctx = getCtx();
    errOsc?.stop(); errGain?.disconnect();
    errOsc = ctx.createOscillator(); errGain = ctx.createGain();
    errOsc.frequency.value = 220; errGain.gain.value = 0.08;
    errOsc.connect(errGain).connect(ctx.destination);
    errOsc.start(); setTimeout(()=>{ errOsc.stop(); }, 140);
  } catch {}
}

/* =========================================
   5) FOCO PEGADO + WAKE LOCK
   ========================================= */
function stickFocus() {
  if (document.activeElement !== scanInput) scanInput.focus();
}
function stickFocusSoon() { setTimeout(stickFocus, 0); }

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && !wakeLock) {
          try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
        }
      });
    }
  } catch {}
}

/* =========================================
   6) BOOTSTRAP
   ========================================= */
async function boot() {
  setEstado(false, 'Cargando base de equivalencias…');
  await loadPrimaryWorker();

  const ok = codeInfo.size > 0;
  setEstado(ok, ok ? 'Base cargada. Escaneá para validar.' : 'No se pudo cargar la base.');
  updatePills();

  // Listeners de entrada
  scanInput.addEventListener('input', handleInputChange, { passive: true });
  scanInput.addEventListener('keydown', handleKeydown);

  // Pegar múltiples (líneas separadas) => buffer/raf
  scanInput.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text) return;
    e.preventDefault();
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const ln of lines) enqueue(ln);
    scanInput.value = '';
  });

  // Foco pegado
  ['visibilitychange','touchend','click','blur'].forEach(evt=>{
    window.addEventListener(evt, () => setTimeout(stickFocus, 0), { passive:true });
  });
  document.addEventListener('DOMContentLoaded', stickFocus);
  stickFocus();

  // Wake lock
  requestWakeLock();
}

// Iniciar
boot();
