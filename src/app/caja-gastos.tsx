import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { getAllRows, runQuery } from "../../database/db";

type Moneda = "COP" | "USD";
type FiltroMov = "todos" | "entradas" | "salidas" | "renovaciones";

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

interface TotalClientesRow {
  total: number | null;
}

interface ItemMovimientoGeneral {
  id: string;
  esResumenCierre: boolean;
  esRenovacion: boolean;
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

const obtenerMontoTotalPrestamo = (p: PrestamoCajaRow): number => {
  const totalGuardado = Number(p.monto_total ?? 0);
  if (!Number.isNaN(totalGuardado) && totalGuardado > 0) {
    return totalGuardado;
  }
  const prestado = Number(p.monto_prestado || 0);
  const pct = Number(p.interes_porcentaje || 0);
  if (Number.isNaN(prestado) || prestado <= 0) return 0;
  return prestado + prestado * (pct / 100);
};

export default function ResumenGeneralScreen() {
  const { width } = useWindowDimensions();
  const esFilaDoble = width >= 560;

  const [filtroMov, setFiltroMov] = useState<FiltroMov>("todos");
  const [totalClientes, setTotalClientes] = useState<number>(0);
  const [prestamos, setPrestamos] = useState<PrestamoCajaRow[]>([]);
  const [pagos, setPagos] = useState<PagoCajaRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoCajaRow[]>([]);
  const [aviso, setAviso] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);

