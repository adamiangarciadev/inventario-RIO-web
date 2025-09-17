/* app.js — 2 CSV, debug de carga, match normalizado */
;(() => {
  "use strict";

  // ====== Config ======
  const RESPONSABLES = ["DAVID","DIEGO","JOEL","MARTIN","MIGUEL","NAHUEL","RICARDO","RODRIGO"];
  const SUCURSALES  = ["AVELLANEDA 2","NAZCA","LAMARCA","CORRIENTES","CORRIENTES 2","CASTELLI","QUILMES","MORENO"];
  const CSV_FILES   = ["equivalencia.csv", "equivalencias2.csv"]; // ambos en la misma carpeta
  const LS_META  = "pickeo_meta_v1";
  const AUTOCOMMIT_IDLE_MS = 80;
  const MIN_LEN_FOR_COMMIT = 3;

  // ====== Estado ======
  let rows = [];
  let byCode = new Map();   // key(code) -> row
  let scans = [];
  let audioCtx = null;
  let scanTimer = null;

  // ====== Elementos ======
  const $ = (sel, ctx=document) => ctx.querySelector(sel);
  const el = {
    readyPill: $("#readyPill"),
    pillText:  $("#pillText"),
    respSelect:   $("#respSelect"),
    origenSelect: $("#origenSelect"),
    destinoSelect:$("#destinoSelect"),
    remitoInput:  $("#remitoInput"),
    scanInput: $("#scanInput"),
    scanCount: $("#scanCount"),
    noti:       $("#noti"),
    lastScans:  $("#lastScans"),
    downloadBtn: $("#downloadBtn"),
  };

  // ====== Init ======
  document.addEventListener("DOMContentLoaded", () => {
    setupSelectors();
    bindUI();
    loadAllCSVs(CSV_FILES);
    keepFocus();
  });

  function bindUI(){
    if (el.scanInput){
      el.scanInput.addEventListener("keydown", (e) => {
        ensureAudio();
        if (e.key === "Enter"){
          e.preventDefault();
          const code = (el.scanInput.value || "").trim();
          processScan(code);
          el.scanInput.value = "";
          el.scanInput.focus();
          clearTimeout(scanTimer); scanTimer = null;
          return;
        }
        scheduleAutoCommit();
      });
      el.scanInput.addEventListener("input", () => { ensureAudio(); scheduleAutoCommit(); });
    }
    if (el.downloadBtn) el.downloadBtn.addEventListener("click", downloadTxt);
  }

  // ====== Selectors / LocalStorage ======
  function setupSelectors(){
    fillOptions(el.respSelect, RESPONSABLES);
    fillOptions(el.origenSelect, SUCURSALES);
    fillOptions(el.destinoSelect, SUCURSALES);
    const { responsable, origen, destino, remito } = readLocal("pickeo_meta_v1") || {};
    if (responsable && RESPONSABLES.includes(responsable)) el.respSelect.value = responsable;
    if (origen && SUCURSALES.includes(origen)) el.origenSelect.value = origen;
    if (destino && SUCURSALES.includes(destino)) el.destinoSelect.value = destino;
    if (typeof remito === "string") el.remitoInput.value = remito;
    [el.respSelect, el.origenSelect, el.destinoSelect].forEach(s => s?.addEventListener("change", saveMeta));
    if (el.remitoInput) {
      el.remitoInput.addEventListener("input", (e) => {
        const v = (e.target.value || "").replace(/\D+/g, "");
        if (v !== e.target.value) e.target.value = v;
        saveMeta();
      });
    }
  }
  function saveMeta(){
    writeLocal(LS_META, {
      responsable: el.respSelect?.value || "",
      origen:      el.origenSelect?.value || "",
      destino:     el.destinoSelect?.value || "",
      remito:      el.remitoInput?.value || "",
    });
  }
  function writeLocal(k, obj){ try{ localStorage.setItem(k, JSON.stringify(obj)); }catch{} }
  function readLocal(k){ try{ const r = localStorage.getItem(k); return r? JSON.parse(r): null; }catch{ return null; } }
  function fillOptions(select, list){
    if(!select) return;
    select.innerHTML = "";
    list.forEach(v => { const o=document.createElement("option"); o.value=v; o.textContent=v; select.appendChild(o); });
  }

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
    o.type="square"; o.frequency.value=220;
    g.gain.value=0.0001;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
    o.stop(audioCtx.currentTime + 0.25);
    if (navigator.vibrate) navigator.vibrate(80);
  }

  // ====== CSV Load & Index (multi-archivo con diagnóstico) ======
  async function loadAllCSVs(list){
    byCode.clear(); rows = [];
    const jobs = list.map(async (name) => {
      try{
        const res = await fetch("./" + name, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const text = await res.text();
        const data = parseCSV(text);
        addToIndex(data, /*noOverride*/ true);
        rows = rows.concat(data);
        return { name, ok: true, rows: data.length };
      }catch(e){
        return { name, ok: false, err: e?.message || "error" };
      }
    });

    const results = await Promise.all(jobs);
    const okCount = results.filter(r => r.ok).length;

    if (okCount === 0){
      showPill("danger","No se encontró ningún CSV");
      note("No se cargaron CSV. Revisá nombres y mayúsculas/minúsculas.");
    } else if (okCount === list.length){
      showPill("ok",`Listo (${okCount}/${list.length} CSV)`);
      note(results.map(r => `OK ${r.name} (${r.rows})`).join(" · "));
    } else {
      const misses = results.filter(r => !r.ok).map(r => r.name).join(", ");
      showPill("warn",`Listo con ${okCount}/${list.length} CSV`);
      note(`Faltó: ${misses}. Verificá que estén en la misma carpeta y con ese nombre exacto.`);
    }
  }

  // Normalización de clave para el match (evita problemas de caso/espacios)
  const key = (s) => String(s ?? "").trim().toUpperCase();

  function addToIndex(data, noOverride){
    if (!data.length) return;
    const keys = Object.keys(data[0] || {});
    const codeKey = guessCodeColumn(keys); // columna de lookup
    data.forEach(r => {
      const raw = r[codeKey];
      const k = key(raw);
      if (!k) return;
      if (noOverride && byCode.has(k)) return; // respeta prioridad del primer CSV
      byCode.set(k, r);
    });
  }

  function guessCodeColumn(keys){
    const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
    const patterns = [
      "codigo_barras","codigo barras","barra","barcode","ean","lectura","scan",
      "codigo","código","equivalencia","equiv","sku","cod"
    ];
    return keys.find(k => patterns.some(p => norm(k).includes(p))) || keys[0];
  }

  // Preferir ARTÍCULO (código interno), sino código/sku/cod
  function getOutputCode(row, fallback){
    if (!row) return String(fallback ?? "");
    const keys = Object.keys(row);
    const prefArt = findKey(keys, ["articulo","artículo"]);
    if (prefArt) return String(row[prefArt] ?? "");
    const pref = findKey(keys, ["codigo","código","sku","cod"]);
    return String((pref ? row[pref] : fallback) ?? "");
  }
  function findKey(keys, pats){
    const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
    return keys.find(k => pats.some(p => norm(k).includes(p)));
  }

  // ====== Scan Handling ======
  function scheduleAutoCommit(){ if (scanTimer) clearTimeout(scanTimer); scanTimer = setTimeout(() => { autoCommit(); }, AUTOCOMMIT_IDLE_MS); }
  function autoCommit(){
    const code = (el.scanInput.value || "").trim();
    if (code.length >= MIN_LEN_FOR_COMMIT){
      processScan(code);
      el.scanInput.value = "";
      el.scanInput.focus();
    }
    scanTimer = null;
  }

  function processScan(code){
    const clean = String(code || "").trim();
    if (!clean){ flash("err"); return; }
    const k = key(clean);
    const hit = byCode.has(k);
    scans.unshift({ code: clean, ok: hit, time: new Date().toISOString() });
    scans = scans.slice(0, 5000);
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
    void el.scanInput.offsetWidth;
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

  // Mantener foco SOLO donde corresponde (sin robarlo a los selects/inputs)
  function keepFocus(){
    if (!el.scanInput) return;
    el.scanInput.focus();
    document.addEventListener("click", (e) => {
      const isInteractive = e.target.closest('input,select,textarea,button,a,label,[role="button"]');
      if (!isInteractive) setTimeout(() => el.scanInput.focus(), 0);
    });
  }

  // ====== TXT ======
  function downloadTxt(){
    const okLines = scans.filter(s => s.ok).map(s => {
      const row = byCode.get(key(s.code));
      return getOutputCode(row, s.code);
    });

    const seen = new Set();
    const missingLines = [];
    scans.forEach(s => {
      if (!s.ok){
        const k = key(s.code);
        if (!seen.has(k)){ seen.add(k); missingLines.push(String(s.code)); }
      }
    });

    const fnameBase = resolveFilename();
    downloadString(okLines.join("\n"), fnameBase);

    if (missingLines.length){
      const fnameMissing = withSuffix(fnameBase, "FALTA EQUIVALENCIA");
      downloadString(missingLines.join("\n"), fnameMissing);
    }
  }

  function withSuffix(name, suffix){
    const i = name.lastIndexOf(".");
    const base = i >= 0 ? name.slice(0, i) : name;
    const ext  = i >= 0 ? name.slice(i) : ".txt";
    return `${base} - ${suffix}${ext}`.replace(/[\\/:*?"<>|]+/g, "_");
  }
  function downloadString(content, fname){
    const blob = new Blob([content], {type: "text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function resolveFilename(){
    const now = new Date();
    const pad = (n) => String(n).padStart(2,"0");
    const FECHA = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const RESPONSABLE = slug(el.respSelect?.value || "");
    const ORIGEN      = slug(el.origenSelect?.value || "");
    const DESTINO     = slug(el.destinoSelect?.value || "");
    const REMITO      = (el.remitoInput?.value || "").toString();
    let out = `pedido_${FECHA}_${RESPONSABLE}_${ORIGEN}_a_${DESTINO}_remito_${REMITO}.txt`;
    return out.replace(/[\\/:*?"<>|]+/g, "_");
  }

  // ====== CSV robusto (autodetecta ; , | \t y comillas) ======
  function parseCSV(text){
    const lines = text.split(/\r?\n/).filter(l => l.length>0);
    if (!lines.length) return [];
    const sep = detectDelimiter(lines[0], lines[1]); // ; , | \t
    const rawHeaders = splitCSVLine(lines[0], sep);
    // deduplicar encabezados
    const seen = {};
    const headers = rawHeaders.map(h => {
      let k = String(h || "").trim();
      if (!k) k = "COL";
      if (seen[k]) { let n = 2; while (seen[`${k}_${n}`]) n++; k = `${k}_${n}`; }
      seen[k] = true; return k;
    });
    const out = [];
    for (let i=1;i<lines.length;i++){
      const cells = splitCSVLine(lines[i], sep);
      const obj = {};
      headers.forEach((h,idx) => obj[h] = (cells[idx] ?? "").trim());
      out.push(obj);
    }
    return out;
  }
  function detectDelimiter(l1, l2=""){
    const cands = [",",";","|","\t"];
    const score = (line, ch) => {
      let q=false, n=0;
      for(let i=0;i<line.length;i++){
        const c=line[i], nxt=line[i+1];
        if (c === '"'){ if(q && nxt === '"'){ i++; } else { q=!q; } }
        else if (!q && c === ch){ n++; }
      }
      return n;
    };
    const totals = cands.map(ch => (score(l1,ch)+score(l2,ch)));
    let best = 0, bestIdx = 0;
    totals.forEach((n,idx) => { if(n>best){ best=n; bestIdx=idx; } });
    return best>0 ? cands[bestIdx] : ";";
  }
  function splitCSVLine(line, sep){
    const out = []; let cur=""; let q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i], n=line[i+1];
      if(c === '"'){
        if(q && n === '"'){ cur+='"'; i++; } else { q=!q; }
      } else if(c === sep && !q){
        out.push(cur); cur="";
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  // ====== Helpers ======
  function slug(s){ return (s||"").toString().normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/[^\w\-]+/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,""); }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
  }

  // ====== Pill ======
  function showPill(state, text){
    if(!el.readyPill) return;
    el.readyPill.classList.remove("hidden","ok","warn","danger");
    el.readyPill.classList.add(state || "ok");
    if(el.pillText) el.pillText.textContent = text || (state === "ok" ? "Listo para pickear" : "Estado");
  }
})();
