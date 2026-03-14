"use client";

import { orpc } from "@/lib/infra/orpc";
import { useQuery } from "@tanstack/react-query";

export function useAuthProviders() {
	return useQuery({
		...orpc.auth.providers.queryOptions({ input: {} }),
		staleTime: 5 * 60 * 1000,
	});
}
