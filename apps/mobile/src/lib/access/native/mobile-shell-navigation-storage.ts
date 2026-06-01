import type { MobileCloudChat, RouteId } from "../../../navigation/navigation-model";
import {
  chatForMobileShellPersistence,
  MOBILE_SHELL_CHAT_STORAGE_KEY,
  MOBILE_SHELL_ROUTE_STORAGE_KEY,
  MOBILE_SHELL_STORAGE_VERSION,
  mobileShellChatStorageKey,
  mobileShellRouteStorageKey,
  parseStoredMobileShellChat,
  parseStoredMobileShellRoute,
  type StoredMobileShellChat,
  type StoredMobileShellRoute,
} from "../../domain/shell/mobile-shell-navigation";
import {
  deleteMobileStorageItem,
  getMobileStorageItem,
  setMobileStorageItem,
} from "../mobile-storage";

export async function restoreMobileShellNavigation(ownerUserId: string): Promise<{
  chat: MobileCloudChat | null;
  route: RouteId | null;
}> {
  const [storedChat, storedRoute] = await Promise.all([
    getMobileStorageItem(mobileShellChatStorageKey(ownerUserId)),
    getMobileStorageItem(mobileShellRouteStorageKey(ownerUserId)),
  ]);
  void Promise.all([
    deleteMobileStorageItem(MOBILE_SHELL_CHAT_STORAGE_KEY),
    deleteMobileStorageItem(MOBILE_SHELL_ROUTE_STORAGE_KEY),
  ]).catch(() => undefined);
  const chat = parseStoredMobileShellChat(storedChat, ownerUserId);
  const route = parseStoredMobileShellRoute(storedRoute, ownerUserId);
  if (chat) {
    return { chat, route };
  }
  return { chat: null, route };
}

export async function persistMobileShellNavigation(
  ownerUserId: string,
  route: RouteId,
  selectedChat: MobileCloudChat | null,
): Promise<void> {
  if (selectedChat) {
    await Promise.all([
      setMobileStorageItem(
        mobileShellChatStorageKey(ownerUserId),
        JSON.stringify({
          version: MOBILE_SHELL_STORAGE_VERSION,
          ownerUserId,
          chat: chatForMobileShellPersistence(selectedChat),
          updatedAt: Date.now(),
        } satisfies StoredMobileShellChat),
      ),
      setMobileStorageItem(
        mobileShellRouteStorageKey(ownerUserId),
        JSON.stringify({
          version: MOBILE_SHELL_STORAGE_VERSION,
          ownerUserId,
          route,
          updatedAt: Date.now(),
        } satisfies StoredMobileShellRoute),
      ),
    ]);
    return;
  }
  await Promise.all([
    deleteMobileStorageItem(mobileShellChatStorageKey(ownerUserId)),
    setMobileStorageItem(
      mobileShellRouteStorageKey(ownerUserId),
      JSON.stringify({
        version: MOBILE_SHELL_STORAGE_VERSION,
        ownerUserId,
        route,
        updatedAt: Date.now(),
      } satisfies StoredMobileShellRoute),
    ),
  ]);
}

export async function clearMobileShellNavigation(ownerUserId: string | null): Promise<void> {
  const deletes = [
    deleteMobileStorageItem(MOBILE_SHELL_CHAT_STORAGE_KEY),
    deleteMobileStorageItem(MOBILE_SHELL_ROUTE_STORAGE_KEY),
  ];
  if (ownerUserId) {
    deletes.push(
      deleteMobileStorageItem(mobileShellChatStorageKey(ownerUserId)),
      deleteMobileStorageItem(mobileShellRouteStorageKey(ownerUserId)),
    );
  }
  await Promise.all(deletes);
}
