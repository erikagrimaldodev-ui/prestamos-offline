import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { getAllRows, getFirstRow, runQuery } from "../../database/db";

type MonedaRegistro = "COP" | "USD";

interface PrestamoHistorial {
  id: number;
  cliente_id: number;
  cliente_nombre: string;
  monto_prestado: number;
  monto_total: number;
  saldo_pendiente: number;
  cantidad_cuotas: number;
  frecuencia: string;
  fecha_creacion: string;
  estado: string;
  moneda?: string | null;
  prestamo_origen_id: number | null;
  prestamo_destino_id: number | null;
}

interface PagoHistorial {
  id: number;
  cliente_nombre: string;
  prestamo_id: number;
  monto_pagado: number;
  fecha_pago: string;
  moneda?: string | null;
  monto_prestado?: number | null;
  fecha_prestamo?: string | null;
  saldo_pendiente?: number | null;
}

type ObjetivoEliminar =
  | { kind: "prestamo"; item: PrestamoHistorial }
  | { kind: "pago"; item: PagoHistorial }
  | null;

const normalizarMoneda = (moneda?: string | null): MonedaRegistro => {
  return (moneda || "").trim().toUpperCase() === "USD" ? "USD" : "COP";
};

const formatearMilesEntero = (valor: number | null | undefined): string => {
  const num = Number(valor ?? 0);
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

const formatearMontoRegistrado = (
  valor: number | null | undefined,
  moneda?: string | null,
): string => {
  const tipo = normalizarMoneda(moneda);
  if (tipo === "USD") {
    return `US$ ${formatearDecimalUsd(valor)}`;
  }
  return `$ ${formatearMilesEntero(valor)}`;
};

export default function HistorialScreen() {
  const [tab, setTab] = useState<"prestamos" | "pagos">("prestamos");
  const [filtroEstado, setFiltroEstado] = useState<
    "todos" | "activo" | "pagado" | "renovado"
  >("todos");
  const [filtroMoneda, setFiltroMoneda] = useState<MonedaRegistro | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [prestamos, setPrestamos] = useState<PrestamoHistorial[]>([]);
  const [pagos, setPagos] = useState<PagoHistorial[]>([]);
  const [objetivoEliminar, setObjetivoEliminar] =
    useState<ObjetivoEliminar>(null);
  const [aviso, setAviso] = useState("");

  const toggleMoneda = (moneda: MonedaRegistro) => {
    setFiltroMoneda((prev) => (prev === moneda ? null : moneda));
  };

  const cargarHistorial = useCallback(async () => {
    const [listaPrestamos, listaPagos] = await Promise.all([
      getAllRows<PrestamoHistorial>(`
        SELECT
          p.*,
          c.nombre AS cliente_nombre,
          (
            SELECT p_ant.id
            FROM prestamos p_ant
            WHERE p_ant.cliente_id = p.cliente_id
              AND p_ant.id < p.id
              AND LOWER(TRIM(COALESCE(p_ant.estado, ''))) = 'renovado'
              AND NOT EXISTS (
                SELECT 1 FROM prestamos p_mid
                WHERE p_mid.cliente_id = p.cliente_id
                  AND p_mid.id > p_ant.id
                  AND p_mid.id < p.id
              )
            ORDER BY p_ant.id DESC
            LIMIT 1
          ) AS prestamo_origen_id,
          (
            SELECT p_sig.id
            FROM prestamos p_sig
            WHERE p_sig.cliente_id = p.cliente_id
              AND p_sig.id > p.id
              AND LOWER(TRIM(COALESCE(p.estado, ''))) = 'renovado'
              AND NOT EXISTS (
                SELECT 1 FROM prestamos p_mid
                WHERE p_mid.cliente_id = p.cliente_id
                  AND p_mid.id > p.id
                  AND p_mid.id < p_sig.id
              )
            ORDER BY p_sig.id ASC
            LIMIT 1
          ) AS prestamo_destino_id
        FROM prestamos p
        JOIN clientes c ON p.cliente_id = c.id
        ORDER BY p.id DESC
      `),
      getAllRows<PagoHistorial>(`
        SELECT
          pg.*,
          c.nombre AS cliente_nombre,
          p.moneda AS moneda,
          p.monto_prestado AS monto_prestado,
          p.fecha_creacion AS fecha_prestamo,
          p.saldo_pendiente AS saldo_pendiente
        FROM pagos pg
        JOIN clientes c ON pg.cliente_id = c.id
        LEFT JOIN prestamos p ON pg.prestamo_id = p.id
        ORDER BY pg.id DESC
      `),
    ]);
    setPrestamos(listaPrestamos);
    setPagos(listaPagos);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      cargarHistorial().catch(() => {
        if (active) setAviso("No se pudo cargar el historial.");
      });
      return () => {
        active = false;
      };
    }, [cargarHistorial]),
  );

  const prestamosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return prestamos.filter((p) => {
      const estadoLower = (p.estado || "").trim().toLowerCase();
      const coincideEstado =
        filtroEstado === "todos" ||
        (filtroEstado === "renovado"
          ? estadoLower === "renovado" || p.prestamo_origen_id !== null
          : estadoLower === filtroEstado);
      const coincideMoneda =
        filtroMoneda === null || normalizarMoneda(p.moneda) === filtroMoneda;
      const coincideNombre = !q || p.cliente_nombre.toLowerCase().includes(q);
      return coincideEstado && coincideMoneda && coincideNombre;
    });
  }, [prestamos, busqueda, filtroEstado, filtroMoneda]);

  const pagosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return pagos.filter((pg) => {
      const coincideMoneda =
        filtroMoneda === null || normalizarMoneda(pg.moneda) === filtroMoneda;
      const coincideTexto =
        !q ||
        pg.cliente_nombre.toLowerCase().includes(q) ||
        String(pg.prestamo_id).includes(q) ||
        (pg.fecha_prestamo || "").toLowerCase().includes(q) ||
        String(pg.monto_prestado ?? "").includes(q);
      return coincideMoneda && coincideTexto;
    });
  }, [pagos, busqueda, filtroMoneda]);

  const confirmarEliminacion = async () => {
    if (!objetivoEliminar) return;
    setAviso("");

    try {
      if (objetivoEliminar.kind === "pago") {
        const pago = objetivoEliminar.item;
        const prestamoActual = await getFirstRow<{
          id: number;
          monto_total: number;
          saldo_pendiente: number;
        }>(
          "SELECT id, monto_total, saldo_pendiente FROM prestamos WHERE id = ?",
          [pago.prestamo_id],
        );

        await runQuery("DELETE FROM pagos WHERE id = ?", [pago.id]);

        if (prestamoActual) {
          const nuevoSaldo = Math.min(
            Number(prestamoActual.monto_total),
            Number(prestamoActual.saldo_pendiente) + Number(pago.monto_pagado),
          );
          const nuevoEstado = nuevoSaldo > 0 ? "activo" : "pagado";
          await runQuery(
            "UPDATE prestamos SET saldo_pendiente = ?, estado = ? WHERE id = ?",
            [nuevoSaldo, nuevoEstado, prestamoActual.id],
          );
        }
      } else {
        const prestamo = objetivoEliminar.item;
        await runQuery("DELETE FROM pagos WHERE prestamo_id = ?", [
          prestamo.id,
        ]);
        await runQuery("DELETE FROM prestamos WHERE id = ?", [prestamo.id]);
      }

      setObjetivoEliminar(null);
      await cargarHistorial();
    } catch (e: any) {
      setObjetivoEliminar(null);
      setAviso(`Error al eliminar: ${e?.message || "error en base de datos"}`);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "prestamos" && styles.tabActiva]}
          onPress={() => {
            setTab("prestamos");
            setAviso("");
          }}
        >
          <Text
            style={[styles.tabTexto, tab === "prestamos" && styles.textoBlanco]}
          >
            Préstamos ({prestamos.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "pagos" && styles.tabActiva]}
          onPress={() => {
            setTab("pagos");
            setAviso("");
          }}
        >
          <Text
            style={[styles.tabTexto, tab === "pagos" && styles.textoBlanco]}
          >
            Pagos ({pagos.length})
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.buscador}
        placeholder={
          tab === "prestamos"
            ? "Buscar préstamo por cliente..."
            : "Buscar pago por cliente, # préstamo, fecha o monto prestado..."
        }
        value={busqueda}
        onChangeText={setBusqueda}
      />

      {tab === "prestamos" ? (
        <View style={styles.filtrosRow}>
          {(
            [
              { key: "todos", label: "Todos" },
              { key: "activo", label: "Activos" },
              { key: "pagado", label: "Pagados" },
              { key: "renovado", label: "Renovados" },
            ] as const
          ).map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filtroChip,
                filtroEstado === f.key && styles.filtroChipActivo,
              ]}
              onPress={() => setFiltroEstado(f.key)}
            >
              <Text
                style={[
                  styles.filtroTexto,
                  filtroEstado === f.key && styles.textoBlanco,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.filtrosMonedaRow}>
        <Text style={styles.filtroMonedaLabel}>Moneda:</Text>
        {(
          [
            { key: "COP", label: "COP (Pesos)" },
            { key: "USD", label: "USD (Dólares)" },
          ] as const
        ).map((m) => {
          const seleccionada = filtroMoneda === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.filtroChip,
                styles.filtroMonedaChip,
                seleccionada && styles.filtroMonedaChipActivo,
              ]}
              onPress={() => toggleMoneda(m.key)}
            >
              <Text
                style={[styles.filtroTexto, seleccionada && styles.textoBlanco]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Text style={styles.filtroMonedaHint}>
          {filtroMoneda === null
            ? "Mostrando COP y USD"
            : `Solo ${filtroMoneda} (toca de nuevo para ver ambas)`}
        </Text>
      </View>

      {aviso ? <Text style={styles.aviso}>{aviso}</Text> : null}

      {tab === "prestamos" ? (
        <FlatList
          data={prestamosFiltrados}
          keyExtractor={(item) => `p-${item.id}`}
          ListEmptyComponent={
            <Text style={styles.vacio}>No hay préstamos para mostrar.</Text>
          }
          renderItem={({ item }) => {
            const estadoLower = (item.estado || "").trim().toLowerCase();
            const monedaReg = normalizarMoneda(item.moneda);
            const textoRenovacion =
              item.prestamo_origen_id !== null
                ? `Renovado del préstamo #${item.prestamo_origen_id} → Nuevo #${item.id}`
                : estadoLower === "renovado" &&
                    item.prestamo_destino_id !== null
                  ? `Préstamo anterior #${item.id} → Renovado en #${item.prestamo_destino_id}`
                  : null;

            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.nombre}>
                    {item.cliente_nombre} (#{item.id})
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      setObjetivoEliminar({ kind: "prestamo", item })
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.btnEliminar}>Eliminar</Text>
                  </TouchableOpacity>
                </View>
                {textoRenovacion ? (
                  <Text style={styles.renovacionDetalle}>
                    {textoRenovacion}
                  </Text>
                ) : null}
                <Text style={styles.fecha}>
                  Fecha: {item.fecha_creacion || "N/A"} • Moneda: {monedaReg}
                </Text>
                <Text style={styles.detalle}>
                  Prestado:{" "}
                  {formatearMontoRegistrado(item.monto_prestado, monedaReg)} |
                  Total: {formatearMontoRegistrado(item.monto_total, monedaReg)}{" "}
                  ({item.cantidad_cuotas} {item.frecuencia})
                </Text>
                <Text style={styles.saldo}>
                  Saldo pendiente:{" "}
                  {formatearMontoRegistrado(item.saldo_pendiente, monedaReg)} •{" "}
                  {item.estado.toUpperCase()} ({monedaReg})
                </Text>
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={pagosFiltrados}
          keyExtractor={(item) => `pg-${item.id}`}
          ListEmptyComponent={
            <Text style={styles.vacio}>No hay pagos para mostrar.</Text>
          }
          renderItem={({ item }) => {
            const monedaReg = normalizarMoneda(item.moneda);
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.nombre}>
                    {item.cliente_nombre} (#{item.prestamo_id})
                  </Text>
                  <TouchableOpacity
                    onPress={() => setObjetivoEliminar({ kind: "pago", item })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.btnEliminar}>Eliminar</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.pagoMonto}>
                  Pagado:{" "}
                  {formatearMontoRegistrado(item.monto_pagado, monedaReg)}
                </Text>
                <Text style={styles.detalle}>
                  Fecha pago: {item.fecha_pago} • Moneda: {monedaReg}
                </Text>
                <Text style={styles.detallePrestamo}>
                  Préstamo #{item.prestamo_id}:{" "}
                  {formatearMontoRegistrado(item.monto_prestado, monedaReg)} •
                  Fecha préstamo: {item.fecha_prestamo || "N/A"}
                </Text>
                <Text style={styles.saldo}>
                  Saldo pendiente:{" "}
                  {formatearMontoRegistrado(item.saldo_pendiente, monedaReg)}
                </Text>
              </View>
            );
          }}
        />
      )}

      <Modal
        visible={objetivoEliminar !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setObjetivoEliminar(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>
              {objetivoEliminar?.kind === "prestamo"
                ? "¿Eliminar préstamo?"
                : "¿Eliminar pago?"}
            </Text>
            <Text style={styles.modalTexto}>
              {objetivoEliminar?.kind === "prestamo"
                ? `Se eliminará el préstamo #${objetivoEliminar.item.id} de "${objetivoEliminar.item.cliente_nombre}" junto con sus pagos asociados.`
                : objetivoEliminar?.kind === "pago"
                  ? `Se eliminará el pago de ${formatearMontoRegistrado(objetivoEliminar.item.monto_pagado, objetivoEliminar.item.moneda)} de "${objetivoEliminar.item.cliente_nombre}" y se restaurará el saldo del préstamo #${objetivoEliminar.item.prestamo_id}.`
                  : ""}
            </Text>
            <View style={styles.modalBotones}>
              <TouchableOpacity
                style={styles.btnModalCancelar}
                onPress={() => setObjetivoEliminar(null)}
              >
                <Text style={styles.btnModalCancelarTexto}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnModalConfirmar}
                onPress={confirmarEliminacion}
              >
                <Text style={styles.btnModalConfirmarTexto}>
                  Confirmar eliminar
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
  tabs: { flexDirection: "row", gap: 10, marginBottom: 10 },
  tabBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
  },
  tabActiva: { backgroundColor: "#0F172A" },
  tabTexto: { fontWeight: "bold", color: "#334155" },
  textoBlanco: { color: "#fff" },
  buscador: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  filtrosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  filtrosMonedaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  filtroMonedaLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  filtroMonedaHint: {
    fontSize: 11,
    color: "#64748B",
    fontStyle: "italic",
  },
  filtroChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
  },
  filtroChipActivo: {
    backgroundColor: "#1E293B",
  },
  filtroMonedaChip: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  filtroMonedaChipActivo: {
    backgroundColor: "#1D4ED8",
    borderColor: "#1D4ED8",
  },
  filtroTexto: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  renovacionDetalle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1D4ED8",
    marginTop: 3,
  },
  aviso: {
    color: "#DC2626",
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
  },
  vacio: {
    textAlign: "center",
    color: "#64748B",
    marginTop: 24,
    fontSize: 14,
  },
  card: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 8,
    marginBottom: 10,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  nombre: { fontSize: 16, fontWeight: "bold", color: "#0F172A" },
  btnEliminar: { fontSize: 13, fontWeight: "700", color: "#DC2626" },
  fecha: { fontSize: 12, fontWeight: "600", color: "#475569", marginTop: 2 },
  detalle: { fontSize: 13, color: "#475569", marginTop: 4 },
  detallePrestamo: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    marginTop: 4,
  },
  saldo: { fontSize: 13, fontWeight: "600", color: "#1E3A8A", marginTop: 4 },
  pagoMonto: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#16A34A",
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    elevation: 5,
  },
  modalTitulo: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 8,
  },
  modalTexto: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 20,
    marginBottom: 18,
  },
  modalBotones: {
    gap: 10,
  },
  btnModalCancelar: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
  },
  btnModalCancelarTexto: {
    color: "#334155",
    fontWeight: "700",
    fontSize: 14,
  },
  btnModalConfirmar: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
  },
  btnModalConfirmarTexto: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
