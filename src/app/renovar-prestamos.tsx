import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { getAllRows, getFirstRow, runQuery } from "../../database/db";

type FrecuenciaPago = "DIARIO" | "SEMANAL" | "QUINCENAL" | "MENSUAL";
type Moneda = "COP" | "USD";

interface PrestamoActivo {
  id: number;
  cliente_id: number;
  saldo_pendiente: number;
  valor_cuota: number;
  frecuencia: string;
  moneda?: string | null;
  cliente_nombre: string;
  renovado_hoy: number;
}

const CUOTAS_POR_FRECUENCIA: Record<FrecuenciaPago, string> = {
  DIARIO: "24",
  SEMANAL: "4",
  QUINCENAL: "2",
  MENSUAL: "1",
};

const INTERES_POR_FRECUENCIA: Record<FrecuenciaPago, string> = {
  DIARIO: "20",
  SEMANAL: "25",
  QUINCENAL: "25",
  MENSUAL: "25",
};

const FRECUENCIAS: FrecuenciaPago[] = [
  "DIARIO",
  "SEMANAL",
  "QUINCENAL",
  "MENSUAL",
];

const normalizarMoneda = (moneda?: string | null): Moneda => {
  return (moneda || "").trim().toUpperCase() === "USD" ? "USD" : "COP";
};

