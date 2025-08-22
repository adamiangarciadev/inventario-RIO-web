// ================== Estado ==================
let equivalencias = {};
let registrados = [];
let noRegistrados = [];
let piso = "", sector = "", responsable = "";

// Buffer para teclado/escáner
let inputBuffer = '';
let debounceTimer = null;

// ================== Inicio / Config ==================
document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  piso = document.getElementById('piso').value.trim();
  sector = document.getElementById('sector').value.trim();
  responsable = document.getElementById('responsable').value.trim();

  await loadCSV(); // carga equivalencias desde CSV con encabezado ; y limpieza

  document.getElementById('config-form').style.display = 'none';
  document.getElementById('scanner').style.display = 'block';

  const codeInput = document.getElementById('code-input');
  codeInput.value = '';
  codeInput.focus();
});

// ================== Captura del escáner ==================
// 1) Maneja pegado (cuando el escáner pega todo el código)
document.getElementById('code-input').addEventListener('paste', (e) => {
  e.preventDefault();
  const pasted = (e.clipboardData || window.clipboardData).getData('text');
  handleScannedText(pasted);
});

// 2) Maneja tipeo rápido del escáner (caracteres en ráfaga)
document.getElementById('code-input').addEventListener('input', (e) => {
  // e.data puede venir null en algunos navegadores; tomamos el value entero
  const val = e.target.value;
  inputBuffer = val;

  clearTimeout(debounceTimer);
  // si no viene Enter, procesamos tras un breve silencio
  debounceTimer = setTimeout(() => {
    if (inputBuffer) {
      handleScannedText(inputBuffer);
    }
    inputBuffer = '';
    e.target.value = '';
  }, 120); // 120ms funciona bien con la mayoría de escáneres
});

// 3) Maneja Enter explícito (muchos escáneres lo envían al final)
document.getElementById('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = e.target.value;
    handleScannedText(val);
    inputBuffer = '';
    e.target.value = '';
  }
});

// Función común para normalizar y registrar
function handleScannedText(text) {
  if (!text) return;

  // limpiar: espacios, tabs, CR/LF, BOM, etc.
  let code = String(text)
    .replace(/^\uFEFF/, '')      // BOM al inicio
    .replace(/\r?\n/g, '')       // saltos de línea
    .replace(/\s+/g, '')         // todos los espacios
    .trim();

  // algunos escáneres pueden mandar separadores raros; limpiamos
  code = code.replace(/[^\w\-]/g, ''); // deja letras/números/_/-

  if (code.length < 6) return; // umbral mínimo (ajustable)

  registrarCodigo(code);
}

// ================== Registrar código ==================
function registrarCodigo(code) {
  const result = equivalencias[code];
  const display = result
    ? `${code} - ${result}`
    : `${code} - Equivalencia no registrada`;

  const item = document.createElement('li');
  item.textContent = display;
  item.className = result ? 'registrado' : 'no-registrado';
  document.getElementById('results').appendChild(item);

  if (result) {
    registrados.push({ code, result });
    document.getElementById('registrados-count').textContent = registrados.length;
  } else {
    noRegistrados.push(code);
    document.getElementById('no-registrados-count').textContent = noRegistrados.length;
  }
}

// ================== Exportar ==================
document.getElementById('export-registered').addEventListener('click', () => {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const name = `stock_${date}_${piso}_${sector}_${responsable}.csv`;
  const content = 'Codigo;Equivalencia\n' + registrados.map(r => `${r.code};${r.result}`).join('\n');
  downloadCSV(name, content);
});

document.getElementById('export-unregistered').addEventListener('click', () => {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const name = `no_registrados_${date}_${piso}_${sector}_${responsable}.csv`;
  const content = 'Codigo\n' + noRegistrados.join('\n');
  downloadCSV(name, content);
});

function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ================== Cargar CSV (con encabezado y ;) ==================
async function loadCSV() {
  const response = await fetch('equivalencias.csv');
  const raw = await response.text();

  // normalizamos saltos y BOM
  const text = raw.replace(/\r/g, '').replace(/^\uFEFF/, '');
  let lines = text.split('\n').filter(Boolean);

  if (lines.length === 0) {
    console.error('CSV vacío o no encontrado');
    alert('No se pudo cargar equivalencias.csv o está vacío.');
    return;
  }

  // Leer encabezado (separado por ;)
  const headerLine = lines[0].trim().replace(/"/g, '');
  const headers = headerLine.split(';').map(h => h.trim().toLowerCase());

  // Buscamos índices por nombre, tolerando acentos/variaciones
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const idxCodigo = headers.findIndex(h => /^(codigo|c[oó]digo|cod|c[oó]d art)/.test(norm(h)));
  const idxArticulo = headers.findIndex(h => /(articulo|art[ií]culo|c[oó]d art|art)/.test(norm(h)));
  const idxDesc1 = headers.findIndex(h => /(descripcion|descripci[oó]n)/.test(norm(h)));
  // si hay dos descripciones, la segunda:
  let idxDesc2 = -1;
  for (let i = 0, count = 0; i < headers.length; i++) {
    if (/(descripcion|descripci[oó]n)/.test(norm(headers[i]))) {
      count++;
      if (count === 2) { idxDesc2 = i; break; }
    }
  }

  if (idxCodigo === -1) {
    console.error('No se encontró la columna de CÓDIGO en el encabezado:', headers);
    alert('El CSV debe contener una columna de CÓDIGO en el encabezado.');
    return;
  }

  // Procesar filas (desde i=1)
  let cargadas = 0;
  for (let i = 1; i < lines.length; i++) {
    const cleanLine = lines[i].trim();
    if (!cleanLine) continue;

    // quitamos comillas, separamos por ;
    const parts = cleanLine.replace(/"/g, '').split(';');

    // tomar valores por índice si existen
    let code = (parts[idxCodigo] || '').trim();
    // limpieza de código (sin espacios/CR/LF)
    code = code.replace(/\s+/g, '').replace(/^\uFEFF/, '');

    if (!code) continue;

    const articulo = idxArticulo !== -1 ? (parts[idxArticulo] || '').trim() : '';
    const desc1 = idxDesc1 !== -1 ? (parts[idxDesc1] || '').trim() : '';
    const desc2 = idxDesc2 !== -1 ? (parts[idxDesc2] || '').trim() : '';

    const descripcion = [articulo, desc1, desc2].filter(Boolean).join(' - ');

    equivalencias[code] = descripcion || 'Sin descripción';
    cargadas++;
  }

  console.log(`Equivalencias cargadas: ${cargadas}`);
  // Opcional: muestra una muestra para verificar
  const someKey = Object.keys(equivalencias)[0];
  if (someKey) console.log('Ejemplo:', someKey, '=>', equivalencias[someKey]);
}
