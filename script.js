let equivalencias = {};
let registrados = [];
let noRegistrados = [];
let piso = "", sector = "", responsable = "";

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
  const code = e.target.value.trim();
  if (code.length >= 6) { // Código mínimo razonable
    e.target.value = '';
    registrarCodigo(code);
  }
});

function registrarCodigo(code) {
  const equivalencia = equivalencias[code];
  const lista = document.getElementById('results');
  const item = document.createElement('li');

  if (equivalencia) {
    item.textContent = `${code} - ${equivalencia.descripcion} - Talle: ${equivalencia.talle} - Color: ${equivalencia.color}`;
    item.style.color = 'green';
    registrados.push({ code, ...equivalencia });
  } else {
    item.textContent = `${code} - Equivalencia no registrada`;
    item.style.color = 'red';
    noRegistrados.push(code);
  }

  lista.appendChild(item);
}

document.getElementById('export-registered').addEventListener('click', () => {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const name = `stock_${date}_${piso}_${sector}_${responsable}.csv`;
  const content = 'Codigo,Descripcion,Talle,Color\n' +
    registrados.map(r => `${r.code},${r.descripcion},${r.talle},${r.color}`).join('\n');
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
    const [codigo, descripcion, talle, color] = lines[i].split(',').map(e => e.trim());
    if (codigo) {
      equivalencias[codigo] = { descripcion, talle, color };
    }
  }
}