const redondearCuotaPorMoneda = (valor: number, moneda: Moneda): number => {
  if (Number.isNaN(valor) || valor <= 0) return 0;
  if (moneda === "USD") {
    return Math.ceil(valor * 10) / 10;
  }
  return Math.ceil(valor / 100) * 100;
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

const formatearMontoPorMoneda = (
  valor: number | null | undefined,
  moneda: Moneda,
): string => {
  if (moneda === "USD") {
    return `US$ ${formatearDecimalUsd(valor)}`;
  }
  return `$ ${formatearMilesEntero(valor)}`;
};

const formatearMontoParaInput = (
  valor: number | null | undefined,
  moneda: Moneda,
): string => {
  if (moneda === "USD") {
    return formatearDecimalUsd(valor);
  }
  return formatearMilesEntero(valor);
};

const formatearInputPorMoneda = (texto: string, moneda: Moneda): string => {
  if (moneda === "COP") {
    const soloDigitos = texto.replace(/[^0-9]/g, "");
    if (!soloDigitos) return "";
    const numero = parseInt(soloDigitos, 10);
    if (Number.isNaN(numero)) return "";
    return formatearMilesEntero(numero);
  }

  const filtrado = texto.replace(/[^0-9.,]/g, "");
  let tieneSeparador = false;
  let limpio = "";
  for (const ch of filtrado) {
    if (ch === "." || ch === ",") {
      if (!tieneSeparador) {
        limpio += ch;
        tieneSeparador = true;
      }
    } else {
      limpio += ch;
    }
  }
  return limpio;
};

const parseMontoPorMoneda = (texto: string, moneda: Moneda): number => {
  if (moneda === "COP") {
    const soloDigitos = texto.replace(/[^0-9]/g, "");
    if (!soloDigitos) return 0;
    const numero = parseInt(soloDigitos, 10);
    return Number.isNaN(numero) ? 0 : numero;
  }

  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return 0;
  const numero = parseFloat(limpio);
  return Number.isNaN(numero) ? 0 : numero;
};

const obtenerFechaLocalHoy = (): string => {
  const ahora = new Date();
  const year = ahora.getFullYear();
  const month = String(ahora.getMonth() + 1).padStart(2, "0");
  const day = String(ahora.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDecimal = (valor: string): number => {
  const num = parseFloat(valor.replace(",", "."));
  return Number.isNaN(num) ? 0 : num;
};

export default function RenovarPrestamosScreen() {
  const params = useLocalSearchParams<{ prestamoId?: string }>();

  const [prestamosActivos, setPrestamosActivos] = useState<PrestamoActivo[]>(
    [],
  );
  const [renovadosHoyIds, setRenovadosHoyIds] = useState<number[]>([]);
  const [prestamoSeleccionado, setPrestamoSeleccionado] =
    useState<PrestamoActivo | null>(null);
  const [modalRenovarVisible, setModalRenovarVisible] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const [fechaLocalHoy, setFechaLocalHoy] = useState(obtenerFechaLocalHoy());

  const [montoBaseInput, setMontoBaseInput] = useState("");
  const [interesInput, setInteresInput] = useState(
    INTERES_POR_FRECUENCIA.DIARIO,
  );
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPago>("DIARIO");
  const [cantidadCuotasInput, setCantidadCuotasInput] = useState(
    CUOTAS_POR_FRECUENCIA.DIARIO,
  );
  const [fechaCreacion, setFechaCreacion] = useState(obtenerFechaLocalHoy());

  const [mensajeModal, setMensajeModal] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);
  const [mensaje, setMensaje] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);

  const fechaHoyEfectiva = useMemo(() => {
    const limpia = fechaLocalHoy.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(limpia) ? limpia : obtenerFechaLocalHoy();
  }, [fechaLocalHoy]);

  const monedaActiva: Moneda = useMemo(() => {
    return normalizarMoneda(prestamoSeleccionado?.moneda);
  }, [prestamoSeleccionado]);

  const seleccionarFrecuencia = (nuevaFreq: FrecuenciaPago) => {
    setFrecuencia(nuevaFreq);
    setCantidadCuotasInput(CUOTAS_POR_FRECUENCIA[nuevaFreq]);
    setInteresInput(INTERES_POR_FRECUENCIA[nuevaFreq]);
  };

  const cargarPrestamos = useCallback(async () => {
    const rows = await getAllRows<PrestamoActivo>(
      `
      SELECT
        p.id,
        p.cliente_id,
        p.saldo_pendiente,
        p.valor_cuota,
        p.frecuencia,
        COALESCE(NULLIF(TRIM(p.moneda), ''), 'COP') AS moneda,
        c.nombre AS cliente_nombre,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM prestamos p_prev
            WHERE p_prev.cliente_id = p.cliente_id
              AND p_prev.id < p.id
              AND LOWER(TRIM(COALESCE(p_prev.estado, ''))) = 'renovado'
              AND SUBSTR(TRIM(COALESCE(p.fecha_creacion, '')), 1, 10) = ?
          )
          THEN 1
          ELSE 0
        END AS renovado_hoy
      FROM prestamos p
      JOIN clientes c ON p.cliente_id = c.id
      WHERE LOWER(TRIM(COALESCE(p.estado, ''))) = 'activo'
        AND p.saldo_pendiente > 0
      ORDER BY LOWER(TRIM(c.nombre)) ASC, p.id ASC
    `,
      [fechaHoyEfectiva],
    );

    const ordenadosAlfabetico = [...rows].sort((a, b) => {
      const cmp = a.cliente_nombre
        .trim()
        .localeCompare(b.cliente_nombre.trim(), "es", {
          sensitivity: "base",
        });
      return cmp !== 0 ? cmp : a.id - b.id;
    });

    setPrestamosActivos(ordenadosAlfabetico);

    if (params.prestamoId) {
      const targetId = Number(params.prestamoId);
      const encontrado = ordenadosAlfabetico.find((r) => r.id === targetId);
      if (encontrado) {
        const monedaPrest = normalizarMoneda(encontrado.moneda);
        const freqUpper =
          encontrado.frecuencia?.toUpperCase() as FrecuenciaPago;
        const freqValida = FRECUENCIAS.includes(freqUpper)
          ? freqUpper
          : "DIARIO";
        setPrestamoSeleccionado(encontrado);
        setMontoBaseInput(
          formatearMontoParaInput(encontrado.saldo_pendiente, monedaPrest),
        );
        setFrecuencia(freqValida);
        setInteresInput(INTERES_POR_FRECUENCIA[freqValida]);
        setCantidadCuotasInput(CUOTAS_POR_FRECUENCIA[freqValida]);
        setFechaCreacion(fechaHoyEfectiva);
        setModalRenovarVisible(true);
      }
    }
  }, [params.prestamoId, fechaHoyEfectiva]);

  useFocusEffect(
    useCallback(() => {
      const hoyLocal = obtenerFechaLocalHoy();
      setFechaLocalHoy(hoyLocal);
      setFechaCreacion(hoyLocal);
      void cargarPrestamos();
    }, [cargarPrestamos]),
  );

  const prestamosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return prestamosActivos;
    return prestamosActivos.filter((p) =>
      p.cliente_nombre.toLowerCase().includes(q),
    );
  }, [prestamosActivos, busqueda]);

  const handleDecimalChange =
    (setter: (val: string) => void) => (texto: string) => {
      const filtrado = texto.replace(/[^0-9.,]/g, "");
      let tieneSeparador = false;
      let limpio = "";

      for (const ch of filtrado) {
        if (ch === "." || ch === ",") {
          if (!tieneSeparador) {
            limpio += ch;
            tieneSeparador = true;
          }
        } else {
          limpio += ch;
        }
      }
      setter(limpio);
    };

  const abrirModalRenovar = (prestamo: PrestamoActivo) => {
    const monedaPrest = normalizarMoneda(prestamo.moneda);
    setMensaje(null);
    setMensajeModal(null);
    setPrestamoSeleccionado(prestamo);
    setMontoBaseInput(
      formatearMontoParaInput(prestamo.saldo_pendiente, monedaPrest),
    );
    const freqUpper = prestamo.frecuencia?.toUpperCase() as FrecuenciaPago;
    const freqValida = FRECUENCIAS.includes(freqUpper) ? freqUpper : "DIARIO";
    setFrecuencia(freqValida);
    setInteresInput(INTERES_POR_FRECUENCIA[freqValida]);
    setCantidadCuotasInput(CUOTAS_POR_FRECUENCIA[freqValida]);
    setFechaCreacion(fechaHoyEfectiva);
    setModalRenovarVisible(true);
  };

  const cerrarModalRenovar = () => {
    setModalRenovarVisible(false);
    setMensajeModal(null);
  };

  const calculoRenovacion = useMemo(() => {
    const base = parseMontoPorMoneda(montoBaseInput, monedaActiva);
    const pct = parseDecimal(interesInput);
    const cuotas = Math.max(1, parseInt(cantidadCuotasInput, 10) || 1);

    const montoInteresRaw = base * (pct / 100);
    const montoTotalRaw = base + montoInteresRaw;

    const montoInteres =
      monedaActiva === "USD"
        ? Math.round(montoInteresRaw * 10) / 10
        : Math.round(montoInteresRaw);

    const montoTotal =
      monedaActiva === "USD"
        ? Math.round(montoTotalRaw * 10) / 10
        : Math.round(montoTotalRaw);

    const valorCuota =
      cuotas > 0
        ? redondearCuotaPorMoneda(montoTotalRaw / cuotas, monedaActiva)
        : 0;

    return {
      base,
      pct,
      cuotas,
      montoInteres,
      montoTotal,
      valorCuota,
    };
  }, [montoBaseInput, interesInput, cantidadCuotasInput, monedaActiva]);

  const guardarRenovacion = async () => {
    setMensajeModal(null);
    setMensaje(null);

    if (!prestamoSeleccionado) {
      setMensajeModal({
        tipo: "error",
        texto: "Selecciona un préstamo activo para renovar.",
      });
      return;
    }

    const monedaPrest = normalizarMoneda(prestamoSeleccionado.moneda);

    if (calculoRenovacion.base <= 0) {
      setMensajeModal({
        tipo: "error",
        texto: "El monto pendiente a renovar debe ser mayor a 0.",
      });
      return;
    }

    if (calculoRenovacion.pct < 0) {
      setMensajeModal({
        tipo: "error",
        texto: "El porcentaje de interés no puede ser negativo.",
      });
      return;
    }

    if (calculoRenovacion.cuotas <= 0) {
      setMensajeModal({
        tipo: "error",
        texto: "Ingresa una cantidad de cuotas mayor a 0.",
      });
      return;
    }

    const fechaLimpia = fechaCreacion.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaLimpia)) {
      setMensajeModal({
        tipo: "error",
        texto: "La fecha del préstamo debe tener formato YYYY-MM-DD.",
      });
      return;
    }

    try {
      await runQuery(
        `UPDATE prestamos
         SET saldo_pendiente = 0, estado = 'renovado'
         WHERE id = ?`,
        [prestamoSeleccionado.id],
      );

      try {
        await runQuery(
          `INSERT INTO prestamos (
            cliente_id,
            monto_prestado,
            interes_porcentaje,
            frecuencia,
            cantidad_cuotas,
            monto_total,
            valor_cuota,
            saldo_pendiente,
            fecha_creacion,
            estado,
            moneda
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)`,
          [
            prestamoSeleccionado.cliente_id,
            calculoRenovacion.base,
            calculoRenovacion.pct,
            frecuencia.toLowerCase(),
            calculoRenovacion.cuotas,
            calculoRenovacion.montoTotal,
            calculoRenovacion.valorCuota,
            calculoRenovacion.montoTotal,
            fechaLimpia,
            monedaPrest,
          ],
        );
      } catch (insertErr: any) {
        const msg = String(insertErr?.message || "");
        if (!msg.toLowerCase().includes("moneda")) {
          throw insertErr;
        }
        await runQuery(
          `INSERT INTO prestamos (
            cliente_id,
            monto_prestado,
            interes_porcentaje,
            frecuencia,
            cantidad_cuotas,
            monto_total,
            valor_cuota,
            saldo_pendiente,
            fecha_creacion,
            estado
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo')`,
          [
            prestamoSeleccionado.cliente_id,
            calculoRenovacion.base,
            calculoRenovacion.pct,
            frecuencia.toLowerCase(),
            calculoRenovacion.cuotas,
            calculoRenovacion.montoTotal,
            calculoRenovacion.valorCuota,
            calculoRenovacion.montoTotal,
            fechaLimpia,
          ],
        );
      }

      const nuevoPrestamoRow = await getFirstRow<{ id: number }>(
        `SELECT id FROM prestamos WHERE cliente_id = ? ORDER BY id DESC LIMIT 1`,
        [prestamoSeleccionado.cliente_id],
      );

      if (nuevoPrestamoRow?.id) {
        setRenovadosHoyIds((prev) =>
          prev.includes(nuevoPrestamoRow.id)
            ? prev
            : [...prev, nuevoPrestamoRow.id],
        );
      }

      const nombreCliente = prestamoSeleccionado.cliente_nombre;
      const totalCreado = calculoRenovacion.montoTotal;

      setPrestamoSeleccionado(null);
      setModalRenovarVisible(false);
      await cargarPrestamos();

      setMensaje({
        tipo: "exito",
        texto: `Préstamo renovado (${monedaPrest}) para ${nombreCliente}: nuevo monto total ${formatearMontoPorMoneda(totalCreado, monedaPrest)} (${calculoRenovacion.pct}% interés).`,
      });
    } catch (e: any) {
      setMensajeModal({
        tipo: "error",
        texto: `Error al renovar préstamo: ${e?.message || "error"}`,
      });
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.filaSuperior}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Buscar cliente por nombre:</Text>
          <TextInput
            style={styles.buscador}
            placeholder="Escribe el nombre del cliente..."
            value={busqueda}
            onChangeText={setBusqueda}
          />
        </View>

        <View style={styles.cajaFechaHoy}>
          <Text style={styles.label}>Fecha del día (local):</Text>
          <TextInput
            style={styles.inputFechaHoy}
            value={fechaLocalHoy}
            onChangeText={setFechaLocalHoy}
            placeholder="YYYY-MM-DD"
            maxLength={10}
          />
        </View>
      </View>

      {mensaje ? (
        <View
          style={[
            styles.bannerMensaje,
            mensaje.tipo === "exito" ? styles.bannerExito : styles.bannerError,
          ]}
        >
          <Text
            style={[
              styles.bannerTexto,
              mensaje.tipo === "exito" ? styles.textoExito : styles.textoError,
            ]}
          >
            {mensaje.texto}
          </Text>
        </View>
      ) : null}

      <Text style={styles.label}>
        Préstamos activos ({prestamosFiltrados.length}) • Marca &quot;Renovado
        hoy&quot; (fecha local): {fechaHoyEfectiva}
      </Text>

      <View style={styles.listaPrestamos}>
        {prestamosFiltrados.map((item) => {
          const renovadoHoy =
            item.renovado_hoy === 1 || renovadosHoyIds.includes(item.id);
          const monedaItem = normalizarMoneda(item.moneda);

          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.itemCard,
                renovadoHoy && styles.itemCardRenovadoHoy,
              ]}
              onPress={() => abrirModalRenovar(item)}
            >
              <View style={styles.itemRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={styles.itemHeader}>
                    <Text
                      style={[
                        styles.itemTitle,
                        renovadoHoy && styles.textoRenovadoHoy,
                      ]}
                    >
                      {item.cliente_nombre} (#{item.id}) • {monedaItem}
                    </Text>
                    {renovadoHoy ? (
                      <View style={styles.badgeRenovado}>
                        <Text style={styles.badgeTexto}>Renovado hoy</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.itemSub}>
                    Saldo pendiente:{" "}
                    {formatearMontoPorMoneda(item.saldo_pendiente, monedaItem)}{" "}
                    | Cuota ({item.frecuencia}):{" "}
                    {formatearMontoPorMoneda(item.valor_cuota, monedaItem)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.btnRenovarItem}
                  onPress={() => abrirModalRenovar(item)}
                >
                  <Text style={styles.btnAccionTexto}>Renovar</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        {prestamosFiltrados.length === 0 && (
          <Text style={styles.vacio}>
            {busqueda.trim()
              ? "No se encontraron préstamos activos para ese nombre."
              : "No hay préstamos activos para renovar."}
          </Text>
        )}
      </View>

      <Modal
        visible={modalRenovarVisible}
        transparent
        animationType="fade"
        onRequestClose={cerrarModalRenovar}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitulo}>
                Renovar Préstamo — {prestamoSeleccionado?.cliente_nombre} (#
                {prestamoSeleccionado?.id})
              </Text>

              {prestamoSeleccionado ? (
                <View style={styles.resumenPrestamo}>
                  <Text style={styles.resumenTexto}>
                    Moneda del préstamo: {monedaActiva}
                  </Text>
                  <Text style={styles.resumenTexto}>
                    Saldo pendiente actual:{" "}
                    {formatearMontoPorMoneda(
                      prestamoSeleccionado.saldo_pendiente,
                      monedaActiva,
                    )}
                  </Text>
                  <Text style={styles.resumenTexto}>
                    Frecuencia anterior: {prestamoSeleccionado.frecuencia}
                  </Text>
                  <Text style={styles.resumenTexto}>
                    Fecha local del día: {fechaHoyEfectiva}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.modalLabel}>
                Monto pendiente a renovar (
                {monedaActiva === "USD" ? "US$" : "$"}
                ):
              </Text>
              <TextInput
                style={styles.input}
                keyboardType={
                  monedaActiva === "USD" ? "decimal-pad" : "number-pad"
                }
                value={montoBaseInput}
                onChangeText={(texto) =>
                  setMontoBaseInput(
                    formatearInputPorMoneda(texto, monedaActiva),
                  )
                }
                placeholder={monedaActiva === "USD" ? "Ej: 62.5" : "Ej: 50.000"}
              />

              <Text style={styles.modalLabel}>Interés (%):</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={interesInput}
                onChangeText={handleDecimalChange(setInteresInput)}
                placeholder="Ej: 20"
              />

              <Text style={styles.modalLabel}>Frecuencia de pago:</Text>
              <View style={styles.frecuenciaRow}>
                {FRECUENCIAS.map((freq) => {
                  const activa = frecuencia === freq;
                  return (
                    <TouchableOpacity
                      key={freq}
                      style={[
                        styles.frecuenciaBtn,
                        activa && styles.frecuenciaBtnActiva,
                      ]}
                      onPress={() => seleccionarFrecuencia(freq)}
                    >
                      <Text
                        style={[
                          styles.frecuenciaTexto,
                          activa && styles.frecuenciaTextoActivo,
                        ]}
                      >
                        {freq}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.modalLabel}>Cantidad de días / cuotas:</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={cantidadCuotasInput}
                onChangeText={(t) =>
                  setCantidadCuotasInput(t.replace(/[^0-9]/g, ""))
                }
                placeholder="24"
              />

              <Text style={styles.modalLabel}>
                Fecha del préstamo (YYYY-MM-DD):
              </Text>
              <TextInput
                style={styles.input}
                value={fechaCreacion}
                onChangeText={setFechaCreacion}
                placeholder="YYYY-MM-DD"
                maxLength={10}
              />

              <View style={styles.calculoBox}>
                <Text style={styles.calculoTexto}>Moneda: {monedaActiva}</Text>
                <Text style={styles.calculoTexto}>
                  Interés ({calculoRenovacion.pct}%): +
                  {formatearMontoPorMoneda(
                    calculoRenovacion.montoInteres,
                    monedaActiva,
                  )}
                </Text>
                <Text style={styles.calculoTexto}>
                  Monto Total a Pagar:{" "}
                  {formatearMontoPorMoneda(
                    calculoRenovacion.montoTotal,
                    monedaActiva,
                  )}
                </Text>
                <Text style={styles.calculoTexto}>
                  Valor Cuota ({frecuencia.toLowerCase()}):{" "}
                  {formatearMontoPorMoneda(
                    calculoRenovacion.valorCuota,
                    monedaActiva,
                  )}
                </Text>
              </View>

              {mensajeModal ? (
                <View
                  style={[
                    styles.bannerMensaje,
                    mensajeModal.tipo === "exito"
                      ? styles.bannerExito
                      : styles.bannerError,
                  ]}
                >
                  <Text
                    style={[
                      styles.bannerTexto,
                      mensajeModal.tipo === "exito"
                        ? styles.textoExito
                        : styles.textoError,
                    ]}
                  >
                    {mensajeModal.texto}
                  </Text>
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.btnCancelar}
                  onPress={cerrarModalRenovar}
                >
                  <Text style={styles.btnCancelarTexto}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.btnGuardar}
                  onPress={guardarRenovacion}
                >
                  <Text style={styles.btnGuardarTexto}>Guardar Renovación</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#F8FAFC" },
  filaSuperior: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  cajaFechaHoy: {
    width: 150,
  },
  label: { fontSize: 13, fontWeight: "600", color: "#334155", marginTop: 8 },
  buscador: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    padding: 11,
    marginTop: 6,
    fontSize: 15,
  },
  inputFechaHoy: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    padding: 11,
    marginTop: 6,
    fontSize: 14,
  },
  bannerMensaje: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  bannerExito: {
    backgroundColor: "#DCFCE7",
    borderColor: "#16A34A",
  },
  bannerError: {
    backgroundColor: "#FEF2F2",
    borderColor: "#DC2626",
  },
  bannerTexto: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  textoExito: { color: "#14532D" },
  textoError: { color: "#DC2626" },
  listaPrestamos: { marginTop: 8, gap: 8, paddingBottom: 24 },
  itemCard: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  itemCardRenovadoHoy: {
    backgroundColor: "#DCFCE7",
    borderColor: "#16A34A",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  itemTitle: { fontSize: 15, fontWeight: "bold", color: "#0F172A" },
  textoRenovadoHoy: { color: "#14532D" },
  itemSub: { fontSize: 12, color: "#64748B", marginTop: 3 },
  badgeRenovado: {
    backgroundColor: "#16A34A",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeTexto: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  btnRenovarItem: {
    backgroundColor: "#2563EB",
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  btnAccionTexto: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  vacio: { color: "#64748B", fontStyle: "italic", marginTop: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "90%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    elevation: 5,
  },
  modalTitulo: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 10,
  },
  resumenPrestamo: {
    backgroundColor: "#F1F5F9",
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    gap: 3,
  },
  resumenTexto: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1E293B",
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    marginTop: 10,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    padding: 11,
    marginTop: 5,
    fontSize: 15,
  },
  frecuenciaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  frecuenciaBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#fff",
  },
  frecuenciaBtnActiva: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  frecuenciaTexto: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  frecuenciaTextoActivo: {
    color: "#fff",
  },
  calculoBox: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 4,
  },
  calculoTexto: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1E3A8A",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 16,
  },
  btnCancelar: {
    flex: 1,
    backgroundColor: "#E2E8F0",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnCancelarTexto: {
    color: "#334155",
    fontWeight: "700",
    fontSize: 14,
  },
  btnGuardar: {
    flex: 1,
    backgroundColor: "#16A34A",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnGuardarTexto: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
