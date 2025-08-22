// src/App.jsx
import React, { useState } from 'react';
import './App.css';
import equivalencias from './equivalencias.json';
import { saveAs } from 'file-saver';

const App = () => {
  const [codigo, setCodigo] = useState('');
  const [piso, setPiso] = useState('PB');
  const [sector, setSector] = useState('A');
  const [responsable, setResponsable] = useState('');
  const [registros, setRegistros] = useState([]);
  const [noRegistrados, setNoRegistrados] = useState([]);

  const handleScan = (e) => {
    const valor = e.target.value.trim();
    if (valor.length > 4) {
      setCodigo('');
      const equivalencia = equivalencias.find(eq => eq.COD === valor);

      const entrada = {
        fecha: new Date().toISOString().split('T')[0],
        piso,
        sector,
        responsable,
        codigo: valor,
        descripcion: equivalencia ? `${equivalencia.ARTICULO} ${equivalencia.TALLE} ${equivalencia.COLOR}` : 'Equivalencia no registrada'
      };

      if (equivalencia) {
        setRegistros([...registros, entrada]);
      } else {
        setNoRegistrados([...noRegistrados, entrada]);
      }
    } else {
      setCodigo(valor);
    }
  };

  const exportarCSV = (datos, tipo) => {
    const filas = datos.map(row => `${row.fecha},${row.piso},${row.sector},${row.responsable},${row.codigo},${row.descripcion}`);
    const contenido = filas.join('\n');
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const fecha = new Date().toISOString().split('T')[0];
    const nombre = `stock_${fecha}_${piso}_${sector}_${responsable}_${tipo}.csv`;
    saveAs(blob, nombre);
  };

  return (
    <div className="container">
      <h1>Inventario Henko Web</h1>

      <div className="formulario">
        <input
          type="text"
          placeholder="Código de barras"
          value={codigo}
          onChange={handleScan}
          autoFocus
        />
        <select onChange={e => setResponsable(e.target.value)} defaultValue="">
          <option value="">Responsable</option>
          <option value="Damian">Damian</option>
          <option value="Lisa">Lisa</option>
          <option value="Otro">Otro</option>
        </select>
        <select onChange={e => setPiso(e.target.value)} value={piso}>
          <option>PB</option>
          <option>1</option>
          <option>2</option>
        </select>
        <select onChange={e => setSector(e.target.value)} value={sector}>
          <option>A</option>
          <option>B</option>
          <option>C</option>
          <option>D</option>
        </select>
      </div>

      <div className="botones">
        <button onClick={() => exportarCSV(registros, 'registrados')}>Exportar CSV registrados</button>
        <button onClick={() => exportarCSV(noRegistrados, 'no_registrados')}>Exportar CSV no registrados</button>
      </div>

      <div className="tabla">
        <h3>Registros actuales</h3>
        <ul>
          {registros.map((r, i) => (
            <li key={i}><strong>{r.codigo}</strong> - {r.descripcion}</li>
          ))}
        </ul>
        <h3>No registrados</h3>
        <ul>
          {noRegistrados.map((r, i) => (
            <li key={i}><strong>{r.codigo}</strong> - {r.descripcion}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default App;
