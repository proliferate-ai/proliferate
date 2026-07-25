import { useAuthStore } from "@/stores/auth/auth-store";

export function useAiMagicAvailability(): boolean {
  const authStatus = useAuthStore((state) => state.status);
  return authStatus === "authenticated";
}
