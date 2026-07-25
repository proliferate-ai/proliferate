import { useCallback, useState } from "react";
import { useProductAuthActions } from "@/hooks/auth/workflows/use-product-auth-actions";

export function useRequiredGitHubLink() {
  const { startLogin, logout: productLogout } = useProductAuthActions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await startLogin({
        kind: "github",
        purpose: "required_github_link",
        prompt: "select_account",
      });
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "GitHub linking could not start.",
      );
    } finally {
      setLoading(false);
    }
  }, [loading, startLogin]);

  const logout = useCallback(async () => {
    await productLogout();
  }, [productLogout]);

  return { connect, error, loading, logout };
}
