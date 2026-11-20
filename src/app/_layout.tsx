import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Drawer } from "expo-router/drawer";
import { Ionicons } from "@expo/vector-icons";
import { initDatabase } from "../../database/db";

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    let active = true;
    initDatabase()
      .catch((err) => console.error("Error iniciando BD:", err))
      .finally(() => {
        if (active) setDbReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!dbReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#0F172A" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        screenOptions={{
          headerStyle: { backgroundColor: "#1E293B" },
          headerTintColor: "#fff",
          drawerActiveTintColor: "#0F172A",
        }}
      >
        <Drawer.Screen
          name="registrar-pago"
          options={{
            drawerLabel: "Registrar Cobros",
            title: "Registrar Pago",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="checkmark-circle" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="prestar"
          options={{
            drawerLabel: "Registrar Préstamos",
            title: "Realizar Préstamos | Lista de clientes (A-Z)",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="cash" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="renovar-prestamos"
          options={{
            drawerLabel: "Renovar Prestamos",
            title: "Renovar prestamo",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="list" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="index"
          options={{
            drawerLabel: "Registro de Clientes",
            title: "Registro de Clientes",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="person-add" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="historial"
          options={{
            drawerLabel: "Lista de Préstamos y Pagos",
            title: "Lista de Préstamos y Pagos",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="list" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="caja-gastos"
          options={{
            drawerLabel: "Caja y Gastos",
            title: "Caja y Gastos Diarios",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="wallet" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="base-datos"
          options={{
            drawerLabel: "Eliminar Registros de Base la de Datos ",
            title: "Administración de Base de Datos",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="trash" size={size} color={color} />
            ),
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}
