import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { getAllRows, getFirstRow, runQuery } from "../../database/db";

interface Cliente {
  id: number;
  nombre: string;
  telefono: string | null;
  direccion: string | null;
}

export default function RegistroClientesScreen() {
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteAEliminar, setClienteAEliminar] = useState<Cliente | null>(
    null,
  );
  const [mensaje, setMensaje] = useState<{
    tipo: "error" | "exito";
    texto: string;
  } | null>(null);

  const cargarClientes = useCallback(async () => {
    const rows = await getAllRows<Cliente>(
      "SELECT * FROM clientes ORDER BY nombre ASC",
    );
    setClientes(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargarClientes();
    }, [cargarClientes]),
  );

  const handleTelefonoChange = (text: string) => {
    setTelefono(text.replace(/[^0-9]/g, ""));
  };

  const limpiarFormulario = () => {
    setEditandoId(null);
    setNombre("");
    setTelefono("");
    setDireccion("");
  };

  const iniciarEdicion = (cliente: Cliente) => {
    setMensaje(null);
    setEditandoId(cliente.id);
    setNombre(cliente.nombre);
    setTelefono(cliente.telefono || "");
    setDireccion(cliente.direccion || "");
  };

  const guardarCliente = async () => {
    setMensaje(null);
    const nombreLimpio = nombre.trim();
    const telefonoLimpio = telefono.trim();
    const direccionLimpia = direccion.trim();

    if (!nombreLimpio) {
      setMensaje({
        tipo: "error",
        texto: "Ingresa el nombre completo del cliente.",
      });
      return;
    }

    if (telefonoLimpio.length < 7 || telefonoLimpio.length > 12) {
      setMensaje({
        tipo: "error",
        texto: "El teléfono debe tener entre 7 y 12 dígitos numéricos.",
      });
      return;
    }

    try {
      if (editandoId !== null) {
        await runQuery(
          `UPDATE clientes
           SET nombre = ?, telefono = ?, direccion = ?
           WHERE id = ?`,
          [nombreLimpio, telefonoLimpio, direccionLimpia || null, editandoId],
        );
        limpiarFormulario();
        await cargarClientes();
        setMensaje({
          tipo: "exito",
          texto: "Cliente actualizado correctamente.",
        });
      } else {
        await runQuery(
          `INSERT INTO clientes (nombre, telefono, direccion)
           VALUES (?, ?, ?)`,
          [nombreLimpio, telefonoLimpio, direccionLimpia || null],
        );
        limpiarFormulario();
        await cargarClientes();
        setMensaje({
          tipo: "exito",
          texto: "Cliente registrado correctamente.",
        });
      }
    } catch (error: any) {
      setMensaje({
        tipo: "error",
        texto: `Error al guardar: ${error?.message || "error en base de datos"}`,
      });
    }
  };

  const solicitarEliminarCliente = async (cliente: Cliente) => {
    setMensaje(null);
    try {
      const prestamosActivos = await getFirstRow<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM prestamos
         WHERE cliente_id = ?
           AND (saldo_pendiente > 0 OR LOWER(estado) = 'activo')`,
        [cliente.id],
      );

      if ((prestamosActivos?.total ?? 0) > 0) {
        setMensaje({
          tipo: "error",
          texto: `No se puede eliminar a "${cliente.nombre}" porque tiene préstamos activos pendientes.`,
        });
        return;
      }

      setClienteAEliminar(cliente);
    } catch (error: any) {
      setMensaje({
        tipo: "error",
        texto: `Error al verificar préstamos: ${error?.message || "error"}`,
      });
    }
  };

  const confirmarEliminarCliente = async () => {
    if (!clienteAEliminar) return;
    const objetivo = clienteAEliminar;
    setMensaje(null);

    try {
      // Verifica nuevamente antes de eliminar por si cambió el estado
      const prestamosActivos = await getFirstRow<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM prestamos
         WHERE cliente_id = ?
           AND (saldo_pendiente > 0 OR LOWER(estado) = 'activo')`,
        [objetivo.id],
      );

      if ((prestamosActivos?.total ?? 0) > 0) {
        setClienteAEliminar(null);
        setMensaje({
          tipo: "error",
          texto: `No se puede eliminar a "${objetivo.nombre}" porque tiene préstamos activos.`,
        });
        return;
      }

      // Si ya pagó sus préstamos, elimina pagos y préstamos liquidados del cliente antes de borrarlo
      await runQuery("DELETE FROM pagos WHERE cliente_id = ?", [objetivo.id]);
      await runQuery("DELETE FROM prestamos WHERE cliente_id = ?", [
        objetivo.id,
      ]);
      await runQuery("DELETE FROM clientes WHERE id = ?", [objetivo.id]);

      if (editandoId === objetivo.id) {
        limpiarFormulario();
      }
      setClienteAEliminar(null);
      await cargarClientes();
      setMensaje({
        tipo: "exito",
        texto: `Cliente "${objetivo.nombre}" eliminado correctamente.`,
      });
    } catch (error: any) {
      setClienteAEliminar(null);
      setMensaje({
        tipo: "error",
        texto: `Error al eliminar: ${error?.message || "error en base de datos"}`,
      });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.formCard}>
        <Text style={styles.titulo}>
          {editandoId !== null ? "Editar Cliente" : "Registrar Nuevo Cliente"}
        </Text>

        <Text style={styles.label}>Nombre y Apellido *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Carlos Pérez"
          value={nombre}
          onChangeText={setNombre}
        />

        <Text style={styles.label}>Teléfono (solo números) *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: 04141234567"
          keyboardType="phone-pad"
          maxLength={12}
          value={telefono}
          onChangeText={handleTelefonoChange}
        />

        <Text style={styles.label}>Dirección</Text>
        <TextInput
          style={styles.input}
          placeholder="Sector, calle o referencia"
          value={direccion}
          onChangeText={setDireccion}
        />

        <TouchableOpacity style={styles.btnGuardar} onPress={guardarCliente}>
          <Text style={styles.btnTexto}>
            {editandoId !== null ? "Guardar Cambios" : "Guardar Cliente"}
          </Text>
        </TouchableOpacity>

        {editandoId !== null ? (
          <TouchableOpacity
            style={styles.btnCancelarEdicion}
            onPress={limpiarFormulario}
          >
            <Text style={styles.btnCancelarTexto}>Cancelar edición</Text>
          </TouchableOpacity>
        ) : null}

        {mensaje ? (
          <Text
            style={[
              styles.mensajeTexto,
              { color: mensaje.tipo === "exito" ? "#16A34A" : "#DC2626" },
            ]}
          >
            {mensaje.texto}
          </Text>
        ) : null}
      </View>

      <Text style={styles.subtitulo}>
        Clientes registrados ({clientes.length})
      </Text>

      <FlatList
        data={clientes}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.clienteCard,
              editandoId === item.id && styles.clienteCardEditando,
            ]}
            onPress={() => iniciarEdicion(item)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.clienteNombre}>{item.nombre}</Text>
              <View style={styles.accionesRow}>
                <TouchableOpacity
                  onPress={() => iniciarEdicion(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.accionEditar}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => solicitarEliminarCliente(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.accionEliminar}>Eliminar</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.clienteDato}>
              Tel: {item.telefono || "N/A"}
            </Text>
            {item.direccion ? (
              <Text style={styles.clienteDireccion}>{item.direccion}</Text>
            ) : null}
          </TouchableOpacity>
        )}
      />

      <Modal
        visible={clienteAEliminar !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setClienteAEliminar(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitulo}>¿Eliminar cliente?</Text>
            <Text style={styles.modalTexto}>
              Se eliminará a &quot;{clienteAEliminar?.nombre}&quot; junto con el
              historial de préstamos y pagos ya saldados asociados a este
              cliente.
            </Text>
            <View style={styles.modalBotones}>
              <TouchableOpacity
                style={styles.btnModalCancelar}
                onPress={() => setClienteAEliminar(null)}
              >
                <Text style={styles.btnModalCancelarTexto}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnModalConfirmar}
                onPress={confirmarEliminarCliente}
              >
                <Text style={styles.btnModalConfirmarTexto}>
                  Confirmar eliminar
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#F8FAFC" },
  formCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 10,
    elevation: 2,
    marginBottom: 14,
  },
  titulo: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 6,
  },
  label: { fontSize: 13, fontWeight: "600", color: "#334155", marginTop: 10 },
  input: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    fontSize: 15,
  },
  btnGuardar: {
    backgroundColor: "#0F172A",
    padding: 13,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 14,
  },
  btnTexto: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  btnCancelarEdicion: { padding: 10, alignItems: "center", marginTop: 6 },
  btnCancelarTexto: { color: "#64748B", fontSize: 13, fontWeight: "600" },
  mensajeTexto: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  subtitulo: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#1E293B",
    marginBottom: 8,
  },
  clienteCard: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  clienteCardEditando: { borderColor: "#0F172A", backgroundColor: "#F1F5F9" },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  accionesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  clienteNombre: { fontSize: 15, fontWeight: "bold", color: "#0F172A" },
  accionEditar: { fontSize: 13, fontWeight: "600", color: "#1E3A8A" },
  accionEliminar: { fontSize: 13, fontWeight: "600", color: "#DC2626" },
  clienteDato: { fontSize: 13, color: "#475569", marginTop: 2 },
  clienteDireccion: { fontSize: 12, color: "#64748B", marginTop: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    elevation: 5,
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
    gap: 10,
  },
  btnModalCancelar: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
  },
  btnModalCancelarTexto: {
    color: "#334155",
    fontWeight: "700",
    fontSize: 14,
  },
  btnModalConfirmar: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
  },
  btnModalConfirmarTexto: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
