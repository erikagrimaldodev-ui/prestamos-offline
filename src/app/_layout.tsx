import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Drawer } from "expo-router/drawer";
import { usePathname, useRouter } from "expo-router";
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from "@react-navigation/drawer";
import { DrawerActions } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { initDatabase } from "../../database/db";

interface MenuItemConfig {
  label: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const MENU_ITEMS: MenuItemConfig[] = [
  { label: "Resumen General", route: "/caja-gastos", icon: "wallet" },
  {
    label: "Registro de Clientes",
    route: "/registrar-cliente",
    icon: "person-add",
  },
  { label: "Registrar Préstamos", route: "/prestar", icon: "cash" },
  { label: "Registrar Cobros", route: "/", icon: "checkmark-circle" },
  { label: "Renovar Prestamos", route: "/renovar-prestamos", icon: "repeat" },
  { label: "Resumen del Día", route: "/resumen-dia", icon: "wallet" },
  {
    label: "Lista de Préstamos y Pagos",
    route: "/historial",
    icon: "list",
  },
];

interface CustomDrawerContentProps extends DrawerContentComponentProps {
  onBloquearSesion: () => void;
}

function CustomDrawerContent(props: CustomDrawerContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const cerrarMenuSeguro = () => {
    try {
      const state = props.navigation.getState?.();
      const isDrawerOpen =
        state?.type === "drawer" &&
        state?.history?.some(
          (item: { type?: string; status?: string }) =>
            item.type === "drawer" && item.status === "open",
        );
      if (isDrawerOpen) {
        props.navigation.dispatch(DrawerActions.closeDrawer());
      } else if (typeof props.navigation.closeDrawer === "function") {
        props.navigation.closeDrawer();
      }
    } catch {
      // Evita que un despacho tardío rompa el flujo si el drawer ya cerró
    }
  };

  const navegarA = (route: string) => {
    cerrarMenuSeguro();
    router.push(route as never);
  };

  const handleCerrarSesion = () => {
    cerrarMenuSeguro();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      props.onBloquearSesion();
    }, 80);
  };

  return (
    <View style={drawerStyles.container}>
      <View style={drawerStyles.header}>
        <View style={drawerStyles.avatar}>
          <Ionicons name="wallet-outline" size={22} color="#FFFFFF" />
        </View>
        <View>
          <Text style={drawerStyles.appTitle}>Gestión de Préstamos</Text>
          <Text style={drawerStyles.appSubtitle}>
            Control de prestamos, cobros y gastos
          </Text>
        </View>
      </View>

      <DrawerContentScrollView
        {...props}
        contentContainerStyle={drawerStyles.scrollContent}
      >
        {MENU_ITEMS.map((item) => {
          const isActive =
            item.route === "/"
              ? pathname === "/" || pathname === "/index"
              : pathname === item.route;

          return (
            <TouchableOpacity
              key={item.route}
              style={[
                drawerStyles.menuItem,
                isActive && drawerStyles.menuItemActive,
              ]}
              onPress={() => navegarA(item.route)}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={isActive ? "#0F172A" : "#334155"}
              />
              <Text
                style={[
                  drawerStyles.menuItemText,
                  isActive && drawerStyles.menuItemTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </DrawerContentScrollView>

      <View style={drawerStyles.footer}>
        <TouchableOpacity
          style={drawerStyles.dbBtn}
          onPress={() => navegarA("/base-datos")}
        >
          <Ionicons name="trash-outline" size={18} color="#B91C1C" />
          <Text style={drawerStyles.dbBtnText}>
            Eliminar Registros de Base de Datos
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={drawerStyles.logoutBtn}
          onPress={handleCerrarSesion}
        >
          <Ionicons name="log-out-outline" size={19} color="#FFFFFF" />
          <Text style={drawerStyles.logoutBtnText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [desbloqueado, setDesbloqueado] = useState(Platform.OS === "web");
  const [verificandoAcceso, setVerificandoAcceso] = useState(false);
  const [avisoAcceso, setAvisoAcceso] = useState("");

  useEffect(() => {
    initDatabase().catch((err) => console.error("Error iniciando BD:", err));
  }, []);

  const solicitarDesbloqueo = useCallback(async () => {
    if (Platform.OS === "web") {
      setDesbloqueado(true);
      return;
    }

    setAvisoAcceso("");
    setVerificandoAcceso(true);

    try {
      const nivelSeguridad = await LocalAuthentication.getEnrolledLevelAsync();

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
      } else if (resultado.error === "not_enrolled") {
        setDesbloqueado(true);
      } else if (resultado.error === "user_cancel") {
        setAvisoAcceso(
          "Acceso cancelado. Toca el botón para verificar tu seguridad.",
        );
      } else {
        setAvisoAcceso("No se pudo verificar el acceso. Intenta nuevamente.");
      }
    } catch {
      setAvisoAcceso(
        "No se pudo abrir la verificación de seguridad. Toca reintentar.",
      );
    } finally {
      setVerificandoAcceso(false);
    }
  }, []);

  useEffect(() => {
    if (!desbloqueado) {
      void solicitarDesbloqueo();
    }
  }, [desbloqueado, solicitarDesbloqueo]);

  const bloquearSesion = useCallback(() => {
    setAvisoAcceso("");
    setDesbloqueado(false);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View
        style={{ flex: 1, display: desbloqueado ? "flex" : "none" }}
        pointerEvents={desbloqueado ? "auto" : "none"}
      >
        <Drawer
          initialRouteName="index"
          drawerContent={(props) => (
            <CustomDrawerContent {...props} onBloquearSesion={bloquearSesion} />
          )}
          screenOptions={{
            headerStyle: { backgroundColor: "#0F172A" },
            headerTintColor: "#FFFFFF",
            headerTitleStyle: { fontWeight: "700", fontSize: 16 },
          }}
        >
          <Drawer.Screen name="index" options={{ title: "Registrar Pago" }} />
          <Drawer.Screen
            name="registrar-pago"
            options={{ title: "Registrar Pago" }}
          />
          <Drawer.Screen
            name="prestar"
            options={{
              title: "Realizar Préstamos | Lista de clientes (A-Z)",
            }}
          />
          <Drawer.Screen
            name="renovar-prestamos"
            options={{ title: "Renovar prestamo" }}
          />
          <Drawer.Screen
            name="registrar-cliente"
            options={{ title: "Registro de Clientes" }}
          />
          <Drawer.Screen
            name="historial"
            options={{ title: "Lista de Préstamos y Pagos" }}
          />
          <Drawer.Screen
            name="resumen-dia"
            options={{ title: "Caja y Gastos Diarios" }}
          />
          <Drawer.Screen
            name="caja-gastos"
            options={{ title: "Caja y Gastos" }}
          />
          <Drawer.Screen
            name="base-datos"
            options={{ title: "Administración de Base de Datos" }}
          />
        </Drawer>
      </View>

      {!desbloqueado ? (
        <View style={lockStyles.container}>
          <View style={lockStyles.card}>
            <View style={lockStyles.iconCircle}>
              <Ionicons name="lock-closed" size={28} color="#FFFFFF" />
            </View>
            <Text style={lockStyles.titulo}>Desbloquear Sistema</Text>
            <Text style={lockStyles.subtitulo}>
              Usa tu huella, patrón, PIN o contraseña del teléfono para abrir la
              aplicación.
            </Text>

            <TouchableOpacity
              style={lockStyles.btn}
              onPress={() => void solicitarDesbloqueo()}
              disabled={verificandoAcceso}
            >
              <Text style={lockStyles.btnTexto}>
                {verificandoAcceso ? "Verificando..." : "Desbloquear ahora"}
              </Text>
            </TouchableOpacity>

            {avisoAcceso ? (
              <Text style={lockStyles.aviso}>{avisoAcceso}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
}

const lockStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    elevation: 2,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  titulo: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 6,
  },
  subtitulo: {
    fontSize: 13,
    color: "#475569",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 18,
  },
  btn: {
    width: "100%",
    backgroundColor: "#0F172A",
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
  },
  btnTexto: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  aviso: {
    marginTop: 12,
    color: "#DC2626",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
});

const drawerStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    backgroundColor: "#0F172A",
    paddingTop: 44,
    paddingBottom: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#1E293B",
    justifyContent: "center",
    alignItems: "center",
  },
  appTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  appSubtitle: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  scrollContent: {
    paddingTop: 10,
    paddingHorizontal: 10,
    gap: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  menuItemActive: {
    backgroundColor: "#E2E8F0",
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
  },
  menuItemTextActive: {
    color: "#0F172A",
    fontWeight: "700",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    padding: 12,
    gap: 8,
    backgroundColor: "#FFFFFF",
  },
  dbBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  dbBtnText: {
    flex: 1,
    color: "#B91C1C",
    fontSize: 12,
    fontWeight: "700",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#0F172A",
  },
  logoutBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
