// =====================
// Utilidades básicas
// =====================
const normUp = (s) => (s ?? '').toString()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .trim().toUpperCase();
const keyify = (s) => normUp(s).replace(/[^A-Z0-9]/g,'');
const $ = (s) => document.querySelector(s);

// =====================
// Audio + feedback visual (errores)
// =====================
let audioCtx = null;
function playErrorBeep(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = 220;
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.20);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.22);
  }catch(e){}
}
function flashError(){
  const el = $('#estado'); if(!el) return;
  const prev = el.style.backgroundColor;
  el.style.backgroundColor = 'rgba(220,38,38,0.12)';
  setTimeout(()=>{ el.style.backgroundColor = prev || ''; }, 160);
}

// =====================
// Mapeos y estado
// =====================
const COLOR_ALIASES = {
  'S':'SURTIDO','SUR':'SURTIDO',
  'U':'UNICO','UN':'UNICO','UNQ':'UNICO',
  'N':'NEGRO','NE':'NEGRO','BK':'NEGRO',
  'B':'BLANCO','BL':'BLANCO','BLA':'BLANCO','WH':'BLANCO','BCO':'BLANCO',
  'A':'AZUL','AZ':'AZUL',
  'R':'ROJO','RO':'ROJO',
  'V':'VERDE','VE':'VERDE',
  'GR':'GRIS','GRA':'GRIS','GRIS':'GRIS',
  'AL':'ALMENDRA','ALM':'ALMENDRA','ALMENDRA':'ALMENDRA',
  'CE':'CELESTE','CR':'CRUDO',
  'NA':'NATURAL','NU':'NUDE',
  'BE':'BEIGE','MA':'MARRON','LI':'LILA',
  'AM':'AMARILLO','BO':'BORDO','FU':'FUCSIA'
};
const TALLE_ALIASES = {'U':'UNICO','UN':'UNICO','UNQ':'UNICO'};

let picks = [];                // válidos (key) con repetidos
let counts = new Map();        // key -> cantidad
let invalidPicks = [];         // inválidos con repetidos
let invalidCounts = new Map(); // inválidos únicos

// Índices
const codeInfo = new Map();    // key -> {codigo, articulo, color, talle}
const comboToCode = new Map(); // artKey|colorKey|talleKey -> key
const artColors = new Map();   // artKey -> Set(colorKey)
const artTalles = new Map();   // artKey -> Set(talleKey)

