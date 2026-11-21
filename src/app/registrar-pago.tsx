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
type FiltroFrecuencia = "todas" | "diario" | "semanal" | "mensual";

interface PrestamoActivo {
  id: number;
  cliente_id: number;
  monto_prestado?: number | null;
  interes_porcentaje?: number | null;
  monto_total?: number | null;
  saldo_pendiente: number;
  valor_cuota: number;
  cantidad_cuotas?: number | null;
  frecuencia: string;
  fecha_creacion?: string | null;
  moneda?: string | null;
  cliente_nombre: string;
  pagado_hoy: number;
  ultima_fecha_pago?: string | null;
  total_pagos_registrados?: number | null;
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

const normalizarFrecuencia = (
  frecuencia?: string | null,
): "diario" | "semanal" | "quincenal" | "mensual" | "otra" => {
  const f = (frecuencia || "").trim().toLowerCase();
  if (
    f === "diario" ||
    f === "diaria" ||
    f === "dias" ||
    f === "día" ||
    f === "días"
  ) {
    return "diario";
  }
  if (f === "semanal" || f === "semanas" || f === "semana") {
    return "semanal";
  }
  if (f === "quincenal" || f === "quincena" || f === "quincenas") {
    return "quincenal";
  }
  if (f === "mensual" || f === "mes" || f === "meses" || f === "mensuales") {
    return "mensual";
  }
  return "otra";
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

const formatearPorcentaje = (valor: number | null | undefined): string => {
  const num = Number(valor ?? 0);
  if (Number.isNaN(num)) return "0";
  return Number.isInteger(num) ? String(num) : String(num);
};

const obtenerMontoTotalEfectivo = (prestamo: PrestamoActivo): number => {
  if (prestamo.monto_total != null && Number(prestamo.monto_total) > 0) {
    return Number(prestamo.monto_total);
  }
  const base = Number(prestamo.monto_prestado || 0);
  const pct = Number(prestamo.interes_porcentaje || 0);
  return base + (base * pct) / 100;
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

const formatearFechaISO = (fecha: Date): string => {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parsearFechaLocalISO = (fechaStr?: string | null): Date | null => {
  if (!fechaStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const fecha = new Date(year, month, day);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

const diferenciaDiasCalendario = (
  fechaInicioStr?: string | null,
  fechaFinStr?: string | null,
): number | null => {
  const inicio = parsearFechaLocalISO(fechaInicioStr);
  const fin = parsearFechaLocalISO(fechaFinStr);
  if (!inicio || !fin) return null;
  const msPorDia = 1000 * 60 * 60 * 24;
  return Math.floor((fin.getTime() - inicio.getTime()) / msPorDia);
};

const sumarIntervaloCuotaISO = (
  fechaBaseStr: string | null | undefined,
  freq: ReturnType<typeof normalizarFrecuencia>,
  numeroCuota: number,
): string | null => {
  const base = parsearFechaLocalISO(fechaBaseStr);
  if (!base) return null;
  const paso = Math.max(1, numeroCuota);

  if (freq === "diario") {
    const copia = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + paso,
    );
    return formatearFechaISO(copia);
  }
  if (freq === "semanal") {
    const copia = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + paso * 7,
    );
    return formatearFechaISO(copia);
  }
  if (freq === "quincenal") {
    const copia = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + paso * 15,
    );
    return formatearFechaISO(copia);
  }
  if (freq === "mensual") {
    const copia = new Date(
      base.getFullYear(),
      base.getMonth() + paso,
      base.getDate(),
    );
    return formatearFechaISO(copia);
  }
  return null;
};

const obtenerFechaRegistroEfectiva = (
  prestamo: PrestamoActivo,
  fechaLocalRespaldo: string,
): string => {
  const limpia = (prestamo.fecha_creacion || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpia)) {
    return limpia;
  }
  return fechaLocalRespaldo;
};

const calcularCuotasFaltantes = (prestamo: PrestamoActivo): number => {
  const saldo = Number(prestamo.saldo_pendiente || 0);
  const cuota = Number(prestamo.valor_cuota || 0);
  if (saldo <= 0) return 0;
  if (cuota > 0) {
    return Math.max(1, Math.ceil(saldo / cuota));
  }
  return Math.max(0, Number(prestamo.cantidad_cuotas || 0));
};

const calcularMontoPagadoEstimado = (prestamo: PrestamoActivo): number => {
  const totalBase = obtenerMontoTotalEfectivo(prestamo);
  const saldo = Number(prestamo.saldo_pendiente || 0);
  return Math.max(0, totalBase - saldo);
};

const obtenerProximaFechaCuota = (
  prestamo: PrestamoActivo,
  fechaLocalRespaldo: string,
): string | null => {
  const fechaBase = obtenerFechaRegistroEfectiva(prestamo, fechaLocalRespaldo);
  const freq = normalizarFrecuencia(prestamo.frecuencia);
  if (freq === "otra") return null;

  const cuotaVal = Math.max(1, Number(prestamo.valor_cuota || 1));
  const pagado = calcularMontoPagadoEstimado(prestamo);
  const cuotasCubiertas = Math.max(0, Math.floor(pagado / cuotaVal));
  const siguienteCuotaNumero = cuotasCubiertas + 1;

  return sumarIntervaloCuotaISO(fechaBase, freq, siguienteCuotaNumero);
};

const obtenerFechaCuotaVencida = (
  prestamo: PrestamoActivo,
  fechaHoyRef: string,
): { fechaCuota: string; diasAtraso: number } | null => {
  const fechaCuotaPrevista = obtenerProximaFechaCuota(prestamo, fechaHoyRef);
  if (!fechaCuotaPrevista) return null;

  if (fechaHoyRef > fechaCuotaPrevista) {
    const atraso =
      diferenciaDiasCalendario(fechaCuotaPrevista, fechaHoyRef) ?? 1;
    return { fechaCuota: fechaCuotaPrevista, diasAtraso: Math.max(1, atraso) };
  }
  return null;
};

const obtenerAlertaMoraLetras = (
  prestamo: PrestamoActivo,
  fechaHoyRef: string,
): string | null => {
  const vencimientoCuota = obtenerFechaCuotaVencida(prestamo, fechaHoyRef);
  if (vencimientoCuota && vencimientoCuota.diasAtraso > 2) {
    return `EN MORA: ATRASO DE LA FECHA DE LA CUOTA (${vencimientoCuota.fechaCuota} • ${vencimientoCuota.diasAtraso} DÍAS DE ATRASO)`;
  }
  return null;
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
  const [filtroFrecuencia, setFiltroFrecuencia] =
    useState<FiltroFrecuencia>("todas");
  const [montoPagado, setMontoPagado] = useState("");
  const [monedaPago, setMonedaPago] = useState<Moneda>("COP");

  const [pagoPendienteTasa, setPagoPendienteTasa] =
    useState<PagoPendienteConversion | null>(null);
  const [tasaDiariaInput, setTasaDiariaInput] = useState("00");
  const [errorTasa, setErrorTasa] = useState("");
  const [guardandoTasa, setGuardandoTasa] = useState(false);

  const [fechaLocalHoy, setFechaLocalHoy] = useState(obtenerFechaLocalHoy());
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
        p.monto_prestado,
        p.interes_porcentaje,
        p.monto_total,
        p.saldo_pendiente,
        p.valor_cuota,
        p.cantidad_cuotas,
        p.frecuencia,
        p.fecha_creacion,
        p.moneda,
        c.nombre AS cliente_nombre,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM pagos pg
            WHERE pg.prestamo_id = p.id
              AND COALESCE(pg.fecha_registro_local, pg.fecha_pago) = ?
          ) THEN 1
          ELSE 0
        END AS pagado_hoy,
        (
          SELECT MAX(COALESCE(pg2.fecha_registro_local, pg2.fecha_pago))
          FROM pagos pg2
          WHERE pg2.prestamo_id = p.id
        ) AS ultima_fecha_pago,
        (
          SELECT COUNT(*)
          FROM pagos pg3
          WHERE pg3.prestamo_id = p.id
        ) AS total_pagos_registrados
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
    return prestamosActivos.filter((p) => {
      const coincideNombre = !q || p.cliente_nombre.toLowerCase().includes(q);
      if (!coincideNombre) return false;
      if (filtroFrecuencia === "todas") return true;
      return normalizarFrecuencia(p.frecuencia) === filtroFrecuencia;
    });
  }, [prestamosActivos, busqueda, filtroFrecuencia]);

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
        equivalente = montoPagoIngresado / tasa;
      } else if (mPago === "USD" && mPrest === "COP") {
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

      <Text style={styles.label}>Filtrar por cuota:</Text>
      <View style={styles.filtrosFrecuenciaRow}>
        {(
          [
            { key: "todas", label: "Todas" },
            { key: "diario", label: "Diarias" },
            { key: "semanal", label: "Semanal" },
            { key: "quincenal", label: "Quincenal" },
            { key: "mensual", label: "Mensual" },
          ] as const
        ).map((op) => {
          const activo = filtroFrecuencia === op.key;
          return (
            <TouchableOpacity
              key={op.key}
              style={[styles.filtroChip, activo && styles.filtroChipActivo]}
              onPress={() => setFiltroFrecuencia(op.key)}
            >
              <Text
                style={[
                  styles.filtroChipTexto,
                  activo && styles.filtroChipTextoActivo,
                ]}
              >
                {op.label}
              </Text>
            </TouchableOpacity>
          );
        })}
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
          const montoPrestadoValor =
            item.monto_prestado != null && Number(item.monto_prestado) > 0
              ? Number(item.monto_prestado)
              : Number(item.monto_total || 0);
          const montoTotalValor = obtenerMontoTotalEfectivo(item);
          const porcentajeTexto = formatearPorcentaje(item.interes_porcentaje);
          const fechaRegistroPrestamo = obtenerFechaRegistroEfectiva(
            item,
            fechaHoyEfectiva,
          );
          const cuotasFaltantes = calcularCuotasFaltantes(item);
          const montoPagadoValor = calcularMontoPagadoEstimado(item);
          const proximaFechaCuota = obtenerProximaFechaCuota(
            item,
            fechaHoyEfectiva,
          );
          const alertaMora = obtenerAlertaMoraLetras(item, fechaHoyEfectiva);

          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.itemCard,
                pagadoHoy && styles.itemCardPagadoHoy,
                alertaMora && !pagadoHoy && styles.itemCardMora,
              ]}
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
                      {item.cliente_nombre} (#{item.id}) Monto prestado:{" "}
                      {formatearMontoPorMoneda(montoPrestadoValor, monedaItem)}
                    </Text>
                    <TouchableOpacity
                      style={styles.btnPagarItem}
                      onPress={() => abrirModalPago(item)}
                    >
                      <Text style={styles.btnPagarItemTexto}>Pagar</Text>
                    </TouchableOpacity>
                    {pagadoHoy ? (
                      <View style={styles.badgePagado}>
                        <Text style={styles.badgeTexto}>Pagado hoy</Text>
                      </View>
                    ) : null}
                  </View>

                  <Text style={styles.itemFechaRegistro}>
                    Fecha del préstamo: {fechaRegistroPrestamo}
                    <Text style={styles.textoNormalSinNegrita}>
                      {" "}
                      | Monto total:{" "}
                      {formatearMontoPorMoneda(montoTotalValor, monedaItem)}
                    </Text>
                  </Text>

                  <Text style={styles.itemSub}>
                    Interés: {porcentajeTexto}% | Cuota ({item.frecuencia}):{" "}
                    {formatearMontoPorMoneda(item.valor_cuota, monedaItem)}
                  </Text>

                  <Text style={styles.itemDetalleCuotas}>
                    Cuotas faltantes: {cuotasFaltantes} | Pagado:{" "}
                    {formatearMontoPorMoneda(montoPagadoValor, monedaItem)} |
                    Pendiente:{" "}
                    {formatearMontoPorMoneda(item.saldo_pendiente, monedaItem)}
                  </Text>

                  {proximaFechaCuota ? (
                    <Text style={styles.proximaCuotaTexto}>
                      Próxima cuota programada: {proximaFechaCuota}
                    </Text>
                  ) : null}

                  {alertaMora ? (
                    <Text style={styles.moraLetras}>{alertaMora}</Text>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
        {prestamosFiltrados.length === 0 && (
          <Text style={styles.vacio}>
            {busqueda.trim() || filtroFrecuencia !== "todas"
              ? "No se encontraron préstamos activos con ese filtro."
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
                  Fecha del préstamo:{" "}
                  {obtenerFechaRegistroEfectiva(
                    prestamoSeleccionado,
                    fechaHoyEfectiva,
                  )}
                  <Text style={styles.textoNormalSinNegrita}> </Text>
                </Text>
                <Text style={styles.resumenTexto}>
                  Monto prestado:{" "}
                  {formatearMontoPorMoneda(
                    prestamoSeleccionado.monto_prestado ??
                      prestamoSeleccionado.monto_total,
                    normalizarMoneda(prestamoSeleccionado.moneda),
                  )}
                </Text>
                <Text style={styles.resumenTexto}>
                  Interés:{" "}
                  {formatearPorcentaje(prestamoSeleccionado.interes_porcentaje)}
                  % | Monto total:{" "}
                  {formatearMontoPorMoneda(
                    obtenerMontoTotalEfectivo(prestamoSeleccionado),
                    normalizarMoneda(prestamoSeleccionado.moneda),
                  )}
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
                  Cuotas faltantes:{" "}
                  {calcularCuotasFaltantes(prestamoSeleccionado)}
                </Text>
                {obtenerProximaFechaCuota(
                  prestamoSeleccionado,
                  fechaHoyEfectiva,
                ) ? (
                  <Text style={styles.resumenTexto}>
                    Próxima cuota programada:{" "}
                    {obtenerProximaFechaCuota(
                      prestamoSeleccionado,
                      fechaHoyEfectiva,
                    )}
                  </Text>
                ) : null}
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
  filtrosFrecuenciaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  filtroChip: {
    paddingVertical: 7,
    paddingHorizontal: 13,
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
  filtroChipTextoActivo: {
    color: "#fff",
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
  itemCardMora: {
    borderColor: "#DC2626",
    backgroundColor: "#FFF5F5",
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
  itemFechaRegistro: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 2,
  },
  textoNormalSinNegrita: {
    fontWeight: "400",
    color: "#353638",
  },
  itemSub: { fontSize: 12, color: "#353638", marginTop: 2 },
  itemDetalleCuotas: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1f2733",
    marginTop: 2,
  },
  proximaCuotaTexto: {
    fontSize: 13,
    fontWeight: "600",
    color: "#002897",
    marginTop: 2,
  },
  moraLetras: {
    fontSize: 11,
    fontWeight: "800",
    color: "#DC2626",
    marginTop: 4,
    letterSpacing: 0.3,
  },
  badgePagado: {
    backgroundColor: "#074a1f",
    paddingHorizontal: 9,
    paddingVertical: 4,
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
    paddingHorizontal: 13,
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
    maxWidth: 450,
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
