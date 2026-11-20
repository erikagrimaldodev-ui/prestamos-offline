import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { getAllRows, runQuery } from "../../database/db";

type FrecuenciaPago = "diario" | "semanal" | "quincenal" | "mensual";
type MonedaPrestamo = "COP" | "USD";

interface Cliente {
  id: number;
  nombre: string;
  telefono: string | null;
}

const CUOTAS_POR_FRECUENCIA: Record<FrecuenciaPago, string> = {
  diario: "24",
  semanal: "4",
  quincenal: "2",
  mensual: "1",
};

const INTERES_POR_FRECUENCIA: Record<FrecuenciaPago, string> = {
  diario: "20",
  semanal: "25",
  quincenal: "25",
  mensual: "25",
};

const redondearCuotaPorMoneda = (
  valor: number,
  moneda: MonedaPrestamo,
): number => {
  if (Number.isNaN(valor) || valor <= 0) return 0;
  if (moneda === "USD") {
    return Math.ceil(valor * 10) / 10;
  }
  return Math.ceil(valor / 100) * 100;
};

const formatearMilesEntero = (valor: number | null | undefined): string => {
  const num = valor ?? 0;
  const redondeado = Math.round(Number.isNaN(num) ? 0 : num);
  return redondeado.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const formatearDecimalUsd = (valor: number | null | undefined): string => {
  const num = Number(valor ?? 0);
  const seguro = Number.isNaN(num) ? 0 : num;
  const fijo = seguro.toFixed(1);
  const [entero, dec] = fijo.split(".");
  const enteroMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec === "0" ? enteroMiles : `${enteroMiles}.${dec}`;
};

const formatearMontoMoneda = (
  valor: number | null | undefined,
  moneda: MonedaPrestamo,
  conDecimalUsd = false,
): string => {
  if (moneda === "USD") {
    const cuerpo = conDecimalUsd
      ? formatearDecimalUsd(valor)
      : formatearMilesEntero(valor);
    return `USD$ ${cuerpo}`;
  }
  return `$ ${formatearMilesEntero(valor)}`;
};

const formatearInputMiles = (texto: string): string => {
  const soloDigitos = texto.replace(/[^0-9]/g, "");
  if (!soloDigitos) return "";
  const numero = parseInt(soloDigitos, 10);
  if (Number.isNaN(numero)) return "";
  return formatearMilesEntero(numero);
};

const parseMontoMiles = (texto: string): number => {
  const soloDigitos = texto.replace(/[^0-9]/g, "");
  if (!soloDigitos) return 0;
  const numero = parseInt(soloDigitos, 10);
  return Number.isNaN(numero) ? 0 : numero;
};

const obtenerFechaLocalHoy = (): string => {
  const ahora = new Date();
  const year = ahora.getFullYear();
  const month = String(ahora.getMonth() + 1).padStart(2, "0");
  const day = String(ahora.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function PrestarScreen() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [clienteSeleccionado, setClienteSeleccionado] =
    useState<Cliente | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const [moneda, setMoneda] = useState<MonedaPrestamo>("COP");
  const [monto, setMonto] = useState("");
  const [interes, setInteres] = useState(INTERES_POR_FRECUENCIA.diario);
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPago>("diario");
  const [cuotas, setCuotas] = useState(CUOTAS_POR_FRECUENCIA.diario);
  const [fechaManual, setFechaManual] = useState(obtenerFechaLocalHoy());
  const [aviso, setAviso] = useState("");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getAllRows<Cliente>("SELECT * FROM clientes ORDER BY nombre ASC").then(
        (lista) => {
          if (active) setClientes(lista);
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );

  const clientesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [clientes, busqueda]);

  const montoNum = parseMontoMiles(monto);
  const interesNum = parseFloat(interes.replace(",", ".")) || 0;
  const cuotasNum = Math.max(1, parseInt(cuotas, 10) || 1);
  const montoTotalRaw = montoNum + montoNum * (interesNum / 100);
  const montoTotal =
    moneda === "USD"
      ? Math.round(montoTotalRaw * 10) / 10
      : Math.round(montoTotalRaw);
  const valorCuota =
    cuotasNum > 0
      ? redondearCuotaPorMoneda(montoTotalRaw / cuotasNum, moneda)
      : 0;

  const seleccionarFrecuencia = (nuevaFreq: FrecuenciaPago) => {
    setFrecuencia(nuevaFreq);
    setCuotas(CUOTAS_POR_FRECUENCIA[nuevaFreq]);
    setInteres(INTERES_POR_FRECUENCIA[nuevaFreq]);
  };

  const abrirModal = (cliente: Cliente) => {
    setClienteSeleccionado(cliente);
    setMoneda("COP");
    setMonto("");
    setFrecuencia("diario");
    setInteres(INTERES_POR_FRECUENCIA.diario);
    setCuotas(CUOTAS_POR_FRECUENCIA.diario);
    setFechaManual(obtenerFechaLocalHoy());
    setAviso("");
    setModalVisible(true);
  };

  const guardarPrestamo = async () => {
    if (!clienteSeleccionado || montoNum <= 0 || cuotasNum <= 0) {
      setAviso("Ingresa un monto y cantidad de cuotas válidos.");
      return;
    }

    const fechaLimpia = fechaManual.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaLimpia)) {
      setAviso("Ingresa una fecha válida en formato YYYY-MM-DD.");
      return;
    }

    try {
      await runQuery(
        `INSERT INTO prestamos
        (cliente_id, monto_prestado, interes_porcentaje, frecuencia, cantidad_cuotas, monto_total, valor_cuota, saldo_pendiente, fecha_creacion, moneda)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clienteSeleccionado.id,
          montoNum,
          interesNum,
          frecuencia,
          cuotasNum,
          montoTotal,
          valorCuota,
          montoTotal,
          fechaLimpia,
          moneda,
        ],
      );
      setModalVisible(false);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.toLowerCase().includes("moneda")) {
        try {
          await runQuery(
            `INSERT INTO prestamos
            (cliente_id, monto_prestado, interes_porcentaje, frecuencia, cantidad_cuotas, monto_total, valor_cuota, saldo_pendiente, fecha_creacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              clienteSeleccionado.id,
              montoNum,
              interesNum,
              frecuencia,
              cuotasNum,
              montoTotal,
              valorCuota,
              montoTotal,
              fechaLimpia,
            ],
          );
          setModalVisible(false);
          return;
        } catch (innerErr: any) {
          setAviso(`Error al guardar: ${innerErr?.message || "error"}`);
          return;
        }
      }
      setAviso(`Error al guardar: ${e?.message || "error"}`);
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.buscador}
        placeholder="Buscar cliente por nombre..."
        value={busqueda}
        onChangeText={setBusqueda}
      />

      <FlatList
        data={clientesFiltrados}
        keyExtractor={(item) => item.id.toString()}
        ListEmptyComponent={
          <Text style={styles.vacio}>No hay clientes para mostrar.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => abrirModal(item)}
          >
            <Text style={styles.nombre}>{item.nombre}</Text>
            <Text style={styles.subtexto}>Tel: {item.telefono || "N/A"}</Text>
          </TouchableOpacity>
        )}
      />

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Préstamo para: {clienteSeleccionado?.nombre}
            </Text>

            <Text style={styles.label}>Tipo de moneda:</Text>
            <View style={styles.row}>
              {(
                [
                  { key: "COP", label: "COP" },
                  { key: "USD", label: "USD" },
                ] as const
              ).map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.chip, moneda === m.key && styles.chipActivo]}
                  onPress={() => setMoneda(m.key)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      moneda === m.key && { color: "#fff" },
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>
              Monto a prestar ({moneda === "USD" ? "USD$" : "$"}):
            </Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={monto}
              onChangeText={(texto) => setMonto(formatearInputMiles(texto))}
              placeholder="Ej: 100.000"
            />

            <Text style={styles.label}>Interés (%):</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={interes}
              onChangeText={(texto) =>
                setInteres(texto.replace(/[^0-9.,]/g, ""))
              }
              placeholder="Ej: 20"
            />

            <Text style={styles.label}>Frecuencia de pago:</Text>
            <View style={styles.row}>
              {(["diario", "semanal", "quincenal", "mensual"] as const).map(
                (freq) => (
                  <TouchableOpacity
                    key={freq}
                    style={[
                      styles.chip,
                      frecuencia === freq && styles.chipActivo,
                    ]}
                    onPress={() => seleccionarFrecuencia(freq)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        frecuencia === freq && { color: "#fff" },
                      ]}
                    >
                      {freq.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ),
              )}
            </View>

            <Text style={styles.label}>Cantidad de días / cuotas:</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={cuotas}
              onChangeText={(texto) => setCuotas(texto.replace(/[^0-9]/g, ""))}
              placeholder="Ej: 24"
            />

            <Text style={styles.label}>Fecha del préstamo (YYYY-MM-DD):</Text>
            <TextInput
              style={styles.input}
              value={fechaManual}
              onChangeText={setFechaManual}
              placeholder="2026-11-20"
              maxLength={10}
            />

            <View style={styles.resumenBox}>
              <Text style={styles.resumenText}>
                Moneda:{" "}
                {moneda === "USD" ? "Dólares (USD)" : "Pesos colombianos (COP)"}
              </Text>
              <Text style={styles.resumenText}>
                Total a Pagar: {formatearMontoMoneda(montoTotal, moneda, true)}
              </Text>
              <Text style={styles.resumenText}>
                Valor Cuota ({frecuencia}):{" "}
                {formatearMontoMoneda(valorCuota, moneda, true)}
              </Text>
            </View>

            {aviso ? <Text style={styles.avisoError}>{aviso}</Text> : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.btnCancelar}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: "#fff" }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnGuardar}
                onPress={guardarPrestamo}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>
                  Guardar Préstamo
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#F8FAFC" },
  buscador: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  vacio: { textAlign: "center", color: "#64748B", marginTop: 24 },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 10,
    elevation: 2,
  },
  nombre: { fontSize: 16, fontWeight: "bold", color: "#0F172A" },
  subtexto: { fontSize: 13, color: "#64748B", marginTop: 4 },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 16,
  },
  modalContent: { backgroundColor: "#fff", borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "600", marginTop: 8, color: "#334155" },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  chipActivo: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  chipText: { fontSize: 11, fontWeight: "bold", color: "#334155" },
  resumenBox: {
    backgroundColor: "#EFF6FF",
    padding: 12,
    borderRadius: 8,
    marginTop: 14,
  },
  resumenText: { fontSize: 15, fontWeight: "bold", color: "#1E3A8A" },
  avisoError: {
    color: "#DC2626",
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  btnCancelar: {
    backgroundColor: "#EF4444",
    padding: 12,
    borderRadius: 8,
    flex: 0.48,
    alignItems: "center",
  },
  btnGuardar: {
    backgroundColor: "#16A34A",
    padding: 12,
    borderRadius: 8,
    flex: 0.48,
    alignItems: "center",
  },
});
