import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createJSONStorage, type StateStorage } from "zustand/middleware";

/** Plain persisted state (draft id, UI prefs). */
export const asyncJsonStorage = createJSONStorage(() => AsyncStorage);

/** Credentials. expo-secure-store is native-only, so web falls back to AsyncStorage. */
const secure: StateStorage = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
};
export const secureJsonStorage = createJSONStorage(() => (Platform.OS === "web" ? AsyncStorage : secure));
