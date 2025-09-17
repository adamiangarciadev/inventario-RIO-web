/* app.js — Pickeo con escáner. */
;(() => {
  "use strict";

  // ====== Config ======
  const RESPONSABLES = ["DAVID","DIEGO","JOEL","MARTIN","MIGUEL","NAHUEL","RICARDO","RODRIGO"];
  const SUCURSALES  = ["AVELLANEDA 2","NAZCA","LAMARCA","CORRIENTES","CORRIENTES 2","CASTELLI","QUILMES","MORENO"];
  const DEFAULT_CSV = "equivalencia.csv";
  const LS_META = "pickeo_meta_v1";
  const LS_PREFS = "pickeo_prefs_v1";
  // Auto-Enter tras idle del escáner (ms)
  const AUTOCOMMIT_IDLE_MS = 80; // ajustable 60-120ms
  const MIN_LEN_FOR_COMMIT = 3;  // evita commits por ruido muy corto

  // ====== Estado ======
  let rows = [];               // filas del CSV (objetos)
  let byCode = new Map();      // code -> row
  let scans = [];              // {code, ok, time}
  let audioCtx = null;
  let scanTimer = null;        // <-- faltaba!

  // ====== Elementos ======
  const $ = (sel, ctx=document) => ctx.querySelector(sel);
  const el = {
    // pill
    readyPill: $("#readyPill"),
    pillText: $("#pillText"),
    // selects
    respSelect: $("#respSelect"),
    origenSelect: $("#origenSelect"),
    destinoSelect: $("#destinoSelect"),
    remitoInput: $("#remitoInput"),
    // scan
    scanInput: $("#scanInput"),
    scanCount: $("#scanCount"),
    noti: $("#noti"),
    lastScans: $("#lastScans"),
    // download
    sep: $("#sep"),
    fname: $("#fname"),
    downloadBtn: $("#downloadBtn"),
    clearBtn: $("#clearBtn"),
  };

  // ====== Init ======
  document.addEventListener("DOMContentLoaded", () => {
    setupSelectors();
    restorePrefs();
    bindUI();
    // Autoload equivalencia.csv
    loadProjectCSV(DEFAULT_CSV).catch(() => {
      showPill("danger", "No se encontró equivalencia.csv");
    });
    // Mantener foco en input
    keepFocus();
  });

  function bindUI(){
    if (el.scanInput){
      el.scanInput.addEventListener("keydown", (e) => {
        ensureAudio();
        // Si el escáner ya manda Enter, seguimos soportándolo
        if (e.key === "Enter"){
          e.preventDefault();
          const code = (el.scanInput.value || "").trim();
          processScan(code);
          el.scanInput.select();
          clearTimeout(scanTimer); scanTimer = null;
          return;
        }
        // Para cualquier otra tecla, reprogramamos autocommit
        scheduleAutoCommit();
      });
      el.scanInput.addEventListener("input", () => { ensureAudio(); scheduleAutoCommit(); });
    }
    if (el.downloadBtn) el.downloadBtn.addEventListener("click", downloadTxt);
    if (el.clearBtn) el.clearBtn.addEventListener("click", () => { scans = []; renderLast(); });
    // Prefs
    if (el.sep) el.sep.addEventListener("change", savePrefs);
    if (el.fname) el.fname.addEventListener("change", savePrefs);
    // Meta
    [el.respSelect, el.origenSelect, el.destinoSelect].forEach(s => s?.addEventListener("change", saveMeta));
    if (el.remitoInput) {
      el.remitoInput.addEventListener("input", (e) => {
        const v = (e.target.value || "").replace(/\D+/g, "");
        if (v !== e.target.value) e.target.value = v;
        saveMeta();
      });
    }
  }

  // ====== Selectors / LocalStorage ======
  function setupSelectors(){
    fillOptions(el.respSelect, RESPONSABLES);
    fillOptions(el.origenSelect, SUCURSALES);
    fillOptions(el.destinoSelect, SUCURSALES);
    const { responsable, origen, destino, remito } = readLocal(LS_META) || {};
    if (responsable && RESPONSABLES.includes(responsable)) el.respSelect.value = responsable;
    if (origen && SUCURSALES.includes(origen)) el.origenSelect.value = origen;
    if (destino && SUCURSALES.includes(destino)) el.destinoSelect.value = destino;
    if (typeof remito === "string") el.remitoInput.value = remito;
  }
  function saveMeta(){
    writeLocal(LS_META, {
      responsable: el.respSelect?.value || "",
      origen: el.origenSelect?.value || "",
      destino: el.destinoSelect?.value || "",
      remito: el.remitoInput?.value || "",
    });
  }
  function savePrefs(){
    writeLocal(LS_PREFS, { sep: el.sep.value, fname: el.fname.value });
  }
  function restorePrefs(){
    const p = readLocal(LS_PREFS) || {};
    if (p.sep) el.sep.value = p.sep;
    if (p.fname) el.fname.value = p.fname;
  }
  function fillOptions(select, list){
    if(!select) return;
    select.innerHTML = "";
    list.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      select.appendChild(opt);
    });
  }
  function writeLocal(k, obj){ try{ localStorage.setItem(k, JSON.stringify(obj)); }catch{} }
  function readLocal(k){ try{ const r = localStorage.getItem(k); return r? JSON.parse(r): null; }catch{ return null; } }

  // ====== Audio ======
  function ensureAudio(){
    if (!audioCtx){
      try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch{ audioCtx = null; }
    }
  }
  function beepError(){
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type="square"; o.frequency.value=220; // grave
    g.gain.value=0.0001;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    // envolvente rápida
    g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
    o.stop(audioCtx.currentTime + 0.25);
    if (navigator.vibrate) navigator.vibrate(80);
  }

  // ====== CSV Load & Index ======
  async function loadProjectCSV(path){
    const target = (path || DEFAULT_CSV).replace(/^\/*/, "");
    const res = await fetch("./" + target, { cache: "no-store" });
    if (!res.ok) throw new Error("CSV not found");
    const text = await res.text();
    rows = parseCSV(text);
    indexCodes(rows);
    showPill("ok","Listo para pickear");
  }

  function indexCodes(data){
    byCode.clear();
    const keys = Object.keys(data[0] || {});
    const codeKey = guessCodeColumn(keys);
    data.forEach(r => {
      const code = String(r[codeKey] ?? "").trim();
      if (code) byCode.set(code, r);
    });
    // opcional: también indexar variantes con padding/upper si hace falta
  }

  function guessCodeColumn(keys){
    const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
    const patterns = ["equivalencia","equiv","codigo","código","cod","sku","ean","barra","barcode"];
    return keys.find(k => patterns.some(p => norm(k).includes(p))) || keys[0];
  }

  // ====== Scan Handling ======
  // Autocommit: si no llega Enter desde el escáner, confirmamos tras una breve pausa
  function scheduleAutoCommit(){
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { autoCommit(); }, AUTOCOMMIT_IDLE_MS);
  }
  function autoCommit(){
    const code = (el.scanInput.value || "").trim();
    if (code.length >= MIN_LEN_FOR_COMMIT){
      processScan(code);
      el.scanInput.select();
    }
    scanTimer = null;
  }

  function processScan(code){
    const clean = String(code || "").trim();
    if (!clean){ flash("err"); return; }
    const hit = byCode.has(clean);
    scans.unshift({ code: clean, ok: hit, time: new Date().toISOString() });
    scans = scans.slice(0, 2000); // limitar
    if (!hit){
      flash("err"); beepError(); note(`No encontrado: ${clean}`);
    } else {
      flash("ok"); note(`OK: ${clean}`);
    }
    renderLast();
  }

  function flash(kind){
    if (!el.scanInput) return;
    el.scanInput.classList.remove("ok","err");
    void el.scanInput.offsetWidth; // reflow
    el.scanInput.classList.add(kind);
    setTimeout(() => el.scanInput.classList.remove(kind), 220);
  }

  function note(msg){ if (el.noti) el.noti.textContent = msg; }

  function renderLast(){
    if (!el.lastScans) return;
    const total = scans.length;
    if (el.scanCount) el.scanCount.textContent = `${total} escaneados`;
    const recent = scans.slice(0, 10)
      .map(s => `<span class="${s.ok?'ok':'err'}">${s.ok?'✓':'✗'} ${escapeHtml(s.code)}</span>`)
      .join(" · ");
    el.lastScans.innerHTML = recent || "";
  }

  // Mantener foco para lectores HID
  function keepFocus(){
    if (!el.scanInput) return;
    const focusIt = () => { if (document.activeElement !== el.scanInput) el.scanInput.focus(); };
    setInterval(focusIt, 1200);
    el.scanInput.addEventListener("blur", () => setTimeout(focusIt, 50));
  }

  // ====== TXT ======
  function downloadTxt(){
    const sep = el.sep.value === "\\t" ? "\t" : el.sep.value; // <-- tab real
    const counts = new Map(); // code -> {cant, row}
    scans.filter(s => s.ok).forEach(s => {
      const row = byCode.get(s.code);
      const cur = counts.get(s.code) || { cant: 0, row };
      cur.cant += 1;
      counts.set(s.code, cur);
    });
    // Detectar columnas talla/color si existen
    const anyRow = (counts.size ? [...counts.values()][0].row : null) || {};
    const keys = Object.keys(anyRow || {});
    const hasTalle = keys.some(k => norm(k).includes("talle") || norm(k).includes("size"));
    const hasColor = keys.some(k => norm(k).includes("color") || norm(k).includes("col"));
    const codeKey = guessCodeColumn(keys);

    const lines = [];
    counts.forEach(({cant, row}, code) => {
      const base = [ String(row?.[codeKey] ?? code) ];
      if (hasTalle) base.push(String(row?.[keys.find(k => /talle|size/i.test(k))] ?? ""));
      if (hasColor) base.push(String(row?.[keys.find(k => /color|col\b/i.test(k))] ?? ""));
      base.push(String(cant));
      lines.push(base.join(sep));
    });

    const content = lines.join("\n"); // <-- newline real
    const fname = resolveFilename(el.fname.value);
    const blob = new Blob([content], {type: "text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function resolveFilename(tpl){
    const now = new Date();
    const pad = (n) => String(n).padStart(2,"0");
    const FECHA = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const RESPONSABLE = slug(el.respSelect?.value || "");
    const ORIGEN = slug(el.origenSelect?.value || "");
    const DESTINO = slug(el.destinoSelect?.value || "");
    const REMITO = (el.remitoInput?.value || "").toString();
    const map = { "${FECHA}": FECHA, "${RESPONSABLE}": RESPONSABLE, "${ORIGEN}": ORIGEN, "${DESTINO}": DESTINO, "${REMITO}": REMITO };
    let out = tpl || "pedido_${FECHA}.txt";
    Object.entries(map).forEach(([k,v]) => { out = out.replaceAll(k, v); });
    return out.replace(/[\\/:*?"<>|]+/g, "_");
  }

  // ====== Helpers ======
  function parseCSV(text){
    const lines = text.split(/\r?\n/);
    if (!lines.length) return [];
    // skip empty tail lines
    while (lines.length && !lines[lines.length-1].trim()) lines.pop();
    if (!lines.length) return [];
    const headers = splitCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitCSVLine(line);
      const obj = {};
      headers.forEach((h,i) => obj[h] = cells[i] ?? "");
      return obj;
    });
  }
  function splitCSVLine(line){
    const out = []; let cur=""; let q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i], n=line[i+1];
      if(c==='\"'){ if(q && n==='\"'){ cur+='\"'; i++; } else { q=!q; } }
      else if(c===',' && !q){ out.push(cur); cur=""; }
      else { cur+=c; }
    }
    out.push(cur);
    return out;
  }
  function norm(s){ return (s||"").toString().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,""); }
  function slug(s){ return (s||"").toString().normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/[^\w\-]+/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,""); }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[m]));
  }

  // ====== Pill ======
  function showPill(state, text){
    if(!el.readyPill) return;
    el.readyPill.classList.remove("hidden","ok","warn","danger");
    el.readyPill.classList.add(state || "ok");
    if(el.pillText) el.pillText.textContent = text || (state === "ok" ? "Listo para pickear" : "Estado");
  }
})();
