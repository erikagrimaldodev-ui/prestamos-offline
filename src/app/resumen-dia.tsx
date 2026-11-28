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
  useWindowDimensions,
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
  interes_porcentaje?: number | null;
  monto_total?: number | null;
  saldo_pendiente?: number | null;
  fecha_creacion: string;
  estado: string;
  moneda?: string | null;
}

interface PagoCajaRow {
  id: number;
  monto_pagado?: number | null;
  monto?: number | null;
  fecha_pago?: string | null;
  fecha_registro_local?: string | null;
  fecha?: string | null;
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

interface ItemMovimientoDia {
  id: string;
  esResumenCierre: boolean;
  esRenovacion: boolean;
  descripcion: string;
  subtitulo: string;
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

  let limpio = texto.trim();
  if (!limpio) return 0;
  if (limpio.includes(",") && limpio.includes(".")) {
    limpio = limpio.replace(/\./g, "").replace(",", ".");
  } else if (limpio.includes(",")) {
    limpio = limpio.replace(",", ".");
  }
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

const esTipoRenovacion = (tipo?: string | null): boolean => {
  const t = (tipo || "").trim().toLowerCase();
  return t === "renovacion" || t === "renovacion_egreso";
};

export default function ResumenDiaCajaScreen() {
  const { width } = useWindowDimensions();
  const esFilaDoble = width >= 560;
  const hoyInicial = obtenerFechaLocalHoy();

  const [fechaHoy, setFechaHoy] = useState(hoyInicial);
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

  const cargarDatosDia = useCallback(async () => {
    const [listaPrestamos, listaPagos, listaMovimientos] = await Promise.all([
      getAllRows<PrestamoCajaRow>(`
        SELECT id, cliente_id, monto_prestado, interes_porcentaje, monto_total, saldo_pendiente, fecha_creacion, estado, moneda
        FROM prestamos
        ORDER BY id ASC
      `),
      getAllRows<PagoCajaRow>(`
        SELECT pg.id, pg.monto_pagado, pg.fecha_pago, pg.fecha_registro_local, p.moneda
        FROM pagos pg
        LEFT JOIN prestamos p ON pg.prestamo_id = p.id
      `),
      getAllRows<MovimientoCajaRow>(`
        SELECT *
        FROM movimientos_caja
        ORDER BY id DESC
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
      void cargarDatosDia().catch(() => {
        setAviso({
          tipo: "error",
          texto: "No se pudieron cargar los datos del día.",
        });
      });
    }, [cargarDatosDia]),
  );

  const resumenDia = useMemo(() => {
    const inicial = {
      efectivoRecibido: 0,
      sumaPrestamosBaseDia: 0,
      sumaPrestamosDia: 0,
      dineroCobradoDia: 0,
      efectivoEntregado: 0,
      gastos: 0,
      renovacionesDia: 0,
      cantidadRenovacionesDia: 0,
      restantePorEntregar: 0,
    };

    const porMoneda: Record<Moneda, typeof inicial> = {
      COP: { ...inicial },
      USD: { ...inicial },
    };

    for (const mov of movimientos) {
      if (normalizarFecha(mov.fecha) !== fechaHoy) continue;
      const m = inferirMonedaMovimiento(mov);
      const monto = Number(mov.monto || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;

      if (mov.tipo === "efectivo_recibido") {
        porMoneda[m].efectivoRecibido += monto;
      } else if (mov.tipo === "efectivo_entregado") {
        porMoneda[m].efectivoEntregado += monto;
      } else if (esTipoRenovacion(mov.tipo)) {
        porMoneda[m].renovacionesDia += monto;
        porMoneda[m].cantidadRenovacionesDia += 1;
      } else if (mov.tipo === "gasto") {
        porMoneda[m].gastos += monto;
      }
    }

    const ultimoRenovadoPorCliente = new Map<number, PrestamoCajaRow>();
    for (const p of prestamos) {
      const estadoLower = (p.estado || "").trim().toLowerCase();
      if (estadoLower === "renovado") {
        ultimoRenovadoPorCliente.set(p.cliente_id, p);
      }
    }

    for (const p of prestamos) {
      if (normalizarFecha(p.fecha_creacion) !== fechaHoy) continue;
      const estadoLower = (p.estado || "").trim().toLowerCase();
      if (estadoLower === "renovado") continue;

      const m = normalizarMoneda(p.moneda);
      const monto = Number(p.monto_prestado || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;

      // Suma el capital de todos los préstamos activos/creados hoy
      porMoneda[m].sumaPrestamosBaseDia += monto;

      // Calcula excedente de caja si es renovación y el capital supera el saldo anterior
      const prevRenovado = ultimoRenovadoPorCliente.get(p.cliente_id);
      const esRenovadoHoy =
        prevRenovado !== undefined &&
        prevRenovado.id < p.id &&
        normalizarFecha(prevRenovado.fecha_creacion) === fechaHoy;

      if (esRenovadoHoy && prevRenovado) {
        const saldoPrev = Number(prevRenovado.saldo_pendiente ?? 0);
        const excedente = Math.max(0, monto - saldoPrev);
        porMoneda[m].excedenteRenovacionDia += excedente;
      }
    }

    for (const pg of pagos) {
      const fechaRef = normalizarFecha(
        pg.fecha_registro_local || pg.fecha_pago || pg.fecha,
      );
      if (fechaRef !== fechaHoy) continue;
      const m = normalizarMoneda(pg.moneda);
      const montoRaw = pg.monto_pagado ?? pg.monto ?? 0;
      const monto = Number(montoRaw);
      if (Number.isNaN(monto) || monto <= 0) continue;
      porMoneda[m].dineroCobradoDia += monto;
    }

    for (const m of ["COP", "USD"] as const) {
      const d = porMoneda[m];
      // Tarjeta Préstamos del Día: suma préstamos + renovaciones
      d.sumaPrestamosDia = d.sumaPrestamosBaseDia + d.renovacionesDia;
      // Caja/restante: descuenta préstamos base + renovaciones/excedentes sin duplicar
      d.restantePorEntregar =
        d.efectivoRecibido +
        d.dineroCobradoDia -
        (d.sumaPrestamosBaseDia +
          d.renovacionesDia +
          d.gastos +
          d.efectivoEntregado);
    }

    return porMoneda;
  }, [movimientos, prestamos, pagos, fechaHoy]);

  const itemsDia = useMemo<ItemMovimientoDia[]>(() => {
    const lista: ItemMovimientoDia[] = [];

    for (const m of ["COP", "USD"] as const) {
      const totalPrestamosM = resumenDia[m].sumaPrestamosDia;
      if (totalPrestamosM > 0) {
        lista.push({
          id: `cierre-prestamos-${fechaHoy}-${m}`,
          esResumenCierre: true,
          esRenovacion: false,
          descripcion: `Cierre del día — Total préstamos (${m})`,
          subtitulo: `${fechaHoy} • Sale de caja`,
          monto: totalPrestamosM,
          moneda: m,
          esEntrada: false,
        });
      }

      const totalCobrosM = resumenDia[m].dineroCobradoDia;
      if (totalCobrosM > 0) {
        lista.push({
          id: `cierre-cobros-${fechaHoy}-${m}`,
          esResumenCierre: true,
          esRenovacion: false,
          descripcion: `Cierre del día — Total cobros (${m})`,
          subtitulo: `${fechaHoy} • Entra a caja`,
          monto: totalCobrosM,
          moneda: m,
          esEntrada: true,
        });
      }
    }

    for (const mov of movimientos) {
      if (normalizarFecha(mov.fecha) !== fechaHoy) continue;
      const montoNum = Number(mov.monto || 0);
      if (Number.isNaN(montoNum) || montoNum <= 0) continue;

      const m = inferirMonedaMovimiento(mov);
      const esEntrada = mov.tipo === "efectivo_recibido";
      const esRenov = esTipoRenovacion(mov.tipo);
      lista.push({
        id: `mov-${mov.id}`,
        esResumenCierre: false,
        esRenovacion: esRenov,
        descripcion: esRenov
          ? `[Excedente renovación en efectivo] ${mov.descripcion}`
          : mov.descripcion,
        subtitulo: esRenov
          ? `${normalizarFecha(mov.fecha)} • Sale de caja (excedente efectivo)`
          : `${normalizarFecha(mov.fecha)} • ${esEntrada ? "Entra a caja" : "Sale de caja"}`,
        monto: montoNum,
        moneda: m,
        esEntrada,
        movimientoOriginal: mov,
      });
    }

    return lista;
  }, [movimientos, resumenDia, fechaHoy]);

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
      await cargarDatosDia();
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
      await cargarDatosDia();
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

  const cobradoRecibidoCop =
    resumenDia.COP.dineroCobradoDia + resumenDia.COP.efectivoRecibido;
  const cobradoRecibidoUsd =
    resumenDia.USD.dineroCobradoDia + resumenDia.USD.efectivoRecibido;

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

      <View style={styles.heroPanel}>
        <Text style={styles.heroEyebrow}>CIERRE DEL DÍA</Text>
        <Text style={styles.heroTitle}>Caja Diaria • {fechaHoy}</Text>

        <View
          style={[
            styles.gridDos,
            !esFilaDoble && styles.gridDosColumna,
            { marginTop: 12, marginBottom: 0 },
          ]}
        >
          <View
            style={[
              styles.cardEntregar,
              esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
            ]}
          >
            <Text style={styles.entregarLabel}>
              Restante por entregar (COP)
            </Text>
            <Text style={styles.entregarValor}>
              {formatearMontoMoneda(resumenDia.COP.restantePorEntregar, "COP")}
            </Text>
            <Text style={styles.entregarSub}>
              Cobrado + Recibido:{" "}
              {formatearMontoMoneda(cobradoRecibidoCop, "COP")}
            </Text>
          </View>

          <View
            style={[
              styles.cardEntregar,
              esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
            ]}
          >
            <Text style={styles.entregarLabel}>
              Restante por entregar (USD)
            </Text>
            <Text style={styles.entregarValor}>
              {formatearMontoMoneda(resumenDia.USD.restantePorEntregar, "USD")}
            </Text>
            <Text style={styles.entregarSub}>
              Cobrado + Recibido:{" "}
              {formatearMontoMoneda(cobradoRecibidoUsd, "USD")}
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.tarjeta, styles.tarjetaEfectivo]}
        onPress={() => abrirModal("efectivo_recibido")}
        activeOpacity={0.8}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Efectivo Recibido del Jefe</Text>
          <Text style={styles.tarjetaAccion}>+ Registrar (toca aquí)</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenDia.COP.efectivoRecibido, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenDia.USD.efectivoRecibido, "USD")}
        </Text>
      </TouchableOpacity>

      <View style={[styles.tarjeta, styles.tarjetaAcentoVerde]}>
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>
            Dinero Cobrado a Clientes (Día)
          </Text>
          <Text style={styles.tarjetaBadgePositivo}>Entra a caja</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenDia.COP.dineroCobradoDia, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenDia.USD.dineroCobradoDia, "USD")}
        </Text>
      </View>

      <View style={[styles.tarjeta, styles.tarjetaAcentoRojo]}>
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Préstamos del Día</Text>
          <Text style={styles.tarjetaBadgeNegativo}>Sale de caja</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenDia.COP.sumaPrestamosDia, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenDia.USD.sumaPrestamosDia, "USD")}
        </Text>
        <Text style={styles.subLinea}>
          Préstamos:{" "}
          {formatearMontoMoneda(resumenDia.COP.sumaPrestamosBaseDia, "COP")} •
          Renovaciones:{" "}
          {formatearMontoMoneda(resumenDia.COP.renovacionesDia, "COP")} (
          {resumenDia.COP.cantidadRenovacionesDia} COP /{" "}
          {resumenDia.USD.cantidadRenovacionesDia} USD)
        </Text>
        <Text style={styles.subLinea}>
          Excedente de caja por renovación:{" "}
          {formatearMontoMoneda(resumenDia.COP.renovacionesDia, "COP")} •{" "}
          {formatearMontoMoneda(resumenDia.USD.renovacionesDia, "USD")}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.tarjeta, styles.tarjetaAcentoAmbar]}
        onPress={() => abrirModal("gasto")}
        activeOpacity={0.8}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Total Gastos (Día)</Text>
          <Text style={styles.tarjetaAccionNegativa}>+ Registrar gasto</Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenDia.COP.gastos, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenDia.USD.gastos, "USD")}
        </Text>
        <Text style={styles.subLinea}>Gastos operativos</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tarjeta, styles.tarjetaAcentoRojo]}
        onPress={() => abrirModal("efectivo_entregado")}
        activeOpacity={0.8}
      >
        <View style={styles.tarjetaHeader}>
          <Text style={styles.tarjetaTitulo}>Dinero Entregado al Jefe</Text>
          <Text style={styles.tarjetaAccionNegativa}>
            + Entregar / Sale de caja
          </Text>
        </View>
        <Text style={styles.montoLinea}>
          COP: {formatearMontoMoneda(resumenDia.COP.efectivoEntregado, "COP")} -
          Restante:{" "}
          {formatearMontoMoneda(resumenDia.COP.restantePorEntregar, "COP")}
        </Text>
        <Text style={styles.montoLinea}>
          USD: {formatearMontoMoneda(resumenDia.USD.efectivoEntregado, "USD")} -
          Restante:{" "}
          {formatearMontoMoneda(resumenDia.USD.restantePorEntregar, "USD")}
        </Text>
      </TouchableOpacity>

      <Text style={styles.seccionTitulo}>
        Cierre y movimientos del día ({itemsDia.length})
      </Text>
    </View>
  );

  const renderItemMovimiento = ({ item }: { item: ItemMovimientoDia }) => (
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
        data={itemsDia}
        keyExtractor={(item) => item.id}
        renderItem={renderItemMovimiento}
        ListHeaderComponent={renderHeaderLista()}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        ListEmptyComponent={
          <Text style={styles.vacio}>No hay movimientos registrados hoy.</Text>
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
                      resumenDia.COP.restantePorEntregar,
                      "COP",
                    )}
                  </Text>
                  <Text style={styles.resumenEntregaTexto}>
                    Restante por entregar — USD:{" "}
                    {formatearMontoMoneda(
                      resumenDia.USD.restantePorEntregar,
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
  keyboardWrapper: { flex: 1, backgroundColor: "#F1F5F9" },
  container: { flex: 1, backgroundColor: "#ffffff" },
  scrollContent: { padding: 16, paddingBottom: 160 },
  contentWrapper: { width: "100%", maxWidth: 860, alignSelf: "center" },
  heroPanel: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  heroEyebrow: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#0632b6",
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#000000",
    marginTop: 2,
  },
  gridDos: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    marginBottom: 10,
  },
  gridDosColumna: { flexDirection: "column" },
  itemFilaDoble: { flex: 1, minWidth: 0, marginBottom: 0 },
  itemColumna: { width: "100%", marginBottom: 0 },
  cardEntregar: {
    backgroundColor: "#ffffff",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#243554",
  },
  entregarLabel: {
    fontSize: 12,
    color: "#505360",
    fontWeight: "600",
    flexShrink: 1,
  },
  entregarValor: {
    fontSize: 20,
    color: "#127631",
    fontWeight: "800",
    marginTop: 4,
    flexShrink: 1,
  },
  entregarSub: {
    fontSize: 11,
    color: "#1229be",
    fontWeight: "600",
    marginTop: 5,
    flexShrink: 1,
  },
  tarjeta: {
    backgroundColor: "#FFFFFF",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 10,
  },
  tarjetaEfectivo: {
    borderLeftWidth: 4,
    borderLeftColor: "#16A34A",
    borderColor: "#BBF7D0",
    backgroundColor: "#F8FEF9",
  },
  tarjetaAcentoVerde: {
    borderLeftWidth: 4,
    borderLeftColor: "#10B981",
    borderColor: "#D1FAE5",
  },
  tarjetaAcentoRojo: {
    borderLeftWidth: 4,
    borderLeftColor: "#EF4444",
    borderColor: "#FEE2E2",
  },
  tarjetaAcentoAmbar: {
    borderLeftWidth: 4,
    borderLeftColor: "#F59E0B",
    borderColor: "#FEF3C7",
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
  tarjetaAccion: { fontSize: 12, fontWeight: "700", color: "#16A34A" },
  tarjetaAccionNegativa: { fontSize: 12, fontWeight: "700", color: "#DC2626" },
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
  subLinea: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 4,
  },
  seccionTitulo: {
    fontSize: 14,
    fontWeight: "800",
    color: "#1E293B",
    marginTop: 6,
    marginBottom: 8,
  },
  movItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 8,
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
  },
  movItemCierre: { backgroundColor: "#F8FAFC", borderColor: "#CBD5E1" },
  movDesc: { fontSize: 14, fontWeight: "600", color: "#0F172A", flexShrink: 1 },
  movFecha: { fontSize: 12, color: "#64748B", marginTop: 2 },
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
  modalScrollContent: { paddingBottom: 32 },
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
  resumenEntregaTexto: { fontSize: 12, fontWeight: "700", color: "#0F172A" },
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
