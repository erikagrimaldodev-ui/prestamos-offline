import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";

const DB_NAME = "prestamos_app.db";

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
