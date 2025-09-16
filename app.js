/* app.js — 100% front‑end (GitHub Pages). Sin autenticación. Solo descarga TXT.
   Arquitectura simple:
   - Capa I/O: leer CSV/JSON, tabla editable, preview, descarga.
   - Capa Dominio: mapear columnas y componer líneas TXT.
   - Utilidades: CSV parser, storage, helpers.
*/

;(() => {
  "use strict";

  // ====== Estado ======
  /** @type {Array<Record<string, any>>} */
  let rows = [];        // Datos en forma tabular (objetos)
  let txtCache = "";    // Último TXT generado

  // ====== Elementos ======
  const $ = (sel, ctx=document) => ctx.querySelector(sel);
  const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
  const el = {
    drop: $("#drop"),
    file: $("#file"),
    raw: $("#raw"),
    parseBtn: $("#parseBtn"),
    demoBtn: $("#demoBtn"),
    tableWrap: $("#tableWrap"),
    genBtn: $("#genBtn"),
    dlBtn: $("#dlBtn"),
    preview: $("#preview"),
    status: $("#status"),
    sep: $("#sep"),
    fname: $("#fname"),
  };

  // ====== Inicializar ======
  document.addEventListener("DOMContentLoaded", () => {
    restorePrefs();
    bindDragDrop();
    bindActions();
  });

  // ====== Acciones UI ======
  function bindActions() {
    el.drop.addEventListener("click", () => el.file.click());
    el.file.addEventListener("change", onFilePicked);
    el.parseBtn.addEventListener("click", parseRaw);
    el.demoBtn.addEventListener("click", loadDemo);
    el.genBtn.addEventListener("click", generateTxt);
    el.dlBtn.addEventListener("click", downloadTxt);
    el.sep.addEventListener("change", savePrefs);
    el.fname.addEventListener("change", savePrefs);
  }

  function bindDragDrop() {
    ["dragenter","dragover"].forEach(type => el.drop.addEventListener(type, (e) => {
      e.preventDefault(); e.stopPropagation(); el.drop.classList.add("hover");
    }));
    ["dragleave","drop"].forEach(type => el.drop.addEventListener(type, (e) => {
      e.preventDefault(); e.stopPropagation(); el.drop.classList.remove("hover");
    }));
    el.drop.addEventListener("drop", (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    });
  }

  // ====== Cargar archivo / entrada ======
  function onFilePicked(e){
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }

  function handleFile(file){
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      el.raw.value = text;
      parseRawWithExt(text, ext);
    };
    reader.readAsText(file);
  }

  function parseRaw(){
    const text = el.raw.value.trim();
    if(!text){ return toast("No hay datos para procesar."); }
    const looksJson = text[0] === "[" || text[0] === "{";
    parseRawWithExt(text, looksJson ? "json" : "csv");
  }

  function parseRawWithExt(text, ext){
    try{
      if(ext === "json"){
        const data = normalizeArray(JSON.parse(text));
        rows = data;
      } else {
        const data = parseCSV(text);
        rows = data;
      }
      if(!rows.length){ toast("No se detectaron filas."); }
      autoMapAndRender();
      toast(`Cargadas ${rows.length} filas.`);
    }catch(err){
      console.error(err);
      toast("Error al procesar. Ver consola.");
    }
  }

  // ====== Mapeo de columnas & Render ======
  /** Deduce columnas típicas y genera tabla editable */
  function autoMapAndRender(){
    if(!rows.length){ el.tableWrap.innerHTML = ""; return; }
    const keys = Object.keys(rows[0] || {});

    // Heurística de columnas
    const map = guessColumns(keys);
    // Normalizar a columnas finales
    const normalized = rows.map(r => ({
      codigo: val(r, map.codigo),
      talle:  val(r, map.talle),
      color:  val(r, map.color),
      cantidad: toNumber(val(r, map.cantidad), 0),
    }));
    rows = normalized;
    renderTable(rows);
  }

  function renderTable(data){
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      <th>Código</th><th>Talle</th><th>Color</th><th>Cantidad</th>
      <th><span class="badge">editable</span></th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    data.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.appendChild(tdInput(i,"codigo", r.codigo));
      tr.appendChild(tdInput(i,"talle", r.talle));
      tr.appendChild(tdInput(i,"color", r.color));
      tr.appendChild(tdInput(i,"cantidad", String(r.cantidad)));
      const del = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "btn ghost";
      btn.textContent = "Eliminar";
      btn.addEventListener("click", () => {
        rows.splice(i,1); renderTable(rows);
      });
      del.appendChild(btn);
      tr.appendChild(del);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    el.tableWrap.innerHTML = "";
    el.tableWrap.appendChild(table);
  }

  function tdInput(i,key,val){
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.value = val ?? "";
    input.addEventListener("change", e => {
      const v = (e.target.value ?? "").trim();
      rows[i][key] = key === "cantidad" ? toNumber(v, 0) : v;
    });
    td.appendChild(input);
    return td;
  }

  // ====== Generar / Descargar TXT ======
  function generateTxt(){
    if(!rows.length){ return toast("No hay datos para generar."); }
    const sep = el.sep.value === "\\t" ? "\t" : el.sep.value;
    const lines = composeLines(rows, sep);
    txtCache = lines.join("\n");
    el.preview.value = txtCache;
    el.dlBtn.disabled = !txtCache;
    el.status.textContent = `Generadas ${lines.length} líneas.`;
  }

  function downloadTxt(){
    if(!txtCache){ return; }
    const fname = resolveFilename(el.fname.value);
    const blob = new Blob([txtCache], {type: "text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ====== Dominio ======
  function composeLines(rows, sep){
    // Formato base: codigo; t alle; color; cantidad
    return rows.map(r => [
      safe(r.codigo), safe(r.talle), safe(r.color), String(r.cantidad ?? 0)
    ].join(sep));
  }

  // ====== Utilidades ======
  function guessColumns(keys){
    const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");
    const score = (k, pats) => pats.some(p => norm(k).includes(p));
    const find = (pats, fallback=null) => keys.find(k => score(k, pats)) ?? fallback;

    return {
      codigo:   find(["codigo","código","sku","cod","art","articulo","artículo","id"], keys[0]),
      talle:    find(["talle","size","medida","t"], null),
      color:    find(["color","col","c"], null),
      cantidad: find(["cantidad","cant","qty","q","unidades","stock","pedido"], null),
    };
  }

  function val(row, key){ return key ? row[key] : ""; }
  function toNumber(x, d=0){ const n = Number(String(x).replace(",", ".")); return Number.isFinite(n) ? n : d; }
  function safe(x){ return (x ?? "").toString().replace(/\r?\n/g," ").trim(); }

  function parseCSV(text){
    // Mini parser CSV con comillas – suficiente para uso clásico (no 100% RFC).
    const lines = text.split(/\r?\n/).filter(Boolean);
    if(!lines.length) return [];
    const headers = splitCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitCSVLine(line);
      const obj = {};
      headers.forEach((h,i) => obj[h] = cells[i] ?? "");
      return obj;
    });
  }
  function splitCSVLine(line){
    const out = []; let cur = ""; let q = false;
    for(let i=0;i<line.length;i++){
      const c = line[i], n = line[i+1];
      if(c === '"' ){
        if(q && n === '"'){ cur += '"'; i++; } else { q = !q; }
      } else if(c === "," && !q){ out.push(cur); cur=""; }
      else { cur += c; }
    }
    out.push(cur);
    return out;
  }

  function resolveFilename(tpl){
    const now = new Date();
    const pad = (n) => String(n).padStart(2,"0");
    const FECHA = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    return (tpl || "pedido_${FECHA}.txt").replace("${FECHA}", FECHA).replace(/[\\/:*?"<>|]+/g, "_");
  }

  function toast(msg){ el.status.textContent = msg; }

  // ====== Preferencias (LocalStorage) ======
  const LS_KEY = "genTXT_prefs_v1";
  function savePrefs(){
    const prefs = { sep: el.sep.value, fname: el.fname.value };
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  }
  function restorePrefs(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      const prefs = JSON.parse(raw);
      if(prefs.sep){ el.sep.value = prefs.sep; }
      if(prefs.fname){ el.fname.value = prefs.fname; }
    }catch{}
  }

  // ====== Demo ======
  function loadDemo(){
    const demo = [
      { codigo: "05-5477", talle: "95",  color: "NEGRO", cantidad: 12 },
      { codigo: "05-5477", talle: "90",  color: "BLANCO", cantidad: 8 },
      { codigo: "29-4700", talle: "100", color: "CELESTE", cantidad: 6 },
      { codigo: "29-4730", talle: "90",  color: "AZUL ZAFIRO", cantidad: 3 },
    ];
    rows = demo; renderTable(rows);
    el.status.textContent = "Demo cargada.";
  }

  // Exponer para debugging manual si hace falta
  window.__app = { get rows(){ return rows; } };

})();