// =====================
// Helpers UI
// =====================
function yyyymmdd(){ const d=new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; }
function sanitizeForFile(s){ return normUp(s).replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
function setEstado(ok,msg){ $('#estado').innerHTML = ok ? `<span class="ok">✅ ${msg||'Válido'}</span>` : `<span class="bad">❌ ${msg||'No registrado'}</span>`; }
function updatePills(){
  $('#pillTotal').textContent    = `${picks.length} válidos totales`;
  $('#pillUnicos').textContent   = `${counts.size} válidos únicos`;
  $('#pillInvalidos').textContent  = `${invalidPicks.length} inválidos`;
  $('#pillInvalidos2').textContent = `${invalidCounts.size} códigos`;
}
function sortedEntries(mapObj){
  const arr = [...mapObj.entries()];
  arr.sort((a,b)=>{
    const ia = codeInfo.get(a[0]) || {};
    const ib = codeInfo.get(b[0]) || {};
    return (ia.articulo||'').localeCompare(ib.articulo||'')
        || (ia.color||'').localeCompare(ib.color||'')
        || (ia.talle||'').localeCompare(ib.talle||'');
  });
  return arr;
}
function renderTablaValidos(){
  const tb = $('#tablaValidos'); tb.innerHTML = ''; let i=1;
  for (const [key, qty] of sortedEntries(counts)){
    const info = codeInfo.get(key) || {codigo:key, articulo:'-', color:'-', talle:'-'};
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="background:#fff">${i++}</td>
                    <td>${info.codigo}</td>
                    <td>${info.articulo}</td>
                    <td>${info.color}</td>
                    <td>${info.talle}</td>
                    <td class="count">${qty}</td>`;
    tb.appendChild(tr);
  }
}
function renderTablaInvalidos(){
  const tb = $('#tablaInvalidos'); tb.innerHTML = ''; let i=1;
  for (const [code, qty] of invalidCounts.entries()){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="background:#fff">${i++}</td>
                    <td>${code}</td>
                    <td class="count">${qty}</td>`;
    tb.appendChild(tr);
  }
}

// =====================
// Resolución de claves (artículo, color, talle)
// =====================
function resolveArtKey(rawArt){
  // Permite que "2000" empareje con "61-2000" y "2000/E" con "61-2000E"
  const kIn = keyify(rawArt);         // "2000" → "2000", "2000/E" → "2000E"
  if (artColors.has(kIn)) return kIn;

  const keys = [...artColors.keys()];
  const ends = keys.filter(k => k.endsWith(kIn));     // ...612000E → 2000E
  if (ends.length === 1) return ends[0];

  const includes = keys.filter(k => k.includes(kIn)); // por si hay prefijos/códigos
  if (includes.length === 1) return includes[0];

  return kIn; // fallback
}
function resolveColorKey(artKey, rawColor){
  const set = artColors.get(artKey) || new Set();
  const alias = COLOR_ALIASES[normUp(rawColor)];
  const kIn = keyify(rawColor);
  const kAlias = alias ? keyify(alias) : null;
  if (kAlias && set.has(kAlias)) return kAlias;
  if (set.has(kIn)) return kIn;
  const pref = [...set].filter(k => k.startsWith(kIn));
  if (pref.length === 1) return pref[0];
  return kIn;
}
function resolveTalleKey(artKey, rawTalle){
  const set = artTalles.get(artKey) || new Set();
  const alias = TALLE_ALIASES[normUp(rawTalle)];
  const kIn = keyify(rawTalle);
  const kAlias = alias ? keyify(alias) : null;
  if (kAlias && set.has(kAlias)) return kAlias;
  if (set.has(kIn)) return kIn;
  const pref = [...set].filter(k => k.startsWith(kIn));
  if (pref.length === 1) return pref[0];
  return kIn;
}

// =====================
// Parseo de input
// =====================
function parseComposite(s){
  const txt = normUp(s);
  if (!txt.includes('!')) return null;
  const parts = txt.split('!').map(p => p.trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  return { art: parts[0], col: parts[1], tal: parts[2] };
}

// "ART TALLE COLOR", "ART/E TALLE COLOR" o "ART/E{TALLE} COLOR"
function parseLooseTriplet(s){
  const txt = normUp(s).replace(/\s+/g,' ').trim();
  if (!txt) return null;

  const parts = txt.split(' ');

  // Caso 1: tres tokens -> [ART, TALLE, COLOR]
  if (parts.length === 3){
    const [art, tal, col] = parts;
    if (/^[A-Z0-9/.\-]+$/.test(art) && /^\d{1,4}$/.test(tal)){
      return { art, tal, col };
    }
  }

  // Caso 2: dos tokens -> ["ART/E{TALLE}", "COLOR"]
  if (parts.length === 2){
    const [artAndTal, col] = parts;
    const m = artAndTal.match(/^(.+?)(?:E)?(\d{1,4})$/);
    if (m){
      const art = m[1].replace(/\s+$/,'');
      const tal = m[2];
      return { art, tal, col };
    }
  }

  return null;
}

// Autoconfirmar (sin ENTER físico)
const SCAN_IDLE_MS = 120;   // definila UNA vez
let scanIdleTimer = null;   // definila UNA vez


// Si el lector pegó N veces el mismo código sin separadores: "ABC ABC" sin separadores → repetido
function splitIfRepeated(raw){
  const s = raw.trim();
  if (!s) return [];
  if (/[\n,;\t]/.test(s)) return [s]; // separadores “duros” ya presentes
  const m = s.match(/^(.+?)\1+$/);
  if (m){
    const unit = m[1];
    const times = s.length / unit.length;
    return Array(times).fill(unit);
  }
  return [s];
}

function addValido(input){
  const raw = input.toString().trim();
  if (!raw) return;

  const key = normUp(raw);

  // 1) Código directo (sin espacios) o con espacios si coincide exactamente
  const infoDirect = codeInfo.get(key);
  if (infoDirect){
    picks.push(key);
    counts.set(key, (counts.get(key)||0)+1);
    setEstado(true, `${infoDirect.codigo} OK — ${infoDirect.articulo} / ${infoDirect.color} / ${infoDirect.talle}`);
    updatePills(); renderTablaValidos(); return;
  }

  // 2) ART!COLOR!TALLE
  const comp = parseComposite(raw);
  if (comp){
    const artKey = resolveArtKey(comp.art);
    const colorKey = resolveColorKey(artKey, comp.col);
    const talleKey = resolveTalleKey(artKey, comp.tal);
    const mappedKey = comboToCode.get(`${artKey}|${colorKey}|${talleKey}`);
    if (mappedKey){
      const info = codeInfo.get(mappedKey);
      picks.push(mappedKey);
      counts.set(mappedKey, (counts.get(mappedKey)||0)+1);
      setEstado(true, `${info.codigo} OK — ${info.articulo} / ${info.color} / ${info.talle}`);
      updatePills(); renderTablaValidos(); return;
    }
  }

  // 3) "ART TALLE COLOR" / "ART/E{TALLE} COLOR"
  const loose = parseLooseTriplet(raw);
  if (loose){
    const artKey = resolveArtKey(loose.art);
    const colorKey = resolveColorKey(artKey, loose.col);
    const talleKey = resolveTalleKey(artKey, loose.tal);
    const mappedKey = comboToCode.get(`${artKey}|${colorKey}|${talleKey}`);
    if (mappedKey){
      const info = codeInfo.get(mappedKey);
      picks.push(mappedKey);
      counts.set(mappedKey, (counts.get(mappedKey)||0)+1);
      setEstado(true, `${info.codigo} OK — ${info.articulo} / ${info.color} / ${info.talle}`);
      updatePills(); renderTablaValidos(); return;
    }
  }

  // 4) inválido
  const invKey = normUp(raw);
  invalidPicks.push(invKey);
  invalidCounts.set(invKey, (invalidCounts.get(invKey)||0)+1);
  setEstado(false, `${raw} no está registrado`);
  playErrorBeep();
  flashError();
  updatePills(); renderTablaInvalidos();
}

function processRawInput(raw){
  // IMPORTANTE: NO partir por espacio (los códigos pueden tener espacios).
  // Solo consideramos separadores “duros”: salto de línea, coma, punto y coma, tab.
  let chunks;
  if (/[\n,;\t]/.test(raw)) {
    chunks = raw.split(/[\n,;\t]+/).map(t=>t.trim()).filter(Boolean);
  } else {
    chunks = [raw];
  }

  // Si todo vino pegado sin separadores y parece repetición exacta, partir en unidades
  if (chunks.length === 1) {
    const maybe = splitIfRepeated(chunks[0]);
    if (maybe.length > 1) chunks = maybe;
  }

  // Descartar lecturas ridículas (1 carácter)
  const valid = chunks.filter(t => t.length >= 2);
  const dropped = chunks.filter(t => t.length > 0 && t.length < 2);
  if (dropped.length > 0){
    setEstado(false, 'Lectura incompleta: reintentar el escaneo');
    playErrorBeep(); flashError();
  }

  for (const t of valid) addValido(t);
}

// =====================
// Carga de CSVs (robusta)
// =====================
function detectSep(line){
  const sc = line.split(';').length;
  const cc = line.split(',').length;
  if (sc>cc) return ';';
  if (cc>sc) return ',';
  return ';';
}
function cleanCell(c){ return (c??'').replace(/^\uFEFF/, '').replace(/^"|"$|(\r)/g,'').trim(); }
function normHeader(h){
  return (h ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-');
}
function headerPositions(headerRaw){
  const header = headerRaw.map(h => normHeader(cleanCell(h)));
  const wants = {
    codigo:   ['codigo','c-digo','cod','code','id-codigo'],
    articulo: ['articulo','art-culo','art','sku','codigo-articulo'],
    color:    ['color','col'],
    talle:    ['talle','tal','size']
  };
  const pos = {};
  for (const [k, aliases] of Object.entries(wants)){
    let idx = -1;
    for (const a of aliases){
      const i = header.indexOf(a);
      if (i >= 0){ idx = i; break; }
    }
    if (idx < 0){
      const i2 = header.findIndex(h => h.startsWith(aliases[0].slice(0,3)));
      if (i2 >= 0) idx = i2;
    }
    pos[k] = idx >= 0 ? idx : null;
  }
  return pos;
}

function ingestRow(codigo, articulo, color, talle){
  const key = normUp(codigo);
  if (!key) return;

  if (!codeInfo.has(key)) {
    codeInfo.set(key, { codigo, articulo, color, talle });
  }

  const artKey = keyify(articulo);
  const colKey = keyify(color);
  const talKey = keyify(talle);

  if (!artColors.has(artKey)) artColors.set(artKey, new Set());
  if (!artTalles.has(artKey)) artTalles.set(artKey, new Set());
  artColors.get(artKey).add(colKey);
  artTalles.get(artKey).add(talKey);

  const comboKey = `${artKey}|${colKey}|${talKey}`;
  if (!comboToCode.has(comboKey)) comboToCode.set(comboKey, key);
}

async function loadCSVGeneric(url, hasHeader=true){
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fetch-fail');
  let txt = await resp.text();
  txt = txt.replace(/^\uFEFF/, '');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;

  const sep = detectSep(lines[0]);
  if (hasHeader){
    const headerRaw = lines[0].split(sep).map(cleanCell);
    const pos = headerPositions(headerRaw);
    const fallback = (arr, idx, fb) => cleanCell((arr[idx] ?? fb) ?? '');

    for (const line of lines.slice(1)){
      const cols = line.split(sep).map(cleanCell);
      const codigo   = pos.codigo   != null ? cols[pos.codigo]   : fallback(cols,0,'');
      const articulo = pos.articulo != null ? cols[pos.articulo] : fallback(cols,1,'');
      const color    = pos.color    != null ? cols[pos.color]    : fallback(cols,2,'');
      const talle    = pos.talle    != null ? cols[pos.talle]    : fallback(cols,3,'');
      ingestRow(codigo, articulo, color, talle);
    }
  }else{
    for (const line of lines){
      const cols = line.split(sep).map(cleanCell);
      const [codigo='', articulo='', color='', talle=''] = cols;
      ingestRow(codigo, articulo, color, talle);
    }
  }
}

async function loadPrimary(){ try{ await loadCSVGeneric('equivalencias.csv', true); } catch(e){} }
async function loadSecondary(){ try{ await loadCSVGeneric('equivalencias_secundarias.csv', false); } catch(e){} }

// =====================
// Boot + handlers
// =====================
(async function boot(){
  await loadPrimary();
  await loadSecondary();
  if (codeInfo.size > 0) setEstado(false,'Base cargada. Escaneá para validar.');
  else setEstado(false,'No se pudo cargar ninguna equivalencia.');
})();

const scan = $('#scan');

// Enter manual (si el lector lo envía)
scan.addEventListener('keydown', e => {
  if (e.key==='Enter'){
    e.preventDefault();
    const raw = scan.value;
    if (!raw.trim()) return;
    processRawInput(raw);
    scan.value=''; scan.focus();
  }
});

scan.addEventListener('input', ()=>{
  const val = scan.value;

  if (!val.trim()){ setEstado(false,'Pendiente'); return; }

  // Preview: directo
  const direct = codeInfo.get(normUp(val));
  if (direct){
    setEstado(true, `Posible válido — ${direct.articulo} / ${direct.color} / ${direct.talle}`);
  } else {
    // Preview: ART!COLOR!TALLE
    let shown = false;
    const comp = parseComposite(val);
    if (comp){
      const artKey = resolveArtKey(comp.art);
      const colorKey = resolveColorKey(artKey, comp.col);
      const talleKey = resolveTalleKey(artKey, comp.tal);
      const mapped = comboToCode.get(`${artKey}|${colorKey}|${talleKey}`);
      if (mapped){
        const info = codeInfo.get(mapped);
        setEstado(true, `Posible válido — ${info.articulo} / ${info.color} / ${info.talle}`);
        shown = true;
      }
    }
    // Preview: ART TALLE COLOR / ART/E{TALLE} COLOR
    if (!shown){
      const loose = parseLooseTriplet(val);
      if (loose){
        const artKey = resolveArtKey(loose.art);
        const colorKey = resolveColorKey(artKey, loose.col);
        const talleKey = resolveTalleKey(artKey, loose.tal);
        const mapped = comboToCode.get(`${artKey}|${colorKey}|${talleKey}`);
        if (mapped){
          const info = codeInfo.get(mapped);
          setEstado(true, `Posible válido — ${info.articulo} / ${info.color} / ${info.talle}`);
          shown = true;
        }
      }
    }
    if (!shown) setEstado(false,'No registrado');
  }

  // Autoconfirmar por pausa
  if (scanIdleTimer) clearTimeout(scanIdleTimer);
  scanIdleTimer = setTimeout(()=>{
    const raw = scan.value;
    if (!raw.trim()) return;
    processRawInput(raw);
    scan.value = '';
    scan.focus();
  }, SCAN_IDLE_MS);
});

// =====================
// Descargas
// =====================
function requireMeta(){
  const responsable=($('#responsable').value||'').trim();
  const piso=($('#piso').value||'').trim();
  const sector=($('#sector').value||'').trim();
  if(!responsable) return alert('Completá el RESPONSABLE.'), null;
  if(!piso)        return alert('Seleccioná el PISO.'), null;
  if(!sector)      return alert('Completá el SECTOR.'), null;
  return { responsable:sanitizeForFile(responsable), piso:sanitizeForFile(piso), sector:sanitizeForFile(sector) };
}
function downloadTXT(lines, filename){
  const blob = new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
}

// Válidos → siempre el CÓDIGO ORIGINAL
$('#descargarValidos').addEventListener('click', ()=>{
  if (picks.length===0) return alert('No hay códigos válidos pickeados.');
  const m=requireMeta(); if(!m) return;
  const out = picks.map(k => (codeInfo.get(k)?.codigo) || k);
  downloadTXT(out, `PICKEO_${yyyymmdd()}_${m.piso}_${m.sector}_${m.responsable}.txt`);
});
$('#descargarInvalidos').addEventListener('click', ()=>{
  if (invalidPicks.length===0) return alert('No hay códigos inválidos.');
  const m=requireMeta(); if(!m) return;
  downloadTXT(invalidPicks, `INVALIDOS_${yyyymmdd()}_${m.piso}_${m.sector}_${m.responsable}.txt`);
});
