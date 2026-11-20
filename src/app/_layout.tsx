import { useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
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
import { initDatabase } from "../../database/db";

interface MenuItemConfig {
  label: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const MENU_ITEMS: MenuItemConfig[] = [
  { label: "Registrar Cobros", route: "/", icon: "checkmark-circle" },
  { label: "Registrar Préstamos", route: "/prestar", icon: "cash" },
  { label: "Renovar Prestamos", route: "/renovar-prestamos", icon: "repeat" },
  {
    label: "Registro de Clientes",
    route: "/registrar-cliente",
    icon: "person-add",
  },
  {
    label: "Lista de Préstamos y Pagos",
    route: "/historial",
    icon: "list",
  },
  { label: "Caja y Gastos", route: "/caja-gastos", icon: "wallet" },
];

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();

  const navegarA = (route: string) => {
    props.navigation.dispatch(DrawerActions.closeDrawer());
    router.push(route as never);
  };

  const handleSalirApp = () => {
    props.navigation.dispatch(DrawerActions.closeDrawer());
    if (Platform.OS === "android") {
      BackHandler.exitApp();
    } else if (Platform.OS === "web" && typeof window !== "undefined") {
      window.close();
    } else {
      BackHandler.exitApp();
    }
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
          onPress={handleSalirApp}
        >
          <Ionicons name="log-out-outline" size={19} color="#FFFFFF" />
          <Text style={drawerStyles.logoutBtnText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    initDatabase().catch((err) => console.error("Error iniciando BD:", err));
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        initialRouteName="index"
        drawerContent={(props) => <CustomDrawerContent {...props} />}
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
          name="caja-gastos"
          options={{ title: "Caja y Gastos Diarios" }}
        />
        <Drawer.Screen
          name="base-datos"
          options={{ title: "Administración de Base de Datos" }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}

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
