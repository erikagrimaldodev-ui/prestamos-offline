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
type TipoModalCaja =
  | "efectivo_recibido"
  | "efectivo_entregado"
  | "gasto"
  | null;

interface PrestamoCajaRow {
  id: number;
  cliente_id: number;
  monto_prestado: number;
  fecha_creacion: string;
  estado: string;
  moneda?: string | null;
}

interface PagoCajaRow {
  id: number;
  monto_pagado: number;
  fecha_pago: string;
  fecha_registro_local?: string | null;
  moneda?: string | null;
}

interface MovimientoCajaRow {
  id: number;
  tipo: string;
  descripcion: string;
  monto: number;
  fecha: string;
  moneda?: string | null;
}

const normalizarMoneda = (moneda?: string | null): Moneda => {
  return (moneda || "").trim().toUpperCase() === "USD" ? "USD" : "COP";
};

const normalizarFecha = (fecha?: string | null): string => {
  const limpia = (fecha || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(limpia)) {
    return limpia.slice(0, 10);
  }
  const matchLatam = limpia.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (matchLatam) {
    return `${matchLatam[3]}-${matchLatam[2]}-${matchLatam[1]}`;
  }
  return limpia.slice(0, 10);
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

const formatearMontoMoneda = (
  valor: number | null | undefined,
  moneda: Moneda,
): string => {
  const num = Number(valor ?? 0);
  const seguro = Number.isNaN(num) ? 0 : num;
  const signo = seguro < 0 ? "-" : "";
  const absVal = Math.abs(seguro);
  if (moneda === "USD") {
    return `${signo}US$ ${formatearDecimalUsd(absVal)}`;
  }
  return `${signo}$ ${formatearMilesEntero(absVal)}`;
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

const inferirMonedaMovimiento = (mov: MovimientoCajaRow): Moneda => {
  if (mov.moneda && mov.moneda.trim().toUpperCase() === "USD") {
    return "USD";
  }
  if ((mov.descripcion || "").toUpperCase().includes("(USD)")) {
    return "USD";
  }
  return "COP";
};

export default function CajaBancosScreen() {
  const hoyInicial = obtenerFechaLocalHoy();

  const [fechaFiltro] = useState(hoyInicial);
  const [prestamos, setPrestamos] = useState<PrestamoCajaRow[]>([]);
  const [pagos, setPagos] = useState<PagoCajaRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoCajaRow[]>([]);
  const [aviso, setAviso] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);

  const [tipoModal, setTipoModal] = useState<TipoModalCaja>(null);
  const [monedaModal, setMonedaModal] = useState<Moneda>("COP");
  const [montoModal, setMontoModal] = useState("");
  const [descripcionModal, setDescripcionModal] = useState("");
  const [fechaModal, setFechaModal] = useState(hoyInicial);
  const [errorModal, setErrorModal] = useState("");

  const fechaEfectiva = useMemo(() => {
    const limpia = fechaFiltro.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(limpia) ? limpia : obtenerFechaLocalHoy();
  }, [fechaFiltro]);

  const cargarDatosCaja = useCallback(async () => {
    const [listaPrestamos, listaPagos, listaMovimientos] = await Promise.all([
      getAllRows<PrestamoCajaRow>(`
        SELECT id, cliente_id, monto_prestado, fecha_creacion, estado, moneda
        FROM prestamos
      `),
      getAllRows<PagoCajaRow>(`
        SELECT pg.id, pg.monto_pagado, pg.fecha_pago, pg.fecha_registro_local, p.moneda
        FROM pagos pg
        LEFT JOIN prestamos p ON pg.prestamo_id = p.id
      `),
      getAllRows<MovimientoCajaRow>(`
        SELECT *
        FROM movimientos_caja
        WHERE LOWER(TRIM(COALESCE(tipo, ''))) != 'renovacion'
        ORDER BY id DESC
      `),
    ]);

    setPrestamos(listaPrestamos);
    setPagos(listaPagos);
    setMovimientos(listaMovimientos);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargarDatosCaja().catch(() => {
        setAviso({
          tipo: "error",
          texto: "No se pudieron cargar los datos de caja y bancos.",
        });
      });
    }, [cargarDatosCaja]),
  );

  const resumenPorMoneda = useMemo(() => {
    const inicial = {
      efectivoRecibido: 0,
      sumaPrestamos: 0,
      dineroCobrado: 0,
      efectivoEntregado: 0,
      gastos: 0,
      aEntregarAlJefe: 0,
    };

    const porMoneda: Record<Moneda, typeof inicial> = {
      COP: { ...inicial },
      USD: { ...inicial },
    };

    for (const mov of movimientos) {
      if (normalizarFecha(mov.fecha) !== fechaEfectiva) continue;
      const m = inferirMonedaMovimiento(mov);
      const monto = Number(mov.monto || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;

      if (mov.tipo === "efectivo_recibido") {
        porMoneda[m].efectivoRecibido += monto;
      } else if (mov.tipo === "efectivo_entregado") {
        porMoneda[m].efectivoEntregado += monto;
      } else if (mov.tipo === "gasto") {
        porMoneda[m].gastos += monto;
      }
    }

    for (const p of prestamos) {
      if (normalizarFecha(p.fecha_creacion) !== fechaEfectiva) continue;
      const estadoLower = (p.estado || "").trim().toLowerCase();
      if (estadoLower === "renovado") continue;

      const m = normalizarMoneda(p.moneda);
      const monto = Number(p.monto_prestado || 0);
      if (!Number.isNaN(monto) && monto > 0) {
        porMoneda[m].sumaPrestamos += monto;
      }
    }

    for (const pg of pagos) {
      const fechaRef = normalizarFecha(
        pg.fecha_registro_local || pg.fecha_pago,
      );
      if (fechaRef !== fechaEfectiva) continue;
      const m = normalizarMoneda(pg.moneda);
      const monto = Number(pg.monto_pagado || 0);
      if (!Number.isNaN(monto) && monto > 0) {
        porMoneda[m].dineroCobrado += monto;
      }
    }

    for (const m of ["COP", "USD"] as const) {
      const d = porMoneda[m];
      d.aEntregarAlJefe =
        d.efectivoRecibido +
        d.dineroCobrado -
        (d.sumaPrestamos + d.gastos + d.efectivoEntregado);
    }

    return porMoneda;
  }, [movimientos, prestamos, pagos, fechaEfectiva]);

  const movimientosDelDia = useMemo(() => {
    return movimientos.filter(
      (m) => normalizarFecha(m.fecha) === fechaEfectiva,
    );
  }, [movimientos, fechaEfectiva]);

  const abrirModal = (tipo: Exclude<TipoModalCaja, null>) => {
    setAviso(null);
    setErrorModal("");
    setTipoModal(tipo);
    setMonedaModal("COP");
    setMontoModal("");
    setFechaModal(fechaEfectiva);
    if (tipo === "efectivo_recibido") {
      setDescripcionModal("Efectivo recibido del jefe");
    } else if (tipo === "efectivo_entregado") {
      setDescripcionModal("Dinero entregado al jefe");
    } else {
      setDescripcionModal("Gasto diario");
    }
  };

  const cerrarModal = () => {
    setTipoModal(null);
    setErrorModal("");
  };

  const handleMonedaModalChange = (nuevaMoneda: Moneda) => {
    const actualNum = parseMontoPorMoneda(montoModal, monedaModal);
    setMonedaModal(nuevaMoneda);
    setMontoModal(
      actualNum > 0
        ? formatearInputPorMoneda(String(actualNum), nuevaMoneda)
        : "",
    );
  };

  const guardarMovimientoModal = async () => {
    if (!tipoModal) return;
    setErrorModal("");

    const montoNum = parseMontoPorMoneda(montoModal, monedaModal);
    if (Number.isNaN(montoNum) || montoNum <= 0) {
      setErrorModal("Ingresa un monto válido mayor a 0.");
      return;
    }

    const fechaLimpia = fechaModal.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaLimpia)) {
      setErrorModal("Ingresa una fecha válida en formato YYYY-MM-DD.");
      return;
    }

    const descLimpia =
      descripcionModal.trim() ||
      (tipoModal === "efectivo_recibido"
        ? "Efectivo recibido del jefe"
        : tipoModal === "efectivo_entregado"
          ? "Dinero entregado al jefe"
          : "Gasto diario");

    const descripcionConMoneda = descLimpia
      .toUpperCase()
      .includes(`(${monedaModal})`)
      ? descLimpia
      : `${descLimpia} (${monedaModal})`;

    try {
      try {
        await runQuery(
          `INSERT INTO movimientos_caja (tipo, descripcion, monto, fecha, moneda)
           VALUES (?, ?, ?, ?, ?)`,
          [tipoModal, descripcionConMoneda, montoNum, fechaLimpia, monedaModal],
        );
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (!msg.toLowerCase().includes("moneda")) {
          throw err;
        }
        await runQuery(
          `INSERT INTO movimientos_caja (tipo, descripcion, monto, fecha)
           VALUES (?, ?, ?, ?)`,
          [tipoModal, descripcionConMoneda, montoNum, fechaLimpia],
        );
      }

      cerrarModal();
      await cargarDatosCaja();
      setAviso({
        tipo: "exito",
        texto: `Registrado (${monedaModal}) en fecha ${fechaLimpia}: ${formatearMontoMoneda(montoNum, monedaModal)}.`,
      });
    } catch (e: any) {
      setErrorModal(`Error al guardar: ${e?.message || "error"}`);
    }
  };

  const eliminarMovimiento = async (id: number) => {
    try {
      await runQuery("DELETE FROM movimientos_caja WHERE id = ?", [id]);
      await cargarDatosCaja();
    } catch (e: any) {
      setAviso({
        tipo: "error",
        texto: `Error al eliminar: ${e?.message || "error"}`,
      });
    }
  };

  const tituloModal =
    tipoModal === "efectivo_recibido"
      ? "Efectivo Recibido del Jefe"
      : tipoModal === "efectivo_entregado"
        ? "Entregar Efectivo al Jefe"
        : "Registrar Gasto";

  return (
    <ScrollView style={styles.container}>
      {aviso ? (
        <View
          style={[
            styles.banner,
            aviso.tipo === "exito" ? styles.bannerExito : styles.bannerError,
          ]}
        >
          <Text
            style={[
              styles.bannerTexto,
              aviso.tipo === "exito" ? styles.textoExito : styles.textoError,
            ]}
          >
            {aviso.texto}
          </Text>
        </View>
      ) : null}

      <View style={styles.gridDos}>
        <View style={styles.cardEntregar}>
          <Text style={styles.entregarLabel}>A Entregar al Jefe (COP)</Text>
          <Text style={styles.entregarValor}>
            {formatearMontoMoneda(resumenPorMoneda.COP.aEntregarAlJefe, "COP")}
          </Text>
          <Text style={styles.entregarSub}>Fecha: {fechaEfectiva}</Text>
        </View>
        <View style={styles.cardEntregar}>
          <Text style={styles.entregarLabel}>A Entregar al Jefe (USD)</Text>
          <Text style={styles.entregarValor}>
            {formatearMontoMoneda(resumenPorMoneda.USD.aEntregarAlJefe, "USD")}
          </Text>
          <Text style={styles.entregarSub}>Fecha: {fechaEfectiva}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.tarjeta, styles.tarjetaEfectivo]}
        onPress={() => abrirModal("efectivo_recibido")}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Efectivo Recibido (del Jefe)</Text>
          <Text style={styles.tarjetaAccion}>+ Registrar (toca aquí)</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP:{" "}
          {formatearMontoMoneda(resumenPorMoneda.COP.efectivoRecibido, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD:{" "}
          {formatearMontoMoneda(resumenPorMoneda.USD.efectivoRecibido, "USD")}
        </Text>
      </TouchableOpacity>

      <View style={styles.tarjeta}>
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Suma de Préstamos</Text>
          <Text style={styles.tarjetaBadgeNegativo}>Sale de caja</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenPorMoneda.COP.sumaPrestamos, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenPorMoneda.USD.sumaPrestamos, "USD")}
        </Text>
      </View>

      <View style={styles.tarjeta}>
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Dinero Cobrado a Clientes</Text>
          <Text style={styles.tarjetaBadgePositivo}>Entra a caja</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenPorMoneda.COP.dineroCobrado, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenPorMoneda.USD.dineroCobrado, "USD")}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.tarjeta}
        onPress={() => abrirModal("efectivo_entregado")}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>
            Dinero Entregado en Efectivo (al Jefe)
          </Text>
          <Text style={styles.tarjetaAccionNegativa}>- Registrar entrega</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP:{" "}
          {formatearMontoMoneda(resumenPorMoneda.COP.efectivoEntregado, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD:{" "}
          {formatearMontoMoneda(resumenPorMoneda.USD.efectivoEntregado, "USD")}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tarjeta}
        onPress={() => abrirModal("gasto")}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Gastos Registrados</Text>
          <Text style={styles.tarjetaAccionNegativa}>+ Registrar gasto</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenPorMoneda.COP.gastos, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenPorMoneda.USD.gastos, "USD")}
        </Text>
      </TouchableOpacity>

      <Text style={styles.seccionTitulo}>
        Movimientos manuales ({fechaEfectiva})
      </Text>
      <View style={styles.listaMovimientos}>
        {movimientosDelDia.map((mov) => {
          const m = inferirMonedaMovimiento(mov);
          const esEntrada = mov.tipo === "efectivo_recibido";
          return (
            <View key={mov.id} style={styles.movItem}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.movFecha}>{mov.fecha}</Text>
                <Text style={styles.movDesc}>{mov.descripcion}</Text>
              </View>
              <Text
                style={[
                  styles.movMonto,
                  esEntrada ? styles.textoPositivo : styles.textoNegativo,
                ]}
              >
                {esEntrada ? "+" : "-"}
                {formatearMontoMoneda(mov.monto, m)}
              </Text>
              <TouchableOpacity
                onPress={() => void eliminarMovimiento(mov.id)}
                style={{ marginLeft: 10 }}
              >
                <Text style={styles.btnEliminar}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          );
        })}
        {movimientosDelDia.length === 0 ? (
          <Text style={styles.vacio}>
            No hay movimientos manuales registrados en esta fecha.
          </Text>
        ) : null}
      </View>

      <Modal
        visible={tipoModal !== null}
        transparent
        animationType="fade"
        onRequestClose={cerrarModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>{tituloModal}</Text>

            <Text style={styles.modalLabel}>Moneda:</Text>
            <View style={styles.monedaRow}>
              {(["COP", "USD"] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.monedaChip,
                    monedaModal === m && styles.monedaChipActivo,
                  ]}
                  onPress={() => handleMonedaModalChange(m)}
                >
                  <Text
                    style={[
                      styles.monedaChipTexto,
                      monedaModal === m && styles.textoBlanco,
                    ]}
                  >
                    {m === "COP" ? "Pesos (COP)" : "Dólares (USD)"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.modalLabel}>
              Monto ({monedaModal === "USD" ? "US$" : "$"}):
            </Text>
            <TextInput
              style={styles.input}
              keyboardType={
                monedaModal === "USD" ? "decimal-pad" : "number-pad"
              }
              value={montoModal}
              onChangeText={(t) =>
                setMontoModal(formatearInputPorMoneda(t, monedaModal))
              }
              placeholder={monedaModal === "USD" ? "Ej: 100" : "Ej: 500.000"}
            />

            <Text style={styles.modalLabel}>Fecha manual (YYYY-MM-DD):</Text>
            <TextInput
              style={styles.input}
              value={fechaModal}
              onChangeText={setFechaModal}
              placeholder="YYYY-MM-DD"
              maxLength={10}
            />

            <Text style={styles.modalLabel}>Descripción:</Text>
            <TextInput
              style={styles.input}
              value={descripcionModal}
              onChangeText={setDescripcionModal}
              placeholder="Detalle del movimiento..."
            />

            {errorModal ? (
              <View style={[styles.banner, styles.bannerError]}>
                <Text style={[styles.bannerTexto, styles.textoError]}>
                  {errorModal}
                </Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.btnCancelar}
                onPress={cerrarModal}
              >
                <Text style={styles.btnCancelarTexto}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnGuardar}
                onPress={() => void guardarMovimientoModal()}
              >
                <Text style={styles.btnGuardarTexto}>Guardar</Text>
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
  gridDos: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  cardEntregar: {
    flex: 1,
    backgroundColor: "#0F172A",
    padding: 14,
    borderRadius: 10,
  },
  entregarLabel: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "600",
  },
  entregarValor: {
    fontSize: 18,
    color: "#fff",
    fontWeight: "bold",
    marginTop: 4,
  },
  entregarSub: {
    fontSize: 11,
    color: "#CBD5E1",
    marginTop: 4,
  },
  tarjeta: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 10,
  },
  tarjetaEfectivo: {
    borderColor: "#16A34A",
    backgroundColor: "#F0FDF4",
  },
  tarjetaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  tarjetaTitulo: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  tarjetaAccion: {
    fontSize: 12,
    fontWeight: "700",
    color: "#16A34A",
  },
  tarjetaAccionNegativa: {
    fontSize: 12,
    fontWeight: "700",
    color: "#DC2626",
  },
  tarjetaBadgePositivo: {
    fontSize: 11,
    fontWeight: "700",
    color: "#15803D",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tarjetaBadgeNegativo: {
    fontSize: 11,
    fontWeight: "700",
    color: "#B91C1C",
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  montoLinea: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1E293B",
    marginTop: 2,
  },
  seccionTitulo: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
    marginTop: 8,
    marginBottom: 8,
  },
  listaMovimientos: { gap: 8, paddingBottom: 28 },
  movItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  movFecha: { fontSize: 12, fontWeight: "700", color: "#64748B" },
  movDesc: { fontSize: 14, fontWeight: "600", color: "#0F172A", marginTop: 2 },
  movMonto: { fontSize: 14, fontWeight: "700" },
  textoPositivo: { color: "#16A34A" },
  textoNegativo: { color: "#DC2626" },
  btnEliminar: { fontSize: 12, fontWeight: "700", color: "#DC2626" },
  vacio: { color: "#64748B", fontStyle: "italic" },
  banner: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 10,
  },
  bannerExito: { backgroundColor: "#DCFCE7", borderColor: "#16A34A" },
  bannerError: { backgroundColor: "#FEF2F2", borderColor: "#DC2626" },
  bannerTexto: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  textoExito: { color: "#14532D" },
  textoError: { color: "#DC2626" },
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
    padding: 10,
    marginTop: 5,
    fontSize: 15,
  },
  monedaRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  monedaChip: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
  },
  monedaChipActivo: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  monedaChipTexto: { fontSize: 12, fontWeight: "700", color: "#334155" },
  textoBlanco: { color: "#fff" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  btnCancelar: {
    flex: 1,
    backgroundColor: "#E2E8F0",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnCancelarTexto: { color: "#334155", fontWeight: "700" },
  btnGuardar: {
    flex: 1,
    backgroundColor: "#16A34A",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnGuardarTexto: { color: "#fff", fontWeight: "700" },
});
