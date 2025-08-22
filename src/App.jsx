import React, { useState } from 'react';
import equivalencias from './equivalencias.json';

function App() {
  const [codigo, setCodigo] = useState('');
  const [items, setItems] = useState([]);
  const [noEncontrados, setNoEncontrados] = useState([]);
  const [piso, setPiso] = useState('PB');
  const [sector, setSector] = useState('A');
  const [responsable, setResponsable] = useState('Damian');

  const agregarCodigo = (value) => {
    const encontrado = equivalencias.find(e => e.CODIGO === value);
    if (encontrado) {
      setItems(prev => [...prev, encontrado]);
    } else {
      setNoEncontrados(prev => [...prev, value]);
    }
  };

  const handleChange = (e) => {
    const val = e.target.value.trim();
    setCodigo('');
    if (val.length > 0) agregarCodigo(val);
  };

  const exportar = (data, nombre) => {
    const contenido = data.map(d =>
      typeof d === 'string'
        ? d
        : `${d.CODIGO},${d.ARTICULO},${d.TALLE},${d.COLOR}`
    ).join('\n');
    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_${fecha}_${piso}_${sector}_${responsable}_${nombre}.csv`;
    a.click();
  };

  return (
    <div className="container">
      <h1>Inventario RIO</h1>
      <div className="form">
        <select onChange={(e) => setPiso(e.target.value)} value={piso}>
          <option value="PB">PB</option>
          <option value="P1">P1</option>
        </select>
        <select onChange={(e) => setSector(e.target.value)} value={sector}>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
        <select onChange={(e) => setResponsable(e.target.value)} value={responsable}>
          <option value="Damian">Damian</option>
          <option value="Otro">Otro</option>
        </select>
        <input
          type="text"
          placeholder="Escaneá el código"
          autoFocus
          value={codigo}
          onChange={handleChange}
        />
      </div>
      <div className="resultados">
        <h2>Registrados ({items.length})</h2>
        <ul>
          {items.map((item, i) => (
            <li key={i}>{item.CODIGO} - {item.ARTICULO} - {item.TALLE} - {item.COLOR}</li>
          ))}
        </ul>
        <h2>No registrados ({noEncontrados.length})</h2>
        <ul>
          {noEncontrados.map((item, i) => (
            <li key={i}>{item} - Equivalencia no registrada</li>
          ))}
        </ul>
      </div>
      <div className="botones">
        <button onClick={() => exportar(items, 'registrados')}>Exportar Registrados</button>
        <button onClick={() => exportar(noEncontrados, 'no_registrados')}>Exportar No Registrados</button>
      </div>
    </div>
  );
}

export default App;