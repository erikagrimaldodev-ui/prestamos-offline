import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { getAllRows, runQuery } from "../../database/db";

type Moneda = "COP" | "USD";
type TipoModalCaja =
  | "efectivo_recibido"
  | "efectivo_entregado"
  | "gasto"
  | null;
type FiltroMov = "todos" | "entradas" | "salidas";

interface PrestamoCajaRow {
  id: number;
  cliente_id: number;
  monto_prestado: number;
  interes_porcentaje?: number | null;
  monto_total?: number | null;
  saldo_pendiente?: number | null;
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

interface ItemMovimientoLista {
  id: string;
  esResumenCierre: boolean;
  tipo: string;
  descripcion: string;
  subtitulo: string;
  fechaOrden: string;
  monto: number;
  moneda: Moneda;
  esEntrada: boolean;
  movimientoOriginal?: MovimientoCajaRow;
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

const obtenerMontoTotalPrestamo = (p: PrestamoCajaRow): number => {
  const totalGuardado = Number(p.monto_total ?? 0);
  if (!Number.isNaN(totalGuardado) && totalGuardado > 0) {
    return totalGuardado;
  }
  const prestado = Number(p.monto_prestado || 0);
  const pct = Number(p.interes_porcentaje || 0);
  if (Number.isNaN(prestado) || prestado <= 0) return 0;
  const interes = prestado * (pct / 100);
  return prestado + interes;
};

export default function CajaBancosScreen() {
  const hoyInicial = obtenerFechaLocalHoy();

  const [fechaHoy, setFechaHoy] = useState(hoyInicial);
  const [filtroMov, setFiltroMov] = useState<FiltroMov>("todos");
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

  const cargarDatosCaja = useCallback(async () => {
    let listaPrestamos: PrestamoCajaRow[] = [];
    try {
      listaPrestamos = await getAllRows<PrestamoCajaRow>(`
        SELECT id, cliente_id, monto_prestado, interes_porcentaje, monto_total, saldo_pendiente, fecha_creacion, estado, moneda
        FROM prestamos
      `);
    } catch {
      listaPrestamos = await getAllRows<PrestamoCajaRow>(`
        SELECT id, cliente_id, monto_prestado, fecha_creacion, estado, moneda
        FROM prestamos
      `);
    }

    const [listaPagos, listaMovimientos] = await Promise.all([
      getAllRows<PagoCajaRow>(`
        SELECT pg.id, pg.monto_pagado, pg.fecha_pago, pg.fecha_registro_local, p.moneda
        FROM pagos pg
        LEFT JOIN prestamos p ON pg.prestamo_id = p.id
      `),
      getAllRows<MovimientoCajaRow>(`
        SELECT *
        FROM movimientos_caja
        WHERE LOWER(TRIM(COALESCE(tipo, ''))) != 'renovacion'
        ORDER BY fecha DESC, id DESC
      `),
    ]);

    setPrestamos(listaPrestamos);
    setPagos(listaPagos);
    setMovimientos(listaMovimientos);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const hoyActual = obtenerFechaLocalHoy();
      setFechaHoy(hoyActual);
      setFechaModal(hoyActual);
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
      sumaPrestamosDia: 0,
      dineroCobradoDia: 0,
      efectivoEntregado: 0,
      gastos: 0,
      egresosRenovacion: 0,
      restantePorEntregar: 0,
      dineroEnCalleTotal: 0,
      capitalEnCalleTotal: 0,
      montoCobradoHistorico: 0,
    };

    const porMoneda: Record<Moneda, typeof inicial> = {
      COP: { ...inicial },
      USD: { ...inicial },
    };

    // Tarjetas diarias: solo movimientos de la fecha actual (fechaHoy)
    for (const mov of movimientos) {
      if (normalizarFecha(mov.fecha) !== fechaHoy) continue;
      const m = inferirMonedaMovimiento(mov);
      const monto = Number(mov.monto || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;

      if (mov.tipo === "efectivo_recibido") {
        porMoneda[m].efectivoRecibido += monto;
      } else if (mov.tipo === "efectivo_entregado") {
        porMoneda[m].efectivoEntregado += monto;
      } else if (mov.tipo === "gasto") {
        porMoneda[m].gastos += monto;
      } else if (mov.tipo === "renovacion_egreso") {
        porMoneda[m].egresosRenovacion += monto;
      }
    }

    // Préstamos del día + Dinero en la calle (general / todos los vigentes)
    for (const p of prestamos) {
      const estadoLower = (p.estado || "").trim().toLowerCase();
      const m = normalizarMoneda(p.moneda);
      const montoPrestado = Number(p.monto_prestado || 0);

      if (
        normalizarFecha(p.fecha_creacion) === fechaHoy &&
        estadoLower !== "renovado" &&
        !Number.isNaN(montoPrestado) &&
        montoPrestado > 0
      ) {
        porMoneda[m].sumaPrestamosDia += montoPrestado;
      }

      const esVigenteEnCalle =
        estadoLower !== "renovado" &&
        estadoLower !== "cancelado" &&
        estadoLower !== "pagado" &&
        estadoLower !== "liquidado" &&
        Number(p.saldo_pendiente ?? 1) > 0;

      if (esVigenteEnCalle) {
        const totalConInteres = obtenerMontoTotalPrestamo(p);
        if (!Number.isNaN(totalConInteres) && totalConInteres > 0) {
          porMoneda[m].dineroEnCalleTotal += totalConInteres;
        }
        if (!Number.isNaN(montoPrestado) && montoPrestado > 0) {
          porMoneda[m].capitalEnCalleTotal += montoPrestado;
        }
      }
    }

    // Cobros del día + Monto cobrado total histórico (todos los cobros)
    for (const pg of pagos) {
      const m = normalizarMoneda(pg.moneda);
      const monto = Number(pg.monto_pagado || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;

      porMoneda[m].montoCobradoHistorico += monto;

      const fechaRef = normalizarFecha(
        pg.fecha_registro_local || pg.fecha_pago,
      );
      if (fechaRef === fechaHoy) {
        porMoneda[m].dineroCobradoDia += monto;
      }
    }

    for (const m of ["COP", "USD"] as const) {
      const d = porMoneda[m];
      d.restantePorEntregar =
        d.efectivoRecibido +
        d.dineroCobradoDia -
        (d.sumaPrestamosDia +
          d.gastos +
          d.egresosRenovacion +
          d.efectivoEntregado);
    }

    return porMoneda;
  }, [movimientos, prestamos, pagos, fechaHoy]);

  const itemsMovimientosLista = useMemo<ItemMovimientoLista[]>(() => {
    const lista: ItemMovimientoLista[] = [];

    // Agrupar totales de préstamos y cobros por fecha (todos los días y meses)
    const prestamosPorFechaMoneda = new Map<string, number>();
    const cobrosPorFechaMoneda = new Map<string, number>();

    for (const p of prestamos) {
      const estadoLower = (p.estado || "").trim().toLowerCase();
      if (estadoLower === "renovado") continue;
      const fechaP = normalizarFecha(p.fecha_creacion);
      if (!fechaP) continue;
      const m = normalizarMoneda(p.moneda);
      const monto = Number(p.monto_prestado || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;
      const clave = `${fechaP}__${m}`;
      prestamosPorFechaMoneda.set(
        clave,
        (prestamosPorFechaMoneda.get(clave) || 0) + monto,
      );
    }

    for (const pg of pagos) {
      const fechaPg = normalizarFecha(pg.fecha_registro_local || pg.fecha_pago);
      if (!fechaPg) continue;
      const m = normalizarMoneda(pg.moneda);
      const monto = Number(pg.monto_pagado || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;
      const clave = `${fechaPg}__${m}`;
      cobrosPorFechaMoneda.set(
        clave,
        (cobrosPorFechaMoneda.get(clave) || 0) + monto,
      );
    }

    for (const [clave, totalPrestado] of prestamosPorFechaMoneda.entries()) {
      const [fechaP, mStr] = clave.split("__");
      const m = normalizarMoneda(mStr);
      lista.push({
        id: `cierre-prestamos-${fechaP}-${m}`,
        esResumenCierre: true,
        tipo: "cierre_prestamos",
        descripcion: `Cierre del día — Total préstamos (${m})`,
        subtitulo: `${fechaP} • Sale de caja`,
        fechaOrden: fechaP,
        monto: totalPrestado,
        moneda: m,
        esEntrada: false,
      });
    }

    for (const [clave, totalCobrado] of cobrosPorFechaMoneda.entries()) {
      const [fechaPg, mStr] = clave.split("__");
      const m = normalizarMoneda(mStr);
      lista.push({
        id: `cierre-cobros-${fechaPg}-${m}`,
        esResumenCierre: true,
        tipo: "cierre_cobros",
        descripcion: `Cierre del día — Total cobros (${m})`,
        subtitulo: `${fechaPg} • Entra a caja`,
        fechaOrden: fechaPg,
        monto: totalCobrado,
        moneda: m,
        esEntrada: true,
      });
    }

    // Todos los movimientos registrados en movimientos_caja (todos los días y meses)
    for (const mov of movimientos) {
      const m = inferirMonedaMovimiento(mov);
      const esEntrada = mov.tipo === "efectivo_recibido";
      const fechaMov = normalizarFecha(mov.fecha);
      lista.push({
        id: `mov-${mov.id}`,
        esResumenCierre: false,
        tipo: mov.tipo,
        descripcion: mov.descripcion,
        subtitulo: fechaMov || mov.fecha,
        fechaOrden: fechaMov,
        monto: Number(mov.monto || 0),
        moneda: m,
        esEntrada,
        movimientoOriginal: mov,
      });
    }

    // Ordenar de más reciente a más antiguo por fecha
    lista.sort((a, b) => b.fechaOrden.localeCompare(a.fechaOrden));

    if (filtroMov === "entradas") {
      return lista.filter((item) => item.esEntrada);
    }
    if (filtroMov === "salidas") {
      return lista.filter((item) => !item.esEntrada);
    }
    return lista;
  }, [prestamos, pagos, movimientos, filtroMov]);

  const abrirModal = (tipo: Exclude<TipoModalCaja, null>) => {
    setAviso(null);
    setErrorModal("");
    setTipoModal(tipo);
    setMonedaModal("COP");
    setMontoModal("");
    setFechaModal(obtenerFechaLocalHoy());
    if (tipo === "efectivo_recibido") {
      setDescripcionModal("Efectivo recibido del jefe");
    } else if (tipo === "efectivo_entregado") {
      setDescripcionModal("Dinero entregado al jefe");
    } else {
      setDescripcionModal("Gasto");
    }
  };

  const cerrarModal = () => {
    setTipoModal(null);
    setErrorModal("");
  };

  const handleMonedaModalChange = (nuevaMoneda: Moneda) => {
    const actualNum = parseMontoPorMoneda(montoModal, monedaModal);
    setMonedaModal(nuevaMoneda);
    if (actualNum <= 0) {
      setMontoModal("");
      return;
    }
    const valorStr =
      nuevaMoneda === "COP" ? String(Math.round(actualNum)) : String(actualNum);
    setMontoModal(formatearInputPorMoneda(valorStr, nuevaMoneda));
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

    const descBase =
      descripcionModal.trim() ||
      (tipoModal === "efectivo_recibido"
        ? "Efectivo recibido del jefe"
        : tipoModal === "efectivo_entregado"
          ? "Dinero entregado al jefe"
          : "Gasto");

    const descFinal = descBase.toUpperCase().includes(`(${monedaModal})`)
      ? descBase
      : `${descBase} (${monedaModal})`;

    try {
      try {
        await runQuery(
          `INSERT INTO movimientos_caja (tipo, descripcion, monto, fecha, moneda)
           VALUES (?, ?, ?, ?, ?)`,
          [tipoModal, descFinal, montoNum, fechaLimpia, monedaModal],
        );
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (!msg.toLowerCase().includes("moneda")) {
          throw err;
        }
        await runQuery(
          `INSERT INTO movimientos_caja (tipo, descripcion, monto, fecha)
           VALUES (?, ?, ?, ?)`,
          [tipoModal, descFinal, montoNum, fechaLimpia],
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

  const renderHeaderLista = () => (
    <View style={styles.contentWrapper}>
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

      {/* Restante por entregar del día */}
      <View style={styles.gridDos}>
        <View style={styles.cardEntregar}>
          <Text style={styles.entregarLabel}>Restante por entregar (COP)</Text>
          <Text style={styles.entregarValor}>
            {formatearMontoMoneda(
              resumenPorMoneda.COP.restantePorEntregar,
              "COP",
            )}
          </Text>
          <Text style={styles.entregarSub}>Cobrado + Recibido: {fechaHoy}</Text>
        </View>

        <View style={styles.cardEntregar}>
          <Text style={styles.entregarLabel}>Restante por entregar (USD)</Text>
          <Text style={styles.entregarValor}>
            {formatearMontoMoneda(
              resumenPorMoneda.USD.restantePorEntregar,
              "USD",
            )}
          </Text>
          <Text style={styles.entregarSub}>Cobrado + Recibido: {fechaHoy}</Text>
        </View>
      </View>

      {/* Dinero en la calle (general) y Monto cobrado total (general) */}
      <View style={styles.gridDos}>
        <View style={[styles.tarjeta, styles.tarjetaCalle]}>
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Dinero en la Calle (Total)</Text>
            <Text style={styles.tarjetaBadgeCalle}>Capital + Interés</Text>
          </View>
          <Text style={styles.montoLinea}>
            COP:{" "}
            {formatearMontoMoneda(
              resumenPorMoneda.COP.dineroEnCalleTotal,
              "COP",
            )}
          </Text>
          <Text style={styles.subLineaCartera}>
            Capital:{" "}
            {formatearMontoMoneda(
              resumenPorMoneda.COP.capitalEnCalleTotal,
              "COP",
            )}
          </Text>
          <Text style={styles.montoLinea}>
            USD:{" "}
            {formatearMontoMoneda(
              resumenPorMoneda.USD.dineroEnCalleTotal,
              "USD",
            )}
          </Text>
          <Text style={styles.subLineaCartera}>
            Capital:{" "}
            {formatearMontoMoneda(
              resumenPorMoneda.USD.capitalEnCalleTotal,
              "USD",
            )}
          </Text>
        </View>

        <View style={[styles.tarjeta, styles.tarjetaCobradoTotal]}>
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Monto Cobrado Total</Text>
            <Text style={styles.tarjetaBadgePositivo}>Todos los cobros</Text>
          </View>
          <Text style={styles.montoLinea}>
            COP:{" "}
            {formatearMontoMoneda(
              resumenPorMoneda.COP.montoCobradoHistorico,
              "COP",
            )}
          </Text>
          <Text style={styles.montoLinea}>
            USD:{" "}
            {formatearMontoMoneda(
              resumenPorMoneda.USD.montoCobradoHistorico,
              "USD",
            )}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.tarjeta, styles.tarjetaEfectivo]}
        onPress={() => abrirModal("efectivo_recibido")}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Efectivo Recibido del Jefe</Text>
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
          <Text style={styles.tarjetaTitulo}>
            Dinero Cobrado a Clientes (Día)
          </Text>
          <Text style={styles.tarjetaBadgePositivo}>Entra a caja</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP:{" "}
          {formatearMontoMoneda(resumenPorMoneda.COP.dineroCobradoDia, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD:{" "}
          {formatearMontoMoneda(resumenPorMoneda.USD.dineroCobradoDia, "USD")}
        </Text>
      </View>

      <View style={styles.tarjeta}>
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Suma de Préstamos (Día)</Text>
          <Text style={styles.tarjetaBadgeNegativo}>Sale de caja</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP:{" "}
          {formatearMontoMoneda(resumenPorMoneda.COP.sumaPrestamosDia, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD:{" "}
          {formatearMontoMoneda(resumenPorMoneda.USD.sumaPrestamosDia, "USD")}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.tarjeta}
        onPress={() => abrirModal("gasto")}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Gastos / Renovaciones (Día)</Text>
          <Text style={styles.tarjetaAccionNegativa}>+ Registrar gasto</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP:{" "}
          {formatearMontoMoneda(
            resumenPorMoneda.COP.gastos +
              resumenPorMoneda.COP.egresosRenovacion,
            "COP",
          )}
        </Text>
        <Text style={styles.montoLinea}>
          USD:{" "}
          {formatearMontoMoneda(
            resumenPorMoneda.USD.gastos +
              resumenPorMoneda.USD.egresosRenovacion,
            "USD",
          )}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.tarjeta}
        onPress={() => abrirModal("efectivo_entregado")}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Dinero Entregado al Jefe</Text>
          <Text style={styles.tarjetaAccionNegativa}>
            + Entregar / Sale de caja
          </Text>
        </View>
        <Text style={styles.montoLinea}>
          COP:{" "}
          {formatearMontoMoneda(resumenPorMoneda.COP.efectivoEntregado, "COP")}{" "}
          - Restante:{" "}
          {formatearMontoMoneda(
            resumenPorMoneda.COP.restantePorEntregar,
            "COP",
          )}
        </Text>
        <Text style={styles.montoLinea}>
          USD:{" "}
          {formatearMontoMoneda(resumenPorMoneda.USD.efectivoEntregado, "USD")}{" "}
          - Restante:{" "}
          {formatearMontoMoneda(
            resumenPorMoneda.USD.restantePorEntregar,
            "USD",
          )}
        </Text>
      </TouchableOpacity>

      <Text style={styles.seccionTitulo}>
        Movimientos y cierre (todos los días y meses) (
        {itemsMovimientosLista.length})
      </Text>

      <View style={styles.filtrosRow}>
        {(
          [
            { key: "todos", label: "Todos" },
            { key: "entradas", label: "Entradas / Cobros" },
            { key: "salidas", label: "Préstamos / Gastos" },
          ] as const
        ).map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filtroChip,
              filtroMov === f.key && styles.filtroChipActivo,
            ]}
            onPress={() => setFiltroMov(f.key)}
          >
            <Text
              style={[
                styles.filtroChipTexto,
                filtroMov === f.key && styles.textoBlanco,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderItemMovimiento = ({ item }: { item: ItemMovimientoLista }) => (
    <View style={styles.contentWrapper}>
      <View
        style={[styles.movItem, item.esResumenCierre && styles.movItemCierre]}
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.movDesc}>{item.descripcion}</Text>
          <Text style={styles.movFecha}>{item.subtitulo}</Text>
        </View>
        <Text
          style={[
            styles.movMonto,
            item.esEntrada ? styles.textoPositivo : styles.textoNegativo,
          ]}
        >
          {item.esEntrada ? "+" : "-"}
          {formatearMontoMoneda(item.monto, item.moneda)}
        </Text>
        {!item.esResumenCierre && item.movimientoOriginal ? (
          <TouchableOpacity
            onPress={() => void eliminarMovimiento(item.movimientoOriginal!.id)}
            style={{ marginLeft: 10 }}
          >
            <Text style={styles.btnEliminar}>Eliminar</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.keyboardWrapper}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        data={itemsMovimientosLista}
        keyExtractor={(item) => item.id}
        renderItem={renderItemMovimiento}
        ListHeaderComponent={renderHeaderLista}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        ListEmptyComponent={
          <View style={styles.contentWrapper}>
            <Text style={styles.vacio}>No hay movimientos registrados.</Text>
          </View>
        }
      />

      <Modal
        visible={tipoModal !== null}
        transparent
        animationType="fade"
        onRequestClose={cerrarModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalCard}>
            <ScrollView
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <Text style={styles.modalTitulo}>{tituloModal}</Text>

              {tipoModal === "efectivo_entregado" ? (
                <View style={styles.resumenEntregaBox}>
                  <Text style={styles.resumenEntregaTexto}>
                    Restante por entregar — COP:{" "}
                    {formatearMontoMoneda(
                      resumenPorMoneda.COP.restantePorEntregar,
                      "COP",
                    )}
                  </Text>
                  <Text style={styles.resumenEntregaTexto}>
                    Restante por entregar — USD:{" "}
                    {formatearMontoMoneda(
                      resumenPorMoneda.USD.restantePorEntregar,
                      "USD",
                    )}
                  </Text>
                </View>
              ) : null}

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
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardWrapper: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 160,
  },
  contentWrapper: {
    width: "100%",
    maxWidth: 820,
    alignSelf: "center",
  },
  gridDos: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  cardEntregar: {
    flex: 1,
    minWidth: 160,
    backgroundColor: "#0F172A",
    padding: 14,
    borderRadius: 10,
  },
  entregarLabel: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "600",
    flexShrink: 1,
  },
  entregarValor: {
    fontSize: 18,
    color: "#fff",
    fontWeight: "bold",
    marginTop: 4,
    flexShrink: 1,
  },
  entregarSub: {
    fontSize: 11,
    color: "#CBD5E1",
    marginTop: 4,
    flexShrink: 1,
  },
  tarjeta: {
    flex: 1,
    minWidth: 160,
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 10,
  },
  tarjetaCalle: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  tarjetaCobradoTotal: {
    borderColor: "#0D9488",
    backgroundColor: "#F0FDFA",
  },
  tarjetaEfectivo: {
    borderColor: "#16A34A",
    backgroundColor: "#F0FDF4",
  },
  tarjetaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  tarjetaTitulo: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    flexShrink: 1,
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
  tarjetaBadgeCalle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1D4ED8",
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
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
    flexShrink: 1,
  },
  subLineaCartera: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
    marginTop: 1,
  },
  seccionTitulo: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
    marginTop: 6,
    marginBottom: 8,
    flexShrink: 1,
  },
  filtrosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  filtroChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#fff",
  },
  filtroChipActivo: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  filtroChipTexto: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  movItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 8,
  },
  movItemCierre: {
    backgroundColor: "#F1F5F9",
    borderColor: "#94A3B8",
  },
  movFecha: { fontSize: 12, color: "#64748B", marginTop: 2 },
  movDesc: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
    flexShrink: 1,
  },
  movMonto: { fontSize: 14, fontWeight: "700" },
  textoPositivo: { color: "#16A34A" },
  textoNegativo: { color: "#DC2626" },
  btnEliminar: { fontSize: 12, fontWeight: "700", color: "#DC2626" },
  vacio: { color: "#64748B", fontStyle: "italic" },
  banner: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
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
    maxWidth: 460,
    maxHeight: "88%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    elevation: 5,
  },
  modalScrollContent: {
    paddingBottom: 32,
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
  resumenEntregaBox: {
    backgroundColor: "#F1F5F9",
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
    gap: 3,
  },
  resumenEntregaTexto: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
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