  const cargarDatosGenerales = useCallback(async () => {
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

    let conteoClientes = 0;
    try {
      const rowsClientes = await getAllRows<TotalClientesRow>(`
        SELECT COUNT(*) AS total FROM clientes
      `);
      conteoClientes = Number(rowsClientes[0]?.total ?? 0);
    } catch {
      conteoClientes = 0;
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
        ORDER BY fecha DESC, id DESC
      `),
    ]);

    setTotalClientes(Number.isNaN(conteoClientes) ? 0 : conteoClientes);
    setPrestamos(listaPrestamos);
    setPagos(listaPagos);
    setMovimientos(listaMovimientos);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargarDatosGenerales().catch(() => {
        setAviso({
          tipo: "error",
          texto: "No se pudieron cargar los datos del resumen general.",
        });
      });
    }, [cargarDatosGenerales]),
  );

  const resumenGeneral = useMemo(() => {
    const inicial = {
      dineroEnCalleTotal: 0,
      capitalEnCalleTotal: 0,
      montoCobradoHistorico: 0,
      montoPrestadoHistorico: 0,
      renovacionesHistoricas: 0,
      cantidadRenovaciones: 0,
      gastosHistoricos: 0,
      efectivoRecibidoHistorico: 0,
      efectivoEntregadoHistorico: 0,
      cajaDisponibleHistorica: 0,
      gananciaProyectadaCalle: 0,
    };

    const porMoneda: Record<Moneda, typeof inicial> = {
      COP: { ...inicial },
      USD: { ...inicial },
    };

    for (const mov of movimientos) {
      const m = inferirMonedaMovimiento(mov);
      const monto = Number(mov.monto || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;

      if (mov.tipo === "efectivo_recibido") {
        porMoneda[m].efectivoRecibidoHistorico += monto;
      } else if (mov.tipo === "efectivo_entregado") {
        porMoneda[m].efectivoEntregadoHistorico += monto;
      } else if (esTipoRenovacion(mov.tipo)) {
        porMoneda[m].renovacionesHistoricas += monto;
        porMoneda[m].cantidadRenovaciones += 1;
      } else if (mov.tipo === "gasto") {
        porMoneda[m].gastosHistoricos += monto;
      }
    }

    for (const p of prestamos) {
      const estadoLower = (p.estado || "").trim().toLowerCase();
      const m = normalizarMoneda(p.moneda);
      const montoPrestado = Number(p.monto_prestado || 0);

      if (
        estadoLower !== "renovado" &&
        !Number.isNaN(montoPrestado) &&
        montoPrestado > 0
      ) {
        porMoneda[m].montoPrestadoHistorico += montoPrestado;
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

    for (const pg of pagos) {
      const m = normalizarMoneda(pg.moneda);
      const monto = Number(pg.monto_pagado || 0);
      if (Number.isNaN(monto) || monto <= 0) continue;
      porMoneda[m].montoCobradoHistorico += monto;
    }

    for (const m of ["COP", "USD"] as const) {
      const d = porMoneda[m];
      d.cajaDisponibleHistorica =
        d.efectivoRecibidoHistorico +
        d.montoCobradoHistorico -
        (d.montoPrestadoHistorico +
          d.renovacionesHistoricas +
          d.gastosHistoricos +
          d.efectivoEntregadoHistorico);
      d.gananciaProyectadaCalle = Math.max(
        0,
        d.dineroEnCalleTotal - d.capitalEnCalleTotal,
      );
    }

    return porMoneda;
  }, [movimientos, prestamos, pagos]);

  const itemsHistoricos = useMemo<ItemMovimientoGeneral[]>(() => {
    const lista: ItemMovimientoGeneral[] = [];
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
        esRenovacion: false,
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
        esRenovacion: false,
        descripcion: `Cierre del día — Total cobros (${m})`,
        subtitulo: `${fechaPg} • Entra a caja`,
        fechaOrden: fechaPg,
        monto: totalCobrado,
        moneda: m,
        esEntrada: true,
      });
    }

    for (const mov of movimientos) {
      const m = inferirMonedaMovimiento(mov);
      const esEntrada = mov.tipo === "efectivo_recibido";
      const esRenov = esTipoRenovacion(mov.tipo);
      const fechaMov = normalizarFecha(mov.fecha);
      lista.push({
        id: `mov-${mov.id}`,
        esResumenCierre: false,
        esRenovacion: esRenov,
        descripcion: esRenov
          ? `[Renovación] ${mov.descripcion}`
          : mov.descripcion,
        subtitulo: esRenov
          ? `${fechaMov || mov.fecha} • Sale de caja`
          : fechaMov || mov.fecha,
        fechaOrden: fechaMov,
        monto: Number(mov.monto || 0),
        moneda: m,
        esEntrada,
        movimientoOriginal: mov,
      });
    }

    lista.sort((a, b) => b.fechaOrden.localeCompare(a.fechaOrden));

    if (filtroMov === "entradas") {
      return lista.filter((item) => item.esEntrada);
    }
    if (filtroMov === "salidas") {
      return lista.filter((item) => !item.esEntrada);
    }
    if (filtroMov === "renovaciones") {
      return lista.filter((item) => item.esRenovacion);
    }
    return lista;
  }, [prestamos, pagos, movimientos, filtroMov]);

  const eliminarMovimiento = async (id: number) => {
    try {
      await runQuery("DELETE FROM movimientos_caja WHERE id = ?", [id]);
      await cargarDatosGenerales();
      setAviso({
        tipo: "exito",
        texto: "Movimiento eliminado correctamente.",
      });
    } catch (e: any) {
      setAviso({
        tipo: "error",
        texto: `Error al eliminar: ${e?.message || "error"}`,
      });
    }
  };

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

      {/* PANEL PRINCIPAL: CAJA GENERAL + CLIENTES */}
      <View style={styles.heroPanel}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>RESUMEN GENERAL</Text>
            <Text style={styles.heroTitle}>Balance Histórico y Cartera</Text>
          </View>
        </View>

        <View
          style={[
            styles.gridDos,
            !esFilaDoble && styles.gridDosColumna,
            { marginBottom: 0 },
          ]}
        >
          <View
            style={[
              styles.cardCajaTotal,
              esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
            ]}
          >
            <Text style={styles.cajaLabel}>Caja Disponible (COP)</Text>
            <Text style={styles.cajaValorCop}>
              {formatearMontoMoneda(
                resumenGeneral.COP.cajaDisponibleHistorica,
                "COP",
              )}
            </Text>
            <Text style={styles.cajaSub}>
              Recibido:{" "}
              {formatearMontoMoneda(
                resumenGeneral.COP.efectivoRecibidoHistorico,
                "COP",
              )}{" "}
              - Entregado:{" "}
              {formatearMontoMoneda(
                resumenGeneral.COP.efectivoEntregadoHistorico,
                "COP",
              )}
            </Text>
          </View>

          <View
            style={[
              styles.cardCajaTotal,
              esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
            ]}
          >
            <Text style={styles.cajaLabel}>Caja Disponible (USD)</Text>
            <Text style={styles.cajaValorUsd}>
              {formatearMontoMoneda(
                resumenGeneral.USD.cajaDisponibleHistorica,
                "USD",
              )}
            </Text>
            <Text style={styles.cajaSub}>
              Recibido:{" "}
              {formatearMontoMoneda(
                resumenGeneral.USD.efectivoRecibidoHistorico,
                "USD",
              )}{" "}
              - Entregado:{" "}
              {formatearMontoMoneda(
                resumenGeneral.USD.efectivoEntregadoHistorico,
                "USD",
              )}
            </Text>
          </View>
        </View>
      </View>

      {/* FILA 1: TOTAL PRÉSTAMOS Y TOTAL COBROS */}
      <View style={[styles.gridDos, !esFilaDoble && styles.gridDosColumna]}>
        <View
          style={[
            styles.tarjeta,
            styles.tarjetaAcentoAzul,
            esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
          ]}
        >
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Total Préstamos</Text>
            <Text style={styles.tarjetaBadgeAzul}>Préstamos</Text>
          </View>
          <Text style={styles.montoLinea}>
            COP:{" "}
            {formatearMontoMoneda(
              resumenGeneral.COP.montoPrestadoHistorico,
              "COP",
            )}
          </Text>
          <Text style={styles.montoLinea}>
            USD:{" "}
            {formatearMontoMoneda(
              resumenGeneral.USD.montoPrestadoHistorico,
              "USD",
            )}
          </Text>
          <Text style={styles.subLineaCartera}>
            Renovaciones ({resumenGeneral.COP.cantidadRenovaciones} COP /{" "}
            {resumenGeneral.USD.cantidadRenovaciones} USD):{" "}
            {formatearMontoMoneda(
              resumenGeneral.COP.renovacionesHistoricas,
              "COP",
            )}{" "}
            •{" "}
            {formatearMontoMoneda(
              resumenGeneral.USD.renovacionesHistoricas,
              "USD",
            )}
          </Text>
          <Text style={styles.subLinea}>Capital prestado acumulado</Text>
        </View>

        <View
          style={[
            styles.tarjeta,
            styles.tarjetaAcentoEsmeralda,
            esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
          ]}
        >
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Total Cobros</Text>
            <Text style={styles.tarjetaBadgeVerde}>Cobro</Text>
          </View>
          <Text style={styles.montoLinea}>
            COP:{" "}
            {formatearMontoMoneda(
              resumenGeneral.COP.montoCobradoHistorico,
              "COP",
            )}
          </Text>
          <Text style={styles.montoLinea}>
            USD:{" "}
            {formatearMontoMoneda(
              resumenGeneral.USD.montoCobradoHistorico,
              "USD",
            )}
          </Text>
          <Text style={styles.subLinea}>Todos los pagos registrados</Text>
        </View>
      </View>

      {/* FILA 2: DINERO EN LA CALLE Y GANANCIA PROYECTADA EN CALLE */}
      <View style={[styles.gridDos, !esFilaDoble && styles.gridDosColumna]}>
        <View
          style={[
            styles.tarjeta,
            styles.tarjetaAcentoCian,
            esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
          ]}
        >
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Dinero en la Calle</Text>
            <Text style={styles.tarjetaBadgeCian}>Capital + Interés</Text>
          </View>
          <Text style={styles.montoLinea}>
            COP:{" "}
            {formatearMontoMoneda(resumenGeneral.COP.dineroEnCalleTotal, "COP")}
          </Text>
          <Text style={styles.subLineaCartera}>
            Capital:{" "}
            {formatearMontoMoneda(
              resumenGeneral.COP.capitalEnCalleTotal,
              "COP",
            )}
          </Text>
          <Text style={styles.montoLinea}>
            USD:{" "}
            {formatearMontoMoneda(resumenGeneral.USD.dineroEnCalleTotal, "USD")}
          </Text>
          <Text style={styles.subLineaCartera}>
            Capital:{" "}
            {formatearMontoMoneda(
              resumenGeneral.USD.capitalEnCalleTotal,
              "USD",
            )}
          </Text>
        </View>

        <View
          style={[
            styles.tarjeta,
            styles.tarjetaAcentoTeal,
            esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
          ]}
        >
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Ganancias</Text>
            <Text style={styles.tarjetaBadgeTeal}>Ganancia</Text>
          </View>
          <Text style={styles.montoLinea}>
            COP:{" "}
            {formatearMontoMoneda(
              resumenGeneral.COP.gananciaProyectadaCalle,
              "COP",
            )}
          </Text>
          <Text style={styles.montoLinea}>
            USD:{" "}
            {formatearMontoMoneda(
              resumenGeneral.USD.gananciaProyectadaCalle,
              "USD",
            )}
          </Text>
          <Text style={styles.subLinea}>
            Diferencia entre total e inversión activa
          </Text>
        </View>
      </View>

      {/* FILA 3: TOTAL GASTOS Y CLIENTES REGISTRADOS */}
      <View style={[styles.gridDos, !esFilaDoble && styles.gridDosColumna]}>
        <View
          style={[
            styles.tarjeta,
            styles.tarjetaAcentoAmbar,
            esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
          ]}
        >
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Total Gastos</Text>
            <Text style={styles.tarjetaBadgeAmbar}>Egresos</Text>
          </View>
          <Text style={styles.montoLinea}>
            COP:{" "}
            {formatearMontoMoneda(resumenGeneral.COP.gastosHistoricos, "COP")}
          </Text>
          <Text style={styles.montoLinea}>
            USD:{" "}
            {formatearMontoMoneda(resumenGeneral.USD.gastosHistoricos, "USD")}
          </Text>
          <Text style={styles.subLinea}>Gastos operativos</Text>
        </View>

        <View
          style={[
            styles.tarjeta,
            styles.tarjetaAcentoMorado,
            esFilaDoble ? styles.itemFilaDoble : styles.itemColumna,
          ]}
        >
          <View style={styles.tarjetaHeader}>
            <Text style={styles.tarjetaTitulo}>Clientes Registrados</Text>
            <Text style={styles.tarjetaBadgeMorado}>Clientes</Text>
          </View>
          <Text style={styles.clientesBigNumber}>{totalClientes}</Text>
          <Text style={styles.subLinea}>
            Total de prestatarios en el sistema
          </Text>
        </View>
      </View>

      <Text style={styles.seccionTitulo}>
        Historial de movimientos y cierres ({itemsHistoricos.length})
      </Text>

      <View style={styles.filtrosRow}>
        {(
          [
            { key: "todos", label: "Todos" },
            { key: "entradas", label: "Entradas / Cobros" },
            { key: "salidas", label: "Préstamos / Gastos" },
            { key: "renovaciones", label: "Renovaciones" },
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

  const renderItemMovimiento = ({ item }: { item: ItemMovimientoGeneral }) => (
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
    <View style={styles.container}>
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        data={itemsHistoricos}
        keyExtractor={(item) => item.id}
        renderItem={renderItemMovimiento}
        ListHeaderComponent={renderHeaderLista()}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        ListEmptyComponent={
          <Text style={styles.vacio}>No hay movimientos registrados.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  scrollContent: { padding: 16, paddingBottom: 160 },
  contentWrapper: { width: "100%", maxWidth: 860, alignSelf: "center" },
  heroPanel: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 10,
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
  clientesPill: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
  },
  clientesPillLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#06387e",
    letterSpacing: 0.5,
  },
  clientesPillValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#e41441",
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
  cardCajaTotal: {
    backgroundColor: "#ffffff",
    padding: 14,
  },
  cajaLabel: { fontSize: 12, color: "#696e7e", fontWeight: "600" },
  cajaValorCop: {
    fontSize: 20,
    color: "#34D399",
    fontWeight: "800",
    marginTop: 4,
  },
  cajaValorUsd: {
    fontSize: 20,
    color: "#38BDF8",
    fontWeight: "800",
    marginTop: 4,
  },
  cajaSub: {
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
  tarjetaAcentoAzul: {
    borderLeftWidth: 4,
    borderLeftColor: "#2563EB",
    borderColor: "#DBEAFE",
  },
  tarjetaAcentoEsmeralda: {
    borderLeftWidth: 4,
    borderLeftColor: "#10B981",
    borderColor: "#D1FAE5",
  },
  tarjetaAcentoCian: {
    borderLeftWidth: 4,
    borderLeftColor: "#0284C7",
    borderColor: "#E0F2FE",
  },
  tarjetaAcentoTeal: {
    borderLeftWidth: 4,
    borderLeftColor: "#0D9488",
    borderColor: "#CCFBF1",
  },
  tarjetaAcentoAmbar: {
    borderLeftWidth: 4,
    borderLeftColor: "#F59E0B",
    borderColor: "#FEF3C7",
  },
  tarjetaAcentoMorado: {
    borderLeftWidth: 4,
    borderLeftColor: "#8B5CF6",
    borderColor: "#EDE9FE",
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
  tarjetaBadgeAzul: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1D4ED8",
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tarjetaBadgeVerde: {
    fontSize: 11,
    fontWeight: "700",
    color: "#15803D",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tarjetaBadgeCian: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0369A1",
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tarjetaBadgeTeal: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0F766E",
    backgroundColor: "#CCFBF1",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tarjetaBadgeAmbar: {
    fontSize: 11,
    fontWeight: "700",
    color: "#B45309",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tarjetaBadgeMorado: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6D28D9",
    backgroundColor: "#EDE9FE",
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
    marginBottom: 3,
  },
  clientesBigNumber: {
    fontSize: 26,
    fontWeight: "800",
    color: "#5B21B6",
    marginTop: 2,
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
    backgroundColor: "#FFFFFF",
  },
  filtroChipActivo: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  filtroChipTexto: { fontSize: 12, fontWeight: "700", color: "#334155" },
  textoBlanco: { color: "#FFFFFF" },
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
  movDesc: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
    flexShrink: 1,
  },
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
});
