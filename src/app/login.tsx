import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

interface BloqueoDispositivoProps {
  children: React.ReactNode;
}

export default function BloqueoDispositivo({
  children,
}: BloqueoDispositivoProps) {
  const [desbloqueado, setDesbloqueado] = useState(Platform.OS === "web");
  const [mensaje, setMensaje] = useState("");
  const [verificando, setVerificando] = useState(false);

  const solicitarAcceso = useCallback(async () => {
    if (Platform.OS === "web") {
      setDesbloqueado(true);
      return;
    }

    setMensaje("");
    setVerificando(true);

    try {
      const nivelSeguridad = await LocalAuthentication.getEnrolledLevelAsync();

      // Si el móvil no tiene ni huella, ni patrón, ni PIN, ni contraseña:
      // no lo dejes atrapado; abre la app y avisa de forma segura.
      if (nivelSeguridad === LocalAuthentication.SecurityLevel.NONE) {
        setDesbloqueado(true);
        return;
      }

      const resultado = await LocalAuthentication.authenticateAsync({
        promptMessage: "Desbloquea con tu huella, patrón, PIN o contraseña",
        cancelLabel: "Cancelar",
        fallbackLabel: "Usar patrón / PIN / contraseña",
        disableDeviceFallback: false,
      });

      if (resultado.success) {
        setDesbloqueado(true);
      } else if (resultado.error === "user_cancel") {
        setMensaje(
          "Autenticación cancelada. Toca el botón para intentar de nuevo.",
        );
      } else if (resultado.error === "not_enrolled") {
        // Por seguridad, si el sistema reporta que no hay método enrolado, deja pasar
        setDesbloqueado(true);
      } else {
        setMensaje("No se pudo verificar el acceso. Intenta nuevamente.");
      }
    } catch {
      // Ante cualquier error nativo inesperado en algún equipo, evita romper la app
      setMensaje(
        "No se pudo abrir la verificación de seguridad. Toca reintentar.",
      );
    } finally {
      setVerificando(false);
    }
  }, []);

  useEffect(() => {
    if (!desbloqueado) {
      void solicitarAcceso();
    }
  }, [desbloqueado, solicitarAcceso]);

  if (desbloqueado) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Desbloquear Sistema</Text>
      <Text style={styles.subtitulo}>
        Usa tu huella, patrón, PIN o contraseña del teléfono para abrir la
        aplicación.
      </Text>

      <TouchableOpacity
        style={styles.btn}
        onPress={() => void solicitarAcceso()}
        disabled={verificando}
      >
        <Text style={styles.btnTexto}>
          {verificando ? "Verificando..." : "Desbloquear ahora"}
        </Text>
      </TouchableOpacity>

      {mensaje ? <Text style={styles.aviso}>{mensaje}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  titulo: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 8,
  },
  subtitulo: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    marginBottom: 20,
    maxWidth: 340,
  },
  btn: {
    backgroundColor: "#0F172A",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
  },
  btnTexto: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  aviso: {
    marginTop: 14,
    color: "#DC2626",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    maxWidth: 340,
  },
});
