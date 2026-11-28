import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";

const DB_NAME = "prestamos_app.db";

export type MonedaDB = "COP" | "USD";

export interface RenovarPrestamoInput {
  prestamoAnteriorId: number;
  excedenteEntregado: number;
  nuevoMontoPrestado: number;
  interesPorcentaje: number;
  frecuencia: string;
  cantidadCuotas: number;
  fechaCreacion: string;
  moneda?: MonedaDB;
  nota?: string;
}

interface PrestamoRenovacionRow {
  id: number;
  cliente_id: number;
  saldo_pendiente: number;
  moneda?: string | null;
}

const SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    cedula TEXT,
    telefono TEXT,
    direccion TEXT
  );

  CREATE TABLE IF NOT EXISTS prestamos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    monto_prestado REAL NOT NULL,
    interes_porcentaje REAL NOT NULL,
    frecuencia TEXT NOT NULL,
    cantidad_cuotas INTEGER NOT NULL,
    monto_total REAL NOT NULL,
    valor_cuota REAL NOT NULL,
    saldo_pendiente REAL NOT NULL,
    fecha_creacion TEXT NOT NULL,
    estado TEXT DEFAULT 'activo',
    moneda TEXT DEFAULT 'COP',
    FOREIGN KEY (cliente_id) REFERENCES clientes (id)
  );

  CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prestamo_id INTEGER NOT NULL,
    cliente_id INTEGER NOT NULL,
    monto_pagado REAL NOT NULL,
    fecha_pago TEXT NOT NULL,
    fecha_registro_local TEXT,
    FOREIGN KEY (prestamo_id) REFERENCES prestamos (id),
    FOREIGN KEY (cliente_id) REFERENCES clientes (id)
  );

  CREATE TABLE IF NOT EXISTS movimientos_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    monto REAL NOT NULL,
    fecha TEXT NOT NULL,
    moneda TEXT DEFAULT 'COP'
  );

  CREATE TABLE IF NOT EXISTS renovaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prestamo_anterior_id INTEGER NOT NULL,
    prestamo_nuevo_id INTEGER NOT NULL,
    cliente_id INTEGER NOT NULL,
    saldo_anterior REAL NOT NULL DEFAULT 0,
    excedente_entregado REAL NOT NULL DEFAULT 0,
    nuevo_monto_prestado REAL NOT NULL,
    fecha TEXT NOT NULL,
    moneda TEXT DEFAULT 'COP',
    nota TEXT,
    FOREIGN KEY (prestamo_anterior_id) REFERENCES prestamos (id),
    FOREIGN KEY (prestamo_nuevo_id) REFERENCES prestamos (id),
    FOREIGN KEY (cliente_id) REFERENCES clientes (id)
  );
