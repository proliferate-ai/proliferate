import { useCoworkStatusQuery } from "@anyharness/sdk-react";

export function useCoworkStatus() {
  const query = useCoworkStatusQuery();

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
  };
}
