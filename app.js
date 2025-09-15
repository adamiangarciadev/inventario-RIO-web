/* =========================
   app.js — Pickeo rápido Zebra (con subida a Drive)
   ========================= */

/* ---------- CONFIG DRIVE ---------- */
const DRIVE_WEBAPP_URL = 'https://adamiangarciadev.github.io/inventario-RIO-web/'; // ej: https://script.google.com/macros/s/XXXXX/exec
const DRIVE_FOLDER_ID  = '1Bpj36KpYGbn2ru3mYF5G5m9-NoZw6DVL'; // tu carpeta destino
const DRIVE_TOKEN      = '6a006fb19100c33059df2aeab6b64b970941b61e'; // el mismo que en Code.gs
const TXT_SEPARATOR    = ';';  // ';' o ',' o '\t'
const TXT_INCLUDE_HEADER = true; // true para agregar encabezado en el TXT

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

  // Key primaria
  const key = `${codigo}|${color}|${talle}`;
  codeInfo.set(key, { codigo, articulo, color, talle });

  // Índices alternativos
  if (!codeInfo.has(codigo)) {
    codeInfo.set(codigo, { codigo, articulo, color, talle });
  }
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
          w.terminate(); resolve();
        }
      };
      w.postMessage('equivalencia.csv');
    } catch (err) {
      console.error('Worker error:', err);
      resolve();
    }
  });
}

/* =========================================
   2) RENDER IN-PLACE (sin repintar toda la tabla)
   ========================================= */
function rowIdFor(key) { return `row_${hashKey(key)}`; }
function invRowIdFor(code) { return `inv_${hashKey(code)}`; }
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

  let key = null;
  if (codeInfo.has(val)) {
    key = val;
  } else {
    if (val.includes('!') || val.includes('|')) {
      const t = val.replace(/\s+/g, '');
      if (codeInfo.has(t)) key = t;
    }
    if (!key) {
      const flat = val.toUpperCase().replace(/\s+/g, '');
      if (codeInfo.has(flat)) key = flat;
    }
  }

  if (key) {
    const newQty = (counts.get(key) || 0) + 1;
    counts.set(key, newQty);
    totalOk++;
    bumpCountCell(ensureValidoRow(key), newQty);
    okBeep();
  } else {
    const newBad = (invalidCounts.get(val) || 0) + 1;
    invalidCounts.set(val, newBad);
    totalBad++;
    bumpCountCell(ensureInvalidoRow(val), newBad);
    errorBeep();
  }

  updatePills();
  stickFocusSoon();
  scanInput.select();
}
function handleInputChange() {
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
/* Batch (pegar varias líneas) */
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
   4) AUDIO (beeps)
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
   6) EXPORTAR / GUARDAR TXT
   ========================================= */
function buildTxt() {
  const sep = TXT_SEPARATOR;
  const rows = [];
  if (TXT_INCLUDE_HEADER) rows.push(['codigo','articulo','color','talle','cantidad'].join(sep));
  // Exportar en orden por código
  const entries = Array.from(counts.entries());
  entries.sort((a,b)=>{
    const ia = codeInfo.get(a[0]) || {}; const ib = codeInfo.get(b[0]) || {};
    return String(ia.codigo).localeCompare(String(ib.codigo));
  });
  for (const [key, qty] of entries) {
    const info = codeInfo.get(key) || { codigo:key, articulo:'-', color:'-', talle:'-' };
    rows.push([info.codigo, info.articulo, info.color, info.talle, qty].map(v=>String(v ?? '')).join(sep));
  }
  return rows.join('\n');
}
function makeFilename() {
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,'0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `picking_${stamp}.txt`;
}
async function saveTxtToDrive() {
  try {
    const filename = makeFilename();
    const content  = buildTxt();
    setEstado(false, 'Subiendo a Drive…');

    if (!DRIVE_WEBAPP_URL || DRIVE_WEBAPP_URL.includes('PON_AQUI')) {
      throw new Error('Falta configurar DRIVE_WEBAPP_URL');
    }

    // Enviar como x-www-form-urlencoded (simple request, sin preflight)
    const body = new URLSearchParams({
      token:    DRIVE_TOKEN,
      filename: filename,
      content:  content,
      folderId: DRIVE_FOLDER_ID
    });

    const res = await fetch(DRIVE_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });

    // Si tu Apps Script permite CORS (suele hacerlo), leo JSON:
    let data = null;
    try { data = await res.json(); } catch { /* si fuese opaque, igual guardó */ }

    if (data?.ok) {
      setEstado(true, `Guardado en Drive ✔️ (${data.name})`);
    } else if (res.ok && !data) {
      // Respuesta opaca/no JSON: asumimos éxito
      setEstado(true, 'Guardado en Drive ✔️');
    } else {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(err);
    setEstado(false, `Error subiendo a Drive: ${err.message}`);
  }
}
function downloadTxt() {
  const content = buildTxt();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = makeFilename();
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}
function ensureToolbar() {
  let bar = document.getElementById('toolbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'toolbar';
    bar.style.display = 'flex';
    bar.style.gap = '8px';
    bar.style.marginTop = '8px';
    bar.innerHTML = `
      <button id="btnSaveDrive">💾 Guardar en Drive</button>
      <button id="btnDownload">⬇️ Descargar TXT</button>
    `;
    // Insertar debajo de la pillbar
    pillbarEl.parentElement.insertBefore(bar, pillbarEl.nextSibling);
  }
  $('#btnSaveDrive').onclick = saveTxtToDrive;
  $('#btnDownload').onclick  = downloadTxt;
}

/* =========================================
   7) BOOTSTRAP
   ========================================= */
async function boot() {
  setEstado(false, 'Cargando base de equivalencias…');
  await loadPrimaryWorker();

  const ok = codeInfo.size > 0;
  setEstado(ok, ok ? 'Base cargada. Escaneá para validar.' : 'No se pudo cargar la base.');
  updatePills();
  ensureToolbar(); // <-- agrega los botones

  // Listeners de entrada
  scanInput.addEventListener('input', handleInputChange, { passive: true });
  scanInput.addEventListener('keydown', handleKeydown);

  // Pegar múltiples (líneas separadas)
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
boot();