`;

let nativeDb: SQLite.SQLiteDatabase | null = null;
let webDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initialized = false;

const aplicarMigraciones = async (
  database: SQLite.SQLiteDatabase,
  isWeb: boolean,
): Promise<void> => {
  const migraciones = [
    "ALTER TABLE pagos ADD COLUMN fecha_registro_local TEXT;",
    "ALTER TABLE prestamos ADD COLUMN moneda TEXT DEFAULT 'COP';",
    "ALTER TABLE movimientos_caja ADD COLUMN moneda TEXT DEFAULT 'COP';",
  ];

  for (const sql of migraciones) {
    try {
      if (isWeb) {
        await database.execAsync(sql);
      } else {
        database.execSync(sql);
      }
    } catch {
      // La columna ya existe
    }
  }
};

export const getDbSync = (): SQLite.SQLiteDatabase => {
  if (!nativeDb) {
    nativeDb = SQLite.openDatabaseSync(DB_NAME);
  }
  return nativeDb;
};

export const db =
  Platform.OS === "web" ? ({} as SQLite.SQLiteDatabase) : getDbSync();

export const initDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  if (Platform.OS === "web") {
    if (!webDbPromise) {
      webDbPromise = (async () => {
        const database = await SQLite.openDatabaseAsync(DB_NAME);
        await database.execAsync(SCHEMA_SQL);
        await aplicarMigraciones(database, true);
        initialized = true;
        return database;
      })();
    }
    return webDbPromise;
  }

  const database = getDbSync();
  if (!initialized) {
    database.execSync(SCHEMA_SQL);
    await aplicarMigraciones(database, false);
    initialized = true;
  }
  return database;
};

export const runQuery = async (
  sql: string,
  params: SQLite.SQLiteBindValue[] = [],
): Promise<void> => {
  const database = await initDatabase();
  if (Platform.OS === "web") {
    await database.runAsync(sql, params);
    return;
  }
  database.runSync(sql, params);
};

export const runTransaction = async (
  callback: () => Promise<void> | void,
): Promise<void> => {
  const database = await initDatabase();
  if (Platform.OS === "web") {
    await database.withTransactionAsync(async () => {
      await callback();
    });
    return;
  }
  database.execSync("BEGIN TRANSACTION;");
  try {
    await callback();
    database.execSync("COMMIT;");
  } catch (error) {
    try {
      database.execSync("ROLLBACK;");
    } catch {
      // Ignorar error secundario de rollback
    }
    throw error;
  }
};

export const getAllRows = async <T>(
  sql: string,
  params: SQLite.SQLiteBindValue[] = [],
): Promise<T[]> => {
  const database = await initDatabase();
  if (Platform.OS === "web") {
    return database.getAllAsync<T>(sql, params);
  }
  return database.getAllSync<T>(sql, params);
};

export const getFirstRow = async <T>(
  sql: string,
  params: SQLite.SQLiteBindValue[] = [],
): Promise<T | null> => {
  const database = await initDatabase();
  if (Platform.OS === "web") {
    return database.getFirstAsync<T>(sql, params);
  }
  return database.getFirstSync<T>(sql, params);
};

export const renovarPrestamo = async (
  input: RenovarPrestamoInput,
): Promise<{ prestamoNuevoId: number }> => {
  const anterior = await getFirstRow<PrestamoRenovacionRow>(
    `SELECT id, cliente_id, saldo_pendiente, moneda
     FROM prestamos
     WHERE id = ?`,
    [input.prestamoAnteriorId],
  );

  if (!anterior) {
    throw new Error("No se encontró el préstamo a renovar.");
  }

  const excedente = Math.max(0, Number(input.excedenteEntregado || 0));
  const nuevoCapital = Number(input.nuevoMontoPrestado || 0);
  const interes = Number(input.interesPorcentaje || 0);
  const cuotas = Math.max(1, Math.floor(Number(input.cantidadCuotas || 1)));

  if (Number.isNaN(nuevoCapital) || nuevoCapital <= 0) {
    throw new Error("El nuevo monto prestado debe ser mayor a 0.");
  }

  const monedaFinal: MonedaDB =
    input.moneda ||
    ((anterior.moneda || "").trim().toUpperCase() === "USD" ? "USD" : "COP");

  const saldoAnterior = Math.max(0, Number(anterior.saldo_pendiente || 0));
  const montoTotal = nuevoCapital + nuevoCapital * (interes / 100);
  const valorCuota = montoTotal / cuotas;

  let prestamoNuevoId = 0;

  await runTransaction(async () => {
    // 1. Cerrar préstamo anterior para que su saldo pendiente viejo no duplique cartera
    await runQuery(
      `UPDATE prestamos
       SET saldo_pendiente = 0, estado = 'renovado'
       WHERE id = ?`,
      [anterior.id],
    );

    // 2. Crear el préstamo renovado con el nuevo capital
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
        anterior.cliente_id,
        nuevoCapital,
        interes,
        input.frecuencia,
        cuotas,
        montoTotal,
        valorCuota,
        montoTotal,
        input.fechaCreacion,
        monedaFinal,
      ],
    );

    const filaUltimo = await getFirstRow<{ id: number }>(
      `SELECT last_insert_rowid() AS id`,
    );
    prestamoNuevoId = Number(filaUltimo?.id || 0);

    // 3. Registrar historial de renovación
    await runQuery(
      `INSERT INTO renovaciones (
        prestamo_anterior_id,
        prestamo_nuevo_id,
        cliente_id,
        saldo_anterior,
        excedente_entregado,
        nuevo_monto_prestado,
        fecha,
        moneda,
        nota
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        anterior.id,
        prestamoNuevoId,
        anterior.cliente_id,
        saldoAnterior,
        excedente,
        nuevoCapital,
        input.fechaCreacion,
        monedaFinal,
        input.nota || null,
      ],
    );

    // 4. Si se entregó excedente en efectivo al cliente, restarlo de caja como 'renovacion' (no 'gasto')
    if (excedente > 0) {
      await runQuery(
        `INSERT INTO movimientos_caja (tipo, descripcion, monto, fecha, moneda)
         VALUES ('renovacion', ?, ?, ?, ?)`,
        [
          `Renovación préstamo #${anterior.id} -> #${prestamoNuevoId} (${monedaFinal})`,
          excedente,
          input.fechaCreacion,
          monedaFinal,
        ],
      );
    }
  });

  return { prestamoNuevoId };
};
