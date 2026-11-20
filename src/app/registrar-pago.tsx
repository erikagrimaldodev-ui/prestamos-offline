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
import { useFocusEffect } from "expo-router";
import { getAllRows, runQuery } from "../../database/db";

type Moneda = "COP" | "USD";

interface PrestamoActivo {
  id: number;
  cliente_id: number;
  saldo_pendiente: number;
  valor_cuota: number;
  frecuencia: string;
  moneda?: string | null;
  cliente_nombre: string;
  pagado_hoy: number;
}

interface SumaPagosHoyRow {
  total_hoy: number | null;
}

interface PagoPendienteConversion {
  prestamo: PrestamoActivo;
  montoPagoIngresado: number;
  monedaPago: Moneda;
  monedaPrestamo: Moneda;
  fechaPagoGuardada: string;
}

const normalizarMoneda = (moneda?: string | null): Moneda => {
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
  const fijo = seguro.toFixed(2);
  const [entero, dec] = fijo.split(".");
  const enteroMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec === "00" ? enteroMiles : `${enteroMiles}.${dec}`;
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

const formatearInputEnteroMiles = (texto: string): string => {
  const soloDigitos = texto.replace(/[^0-9]/g, "");
  if (!soloDigitos) return "";
  const numero = parseInt(soloDigitos, 10);
  if (Number.isNaN(numero)) return "";
  return numero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const parseInputEnteroMiles = (texto: string): number => {
  const soloDigitos = texto.replace(/[^0-9]/g, "");
  if (!soloDigitos) return 0;
  const numero = parseInt(soloDigitos, 10);
  return Number.isNaN(numero) ? 0 : numero;
};

const parseDecimalFlexible = (texto: string): number => {
  const limpio = texto.trim().replace(/\s+/g, "");
  if (!limpio) return 0;
  // Si tiene coma y punto, asumimos punto como miles y coma como decimal (ej. 4.200,50)
  if (limpio.includes(",") && limpio.includes(".")) {
    const val = parseFloat(limpio.replace(/\./g, "").replace(",", "."));
    return Number.isNaN(val) ? 0 : val;
  }
  if (limpio.includes(",")) {
    const val = parseFloat(limpio.replace(",", "."));
    return Number.isNaN(val) ? 0 : val;
  }
  const val = parseFloat(limpio);
  return Number.isNaN(val) ? 0 : val;
};

const obtenerFechaLocalHoy = (): string => {
  const ahora = new Date();
  const year = ahora.getFullYear();
  const month = String(ahora.getMonth() + 1).padStart(2, "0");
  const day = String(ahora.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function RegistrarPagoScreen() {
  const [prestamosActivos, setPrestamosActivos] = useState<PrestamoActivo[]>(
    [],
  );
  const [totalPagadoHoy, setTotalPagadoHoy] = useState<number>(0);
  const [prestamoSeleccionado, setPrestamoSeleccionado] =
    useState<PrestamoActivo | null>(null);
  const [modalPagoVisible, setModalPagoVisible] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [montoPagado, setMontoPagado] = useState("");
  const [monedaPago, setMonedaPago] = useState<Moneda>("COP");

  // Modal de tasa diaria cuando la moneda del pago difiere de la del préstamo
  const [pagoPendienteTasa, setPagoPendienteTasa] =
    useState<PagoPendienteConversion | null>(null);
  const [tasaDiariaInput, setTasaDiariaInput] = useState("3100");
  const [errorTasa, setErrorTasa] = useState("");
  const [guardandoTasa, setGuardandoTasa] = useState(false);

  // Fecha local del día (guía única para la franja verde "Pagado hoy")
  const [fechaLocalHoy, setFechaLocalHoy] = useState(obtenerFechaLocalHoy());
  // Fecha manual opcional de la tarjeta / cuota
  const [fechaTarjetaOpcional, setFechaTarjetaOpcional] = useState("");

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

  const cargarPrestamos = useCallback(async () => {
    const rows = await getAllRows<PrestamoActivo>(
      `
      SELECT
        p.id,
        p.cliente_id,
        p.saldo_pendiente,
        p.valor_cuota,
        p.frecuencia,
        p.moneda,
        c.nombre AS cliente_nombre,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM pagos pg
            WHERE pg.prestamo_id = p.id
              AND COALESCE(pg.fecha_registro_local, pg.fecha_pago) = ?
          ) THEN 1
          ELSE 0
        END AS pagado_hoy
      FROM prestamos p
      JOIN clientes c ON p.cliente_id = c.id
      WHERE p.estado = 'activo'
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

    const sumaRows = await getAllRows<SumaPagosHoyRow>(
      `
      SELECT COALESCE(SUM(pg.monto_pagado), 0) AS total_hoy
      FROM pagos pg
      WHERE COALESCE(pg.fecha_registro_local, pg.fecha_pago) = ?
    `,
      [fechaHoyEfectiva],
    );

    const totalDia = Number(sumaRows[0]?.total_hoy ?? 0);

    setPrestamosActivos(ordenadosAlfabetico);
    setTotalPagadoHoy(Number.isNaN(totalDia) ? 0 : totalDia);
    setPrestamoSeleccionado((prev) => {
      if (!prev) return null;
      return ordenadosAlfabetico.find((r) => r.id === prev.id) ?? null;
    });
  }, [fechaHoyEfectiva]);

  useFocusEffect(
    useCallback(() => {
      setFechaLocalHoy(obtenerFechaLocalHoy());
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

  const handleMontoChange = (texto: string) => {
    setMontoPagado(formatearInputEnteroMiles(texto));
  };

  const abrirModalPago = (prestamo: PrestamoActivo) => {
    setMensaje(null);
    setMensajeModal(null);
    setPrestamoSeleccionado(prestamo);
    setMonedaPago(normalizarMoneda(prestamo.moneda));
    setMontoPagado("");
    setFechaTarjetaOpcional("");
    setModalPagoVisible(true);
  };

  const cerrarModalPago = () => {
    setModalPagoVisible(false);
    setMensajeModal(null);
  };

  const cerrarModalTasa = () => {
    if (guardandoTasa) return;
    setPagoPendienteTasa(null);
    setErrorTasa("");
  };

  // Cálculo en vivo dentro del modal de tasa diaria
  const calculoConversionTasa = useMemo(() => {
    if (!pagoPendienteTasa) {
      return {
        tasa: 0,
        montoEnMonedaPrestamo: 0,
        nuevoSaldo: 0,
      };
    }
    const tasa = parseDecimalFlexible(tasaDiariaInput);
    const {
      montoPagoIngresado,
      monedaPago: mPago,
      monedaPrestamo: mPrest,
      prestamo,
    } = pagoPendienteTasa;

    let equivalente = 0;
    if (tasa > 0) {
      if (mPago === "COP" && mPrest === "USD") {
        // Pago en pesos, préstamo en dólares: COP / tasa
        equivalente = montoPagoIngresado / tasa;
      } else if (mPago === "USD" && mPrest === "COP") {
        // Pago en dólares, préstamo en pesos: USD * tasa
        equivalente = montoPagoIngresado * tasa;
      }
    }

    const saldoActual = Number(prestamo.saldo_pendiente || 0);
    const nuevoSaldo = Math.max(0, saldoActual - equivalente);

    return {
      tasa,
      montoEnMonedaPrestamo: equivalente,
      nuevoSaldo,
    };
  }, [pagoPendienteTasa, tasaDiariaInput]);

  const ejecutarPersistenciaPago = async (
    prestamo: PrestamoActivo,
    montoIngresado: number,
    montoDescontadoEnMonedaPrestamo: number,
    monedaP: Moneda,
    monedaPres: Moneda,
    fechaPagoGuardada: string,
    tasaUsada: number | null,
  ) => {
    const saldoActual = Number(prestamo.saldo_pendiente || 0);
    const nuevoSaldoRaw = Math.max(
      0,
      saldoActual - montoDescontadoEnMonedaPrestamo,
    );
    const nuevoSaldo =
      monedaPres === "USD"
        ? Math.round(nuevoSaldoRaw * 100) / 100
        : Math.round(nuevoSaldoRaw);
    const nuevoEstado = nuevoSaldo <= 0 ? "pagado" : "activo";

    const montoAbonoRedondeado =
      monedaPres === "USD"
        ? Math.round(montoDescontadoEnMonedaPrestamo * 100) / 100
        : Math.round(montoDescontadoEnMonedaPrestamo);

    await runQuery(
      `INSERT INTO pagos (prestamo_id, cliente_id, monto_pagado, fecha_pago, fecha_registro_local)
       VALUES (?, ?, ?, ?, ?)`,
      [
        prestamo.id,
        prestamo.cliente_id,
        montoAbonoRedondeado,
        fechaPagoGuardada,
        fechaHoyEfectiva,
      ],
    );

    await runQuery(
      `UPDATE prestamos
       SET saldo_pendiente = ?, estado = ?
       WHERE id = ?`,
      [nuevoSaldo, nuevoEstado, prestamo.id],
    );

    const nombreCliente = prestamo.cliente_nombre;
    setMontoPagado("");
    setFechaTarjetaOpcional("");
    setPrestamoSeleccionado(null);
    setMensajeModal(null);
    setModalPagoVisible(false);
    setPagoPendienteTasa(null);
    setErrorTasa("");
    await cargarPrestamos();

    const detalleConversion =
      tasaUsada && monedaP !== monedaPres
        ? ` (pagado ${formatearMontoPorMoneda(montoIngresado, monedaP)} a tasa ${tasaDiariaInput} = descontado ${formatearMontoPorMoneda(montoAbonoRedondeado, monedaPres)})`
        : "";

    setMensaje({
      tipo: "exito",
      texto: `Registro correcto: pago de ${formatearMontoPorMoneda(montoAbonoRedondeado, monedaPres)}${detalleConversion} guardado para ${nombreCliente} (fecha cuota: ${fechaPagoGuardada}).`,
    });
  };

  const guardarPago = async () => {
    setMensajeModal(null);
    setMensaje(null);

    if (!prestamoSeleccionado) {
      setMensajeModal({
        tipo: "error",
        texto: "Selecciona un préstamo activo.",
      });
      return;
    }

    const montoNum = parseInputEnteroMiles(montoPagado);
    if (Number.isNaN(montoNum) || montoNum <= 0) {
      setMensajeModal({
        tipo: "error",
        texto: "Ingresa un monto pagado mayor a 0.",
      });
      return;
    }

    const fechaOpcionalLimpia = fechaTarjetaOpcional.trim();
    if (
      fechaOpcionalLimpia.length > 0 &&
      !/^\d{4}-\d{2}-\d{2}$/.test(fechaOpcionalLimpia)
    ) {
      setMensajeModal({
        tipo: "error",
        texto: "La fecha manual opcional debe tener formato YYYY-MM-DD.",
      });
      return;
    }

    const fechaPagoGuardada =
      fechaOpcionalLimpia.length > 0 ? fechaOpcionalLimpia : fechaHoyEfectiva;

    const monedaPrestamo = normalizarMoneda(prestamoSeleccionado.moneda);

    // Si la moneda del pago es diferente a la moneda del préstamo, abrir modal de tasa diaria
    if (monedaPago !== monedaPrestamo) {
      setErrorTasa("");
      setPagoPendienteTasa({
        prestamo: prestamoSeleccionado,
        montoPagoIngresado: montoNum,
        monedaPago,
        monedaPrestamo,
        fechaPagoGuardada,
      });
      return;
    }

    try {
      await ejecutarPersistenciaPago(
        prestamoSeleccionado,
        montoNum,
        montoNum,
        monedaPago,
        monedaPrestamo,
        fechaPagoGuardada,
        null,
      );
    } catch (e: any) {
      setMensajeModal({
        tipo: "error",
        texto: `Error al guardar pago: ${e?.message || "error"}`,
      });
    }
  };

  const confirmarPagoConTasa = async () => {
    if (!pagoPendienteTasa) return;
    setErrorTasa("");

    if (calculoConversionTasa.tasa <= 0) {
      setErrorTasa("Ingresa una tasa diaria mayor a 0.");
      return;
    }

    setGuardandoTasa(true);
    try {
      await ejecutarPersistenciaPago(
        pagoPendienteTasa.prestamo,
        pagoPendienteTasa.montoPagoIngresado,
        calculoConversionTasa.montoEnMonedaPrestamo,
        pagoPendienteTasa.monedaPago,
        pagoPendienteTasa.monedaPrestamo,
        pagoPendienteTasa.fechaPagoGuardada,
        calculoConversionTasa.tasa,
      );
    } catch (e: any) {
      setErrorTasa(`Error al guardar pago: ${e?.message || "error"}`);
    } finally {
      setGuardandoTasa(false);
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
        Préstamos activos ({prestamosFiltrados.length}) • Total pagado hoy (
        {fechaHoyEfectiva}): {formatearMilesEntero(totalPagadoHoy)}
      </Text>

      <View style={styles.listaPrestamos}>
        {prestamosFiltrados.map((item) => {
          const pagadoHoy = item.pagado_hoy === 1;
          const monedaItem = normalizarMoneda(item.moneda);

          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.itemCard, pagadoHoy && styles.itemCardPagadoHoy]}
              onPress={() => abrirModalPago(item)}
            >
              <View style={styles.itemRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={styles.itemHeader}>
                    <Text
                      style={[
                        styles.itemTitle,
                        pagadoHoy && styles.textoPagadoHoy,
                      ]}
                    >
                      {item.cliente_nombre} (#{item.id}) • {monedaItem}
                    </Text>
                    {pagadoHoy ? (
                      <View style={styles.badgePagado}>
                        <Text style={styles.badgeTexto}>Pagado hoy</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.itemSub}>
                    Saldo:{" "}
                    {formatearMontoPorMoneda(item.saldo_pendiente, monedaItem)}{" "}
                    | Cuota ({item.frecuencia}):{" "}
                    {formatearMontoPorMoneda(item.valor_cuota, monedaItem)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.btnPagarItem}
                  onPress={() => abrirModalPago(item)}
                >
                  <Text style={styles.btnPagarItemTexto}>Pagar</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
        {prestamosFiltrados.length === 0 && (
          <Text style={styles.vacio}>
            {busqueda.trim()
              ? "No se encontraron préstamos activos para ese nombre."
              : "No hay préstamos activos con saldo pendiente."}
          </Text>
        )}
      </View>

      {/* Modal principal de registro de pago */}
      <Modal
        visible={modalPagoVisible}
        transparent
        animationType="fade"
        onRequestClose={cerrarModalPago}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>
              Registrar Pago — {prestamoSeleccionado?.cliente_nombre} (#
              {prestamoSeleccionado?.id})
            </Text>

            {prestamoSeleccionado ? (
              <View style={styles.resumenPrestamo}>
                <Text style={styles.resumenTexto}>
                  Moneda del préstamo:{" "}
                  {normalizarMoneda(prestamoSeleccionado.moneda)}
                </Text>
                <Text style={styles.resumenTexto}>
                  Saldo pendiente:{" "}
                  {formatearMontoPorMoneda(
                    prestamoSeleccionado.saldo_pendiente,
                    normalizarMoneda(prestamoSeleccionado.moneda),
                  )}
                </Text>
                <Text style={styles.resumenTexto}>
                  Cuota ({prestamoSeleccionado.frecuencia}):{" "}
                  {formatearMontoPorMoneda(
                    prestamoSeleccionado.valor_cuota,
                    normalizarMoneda(prestamoSeleccionado.moneda),
                  )}
                </Text>
                <Text style={styles.resumenTexto}>
                  Fecha local del día: {fechaHoyEfectiva}
                </Text>
              </View>
            ) : null}

            <Text style={styles.modalLabel}>Moneda del pago:</Text>
            <View style={styles.monedaRow}>
              {(
                [
                  { key: "COP", label: "Pesos (COP)" },
                  { key: "USD", label: "Dólares (USD)" },
                ] as const
              ).map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[
                    styles.monedaChip,
                    monedaPago === m.key && styles.monedaChipActivo,
                  ]}
                  onPress={() => setMonedaPago(m.key)}
                >
                  <Text
                    style={[
                      styles.monedaChipTexto,
                      monedaPago === m.key && styles.monedaChipTextoActivo,
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.modalLabel}>
              Monto pagado ({monedaPago === "USD" ? "US$" : "$"}):
            </Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={montoPagado}
              onChangeText={handleMontoChange}
              placeholder="Ej: 15.000"
            />

            <Text style={styles.modalLabel}>
              Fecha manual opcional de tarjeta (YYYY-MM-DD):
            </Text>
            <TextInput
              style={styles.input}
              value={fechaTarjetaOpcional}
              onChangeText={setFechaTarjetaOpcional}
              placeholder={`Opcional (por defecto ${fechaHoyEfectiva})`}
              maxLength={10}
            />

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
                onPress={cerrarModalPago}
              >
                <Text style={styles.btnCancelarTexto}>Cerrar</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.btnGuardar} onPress={guardarPago}>
                <Text style={styles.btnGuardarTexto}>Guardar Pago</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de tasa diaria cuando la moneda del pago difiere de la del préstamo */}
      <Modal
        visible={pagoPendienteTasa !== null}
        transparent
        animationType="fade"
        onRequestClose={cerrarModalTasa}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>Tasa Diaria de Conversión</Text>

            {pagoPendienteTasa ? (
              <View style={styles.resumenPrestamo}>
                <Text style={styles.resumenTexto}>
                  Préstamo #{pagoPendienteTasa.prestamo.id} (
                  {pagoPendienteTasa.prestamo.cliente_nombre}) en{" "}
                  {pagoPendienteTasa.monedaPrestamo}
                </Text>
                <Text style={styles.resumenTexto}>
                  Monto ingresado en {pagoPendienteTasa.monedaPago}:{" "}
                  {formatearMontoPorMoneda(
                    pagoPendienteTasa.montoPagoIngresado,
                    pagoPendienteTasa.monedaPago,
                  )}
                </Text>
                <Text style={styles.resumenTexto}>
                  Saldo actual en {pagoPendienteTasa.monedaPrestamo}:{" "}
                  {formatearMontoPorMoneda(
                    pagoPendienteTasa.prestamo.saldo_pendiente,
                    pagoPendienteTasa.monedaPrestamo,
                  )}
                </Text>
              </View>
            ) : null}

            <Text style={styles.modalLabel}>Tasa diaria (COP por 1 USD):</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={tasaDiariaInput}
              onChangeText={(t) =>
                setTasaDiariaInput(t.replace(/[^0-9.,]/g, ""))
              }
              placeholder="Ej: 3100"
            />

            {pagoPendienteTasa ? (
              <View style={styles.calculoConversionBox}>
                <Text style={styles.calculoConversionTexto}>
                  Se descontará del préstamo ({pagoPendienteTasa.monedaPrestamo}
                  ):{" "}
                  {formatearMontoPorMoneda(
                    calculoConversionTasa.montoEnMonedaPrestamo,
                    pagoPendienteTasa.monedaPrestamo,
                  )}
                </Text>
                <Text style={styles.calculoConversionTexto}>
                  Nuevo saldo restante:{" "}
                  {formatearMontoPorMoneda(
                    calculoConversionTasa.nuevoSaldo,
                    pagoPendienteTasa.monedaPrestamo,
                  )}
                </Text>
              </View>
            ) : null}

            {errorTasa ? (
              <View style={[styles.bannerMensaje, styles.bannerError]}>
                <Text style={[styles.bannerTexto, styles.textoError]}>
                  {errorTasa}
                </Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.btnCancelar}
                onPress={cerrarModalTasa}
              >
                <Text style={styles.btnCancelarTexto}>Volver</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnGuardar}
                onPress={confirmarPagoConTasa}
                disabled={guardandoTasa}
              >
                <Text style={styles.btnGuardarTexto}>
                  {guardandoTasa ? "Aplicando..." : "Aplicar y Guardar"}
                </Text>
              </TouchableOpacity>
            </View>
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
  itemCardPagadoHoy: {
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
  textoPagadoHoy: { color: "#14532D" },
  itemSub: { fontSize: 12, color: "#64748B", marginTop: 3 },
  badgePagado: {
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
  btnPagarItem: {
    backgroundColor: "#16A34A",
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  btnPagarItemTexto: {
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
    maxWidth: 440,
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
  monedaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  monedaChip: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  monedaChipActivo: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  monedaChipTexto: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  monedaChipTextoActivo: {
    color: "#fff",
  },
  calculoConversionBox: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    gap: 3,
  },
  calculoConversionTexto: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1E3A8A",
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
