import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { runQuery } from "../../database/db";

export default function BaseDatosScreen() {
  const [modalVisible, setModalVisible] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [estadoAviso, setEstadoAviso] = useState<{
    tipo: "exito" | "error";
    mensaje: string;
  } | null>(null);

  const ejecutarEliminacionCompleta = async () => {
    setEliminando(true);
    setEstadoAviso(null);
    try {
      await runQuery("DELETE FROM pagos");
      await runQuery("DELETE FROM prestamos");
      await runQuery("DELETE FROM movimientos_caja");
      await runQuery("DELETE FROM clientes");

      try {
        await runQuery(
          "DELETE FROM sqlite_sequence WHERE name IN ('pagos', 'prestamos', 'movimientos_caja', 'clientes')",
        );
      } catch {
        // Ignorar si no existe sqlite_sequence
      }

      setModalVisible(false);
      setEstadoAviso({
        tipo: "exito",
        mensaje:
          "Base de datos eliminada por completo. El dispositivo está listo para usarse desde cero.",
      });
    } catch (error: any) {
      setModalVisible(false);
      setEstadoAviso({
        tipo: "error",
        mensaje: `No se pudo eliminar la base de datos: ${error?.message || "error inesperado"}`,
      });
    } finally {
      setEliminando(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Limpiar Base de Datos Local</Text>
      <Text style={styles.descripcion}>
        Elimina todos los clientes, préstamos, pagos y movimientos de caja
        guardados en este teléfono. Ideal antes de entregar o configurar otro
        equipo.
      </Text>

      {estadoAviso ? (
        <View
          style={[
            styles.aviso,
            estadoAviso.tipo === "exito"
              ? styles.avisoExito
              : styles.avisoError,
          ]}
        >
          <Text
            style={[
              styles.avisoTexto,
              estadoAviso.tipo === "exito"
                ? styles.textoExito
                : styles.textoError,
            ]}
          >
            {estadoAviso.mensaje}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.btnPeligro}
        onPress={() => {
          setEstadoAviso(null);
          setModalVisible(true);
        }}
      >
        <Text style={styles.btnPeligroTexto}>
          Eliminar base de datos completa
        </Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !eliminando && setModalVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>
              ¿Eliminar toda la base de datos?
            </Text>
            <Text style={styles.modalTexto}>
              Se borrarán permanentemente todos los registros de este teléfono.
              Esta acción no se puede deshacer.
            </Text>

            <View style={styles.modalBotones}>
              <TouchableOpacity
                style={styles.btnCancelar}
                disabled={eliminando}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.btnCancelarTexto}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnConfirmar}
                disabled={eliminando}
                onPress={() => void ejecutarEliminacionCompleta()}
              >
                <Text style={styles.btnConfirmarTexto}>
                  {eliminando ? "Eliminando..." : "Sí, eliminar todo"}
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
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#F8FAFC",
  },
  titulo: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 8,
  },
  descripcion: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 20,
    marginBottom: 20,
  },
  btnPeligro: {
    backgroundColor: "#DC2626",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  btnPeligroTexto: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  aviso: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  avisoExito: {
    backgroundColor: "#DCFCE7",
    borderColor: "#16A34A",
  },
  avisoError: {
    backgroundColor: "#FEF2F2",
    borderColor: "#DC2626",
  },
  avisoTexto: {
    fontSize: 13,
    fontWeight: "700",
  },
  textoExito: {
    color: "#14532D",
  },
  textoError: {
    color: "#DC2626",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 20,
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
    flexDirection: "row",
    gap: 10,
  },
  btnCancelar: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
  },
  btnCancelarTexto: {
    color: "#334155",
    fontWeight: "700",
  },
  btnConfirmar: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
  },
  btnConfirmarTexto: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
