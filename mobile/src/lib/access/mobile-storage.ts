import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const memoryStore = new Map<string, string>();

export async function getMobileStorageItem(key: string): Promise<string | null> {
  if (Platform.OS !== "web") {
    return SecureStore.getItemAsync(key);
  }
  return webStorage()?.getItem(key) ?? memoryStore.get(key) ?? null;
}

export async function setMobileStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS !== "web") {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const storage = webStorage();
  if (storage) {
    storage.setItem(key, value);
    return;
  }
  memoryStore.set(key, value);
}

export async function deleteMobileStorageItem(key: string): Promise<void> {
  if (Platform.OS !== "web") {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  webStorage()?.removeItem(key);
  memoryStore.delete(key);
}

interface WebStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function webStorage(): WebStorage | null {
  if (!isLocalWebHost()) {
    return null;
  }
  const candidate =
    (typeof window !== "undefined" ? window.localStorage : undefined)
    ?? (
      typeof globalThis !== "undefined"
        ? (globalThis as { localStorage?: WebStorage }).localStorage
        : undefined
    );
  if (!candidate) {
    return null;
  }
  try {
    const probeKey = "proliferate.mobile.storage.probe";
    candidate.setItem(probeKey, "1");
    candidate.removeItem(probeKey);
    return candidate;
  } catch {
    return null;
  }
}

function isLocalWebHost(): boolean {
  if (Platform.OS !== "web") {
    return false;
  }
  const hostname =
    (typeof window !== "undefined" ? window.location?.hostname : undefined)
    ?? (
      typeof globalThis !== "undefined"
        ? (globalThis as { location?: { hostname?: string } }).location?.hostname
        : undefined
    );
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
