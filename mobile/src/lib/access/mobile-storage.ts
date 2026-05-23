import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const memoryStore = new Map<string, string>();
const APP_STORAGE_DIR = "proliferate-mobile-storage";

export async function getMobileStorageItem(key: string): Promise<string | null> {
  if (Platform.OS !== "web") {
    return readNativeFileStorageItem(key);
  }
  return webStorage()?.getItem(key) ?? memoryStore.get(key) ?? null;
}

export async function setMobileStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS !== "web") {
    await writeNativeFileStorageItem(key, value);
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
    await deleteNativeFileStorageItem(key);
    return;
  }
  webStorage()?.removeItem(key);
  memoryStore.delete(key);
}

export async function getSecureMobileStorageItem(key: string): Promise<string | null> {
  if (Platform.OS !== "web") {
    return SecureStore.getItemAsync(key);
  }
  return getMobileStorageItem(key);
}

export async function setSecureMobileStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS !== "web") {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  await setMobileStorageItem(key, value);
}

export async function deleteSecureMobileStorageItem(key: string): Promise<void> {
  if (Platform.OS !== "web") {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await deleteMobileStorageItem(key);
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

async function readNativeFileStorageItem(key: string): Promise<string | null> {
  const uri = nativeFileStorageUri(key);
  if (!uri) {
    return memoryStore.get(key) ?? null;
  }
  try {
    return await uri.text();
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

async function writeNativeFileStorageItem(key: string, value: string): Promise<void> {
  const uri = nativeFileStorageUri(key);
  if (!uri) {
    memoryStore.set(key, value);
    return;
  }
  await ensureNativeFileStorageDirectory();
  uri.write(value);
}

async function deleteNativeFileStorageItem(key: string): Promise<void> {
  const uri = nativeFileStorageUri(key);
  if (uri) {
    try {
      if (uri.exists) {
        uri.delete();
      }
    } catch {
      // Best-effort cleanup only.
    }
  }
  memoryStore.delete(key);
}

async function ensureNativeFileStorageDirectory(): Promise<void> {
  const directory = nativeFileStorageDirectory();
  if (!directory) {
    return;
  }
  try {
    directory.create({ idempotent: true, intermediates: true });
  } catch {
    // The write will report the real failure if the directory is still unavailable.
  }
}

function nativeFileStorageDirectory(): Directory | null {
  try {
    return new Directory(Paths.document, APP_STORAGE_DIR);
  } catch {
    return null;
  }
}

function nativeFileStorageUri(key: string): File | null {
  const directory = nativeFileStorageDirectory();
  if (!directory) {
    return null;
  }
  return new File(directory, `${encodeURIComponent(key)}.txt`);
}
