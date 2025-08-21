import React, { useState } from "react";
import { saveAs } from "file-saver";
import equivalencias from "./equivalencias.json";

function App() {
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [piso, setPiso] = useState("PB");
  const [sector, setSector] = useState("A");
  const [responsable, setResponsable] = useState("Damian");
  const [pickeados, setPickeados] = useState([]);
  const [error, setError] = useState("");

  const equivalenciasMap = Object.fromEntries(
    equivalencias.map((e) => [e.codigo, e])
  );

  const registrar = () => {
    if (!codigo || !cantidad || isNaN(cantidad)) {
      setError("Código o cantidad inválida");
      return;
    }
    if (!equivalenciasMap[codigo]) {
      setError("Código no encontrado en base");
      return;
    }
    const nuevos = Array(parseInt(cantidad)).fill(codigo);
    setPickeados([...pickeados, ...nuevos]);
    setCodigo("");
    setCantidad(1);
    setError("");
  };

  const exportar = () => {
    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const nombre = `stock_${fecha}_${piso}_${sector}_${responsable}.csv`;
    const blob = new Blob([pickeados.join("\\n")], {
      type: "text/csv;charset=utf-8",
    });
    saveAs(blob, nombre);
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: "auto" }}>
      <h2>Inventario Henko Web</h2>

      <input
        placeholder="Código de barras"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
      />

      <input
        type="number"
        placeholder="Cantidad"
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
      />

      <select value={piso} onChange={(e) => setPiso(e.target.value)}>
        <option value="PB">PB</option>
        <option value="1erPiso">1er Piso</option>
        <option value="Deposito">Depósito</option>
      </select>

      <select value={sector} onChange={(e) => setSector(e.target.value)}>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="Caja1">Caja 1</option>
      </select>

      <select
        value={responsable}
        onChange={(e) => setResponsable(e.target.value)}
      >
        <option value="Damian">Damian</option>
        <option value="Luciana">Luciana</option>
        <option value="EncargadoP1">Encargado Piso 1</option>
      </select>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <button onClick={registrar}>Registrar</button>
      <button onClick={exportar}>Exportar CSV</button>

      <div
        style={{
          maxHeight: 200,
          overflowY: "auto",
          marginTop: 10,
          background: "#eee",
          padding: 10,
        }}
      >
        {pickeados.map((p, i) => (
          <div key={i}>{p}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
