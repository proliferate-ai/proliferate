import { useCallback, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

export function useRequiredGitHubLink() {
  const { auth } = useProductHost();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await auth.startLogin({
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
  }, [auth, loading]);

  const logout = useCallback(async () => {
    await auth.logout();
  }, [auth]);

  return { connect, error, loading, logout };
}
