let equivalencias = {};
let registrados = [];
let noRegistrados = [];
let piso = "", sector = "", responsable = "";

let inputBuffer = '';
let debounceTimer = null;

document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  piso = document.getElementById('piso').value.trim();
  sector = document.getElementById('sector').value.trim();
  responsable = document.getElementById('responsable').value.trim();
  await loadCSV();
  document.getElementById('config-form').style.display = 'none';
  document.getElementById('scanner').style.display = 'block';
  document.getElementById('code-input').focus();
});

document.getElementById('code-input').addEventListener('input', (e) => {
  const char = e.data || e.target.value.slice(-1);
  inputBuffer += char;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const code = inputBuffer.trim();
    inputBuffer = '';
    e.target.value = '';

    if (code.length < 6) return;

    registrarCodigo(code);
  }, 200);
});

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

document.getElementById('export-registered').addEventListener('click', () => {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const name = `stock_${date}_${piso}_${sector}_${responsable}.csv`;
  const content = 'Codigo,Equivalencia\n' + registrados.map(r => `${r.code},${r.result}`).join('\n');
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

async function loadCSV() {
  const response = await fetch('equivalencias.csv');
  const text = await response.text();
  const lines = text.trim().split('\n');

  for (let i = 1; i < lines.length; i++) {
    const cleanLine = lines[i].trim().replace(/\r/g, '').replace(/"/g, '');
    const parts = cleanLine.split(/[;,]/);  // Compatible con ; y ,
    const code = parts[0]?.trim().replace(/\s/g, '');
    const articulo = parts[1]?.trim();
    const desc1 = parts[2]?.trim();
    const desc2 = parts[3]?.trim();
    const descripcion = `${articulo} - ${desc1} - ${desc2}`;
    if (code) equivalencias[code] = descripcion;
  }
}


