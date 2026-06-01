import { useEffect, useState } from "react";

export function useMobileRepositoryPickerState(visible: boolean) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setError(null);
    }
  }, [visible]);

  return {
    busyKey,
    error,
    query,
    setBusyKey,
    setError,
    setQuery,
  };
}
