import { useQuery } from "@tanstack/react-query";

interface AuthProviders {
	providers: {
		google: boolean;
		github: boolean;
		email: boolean;
	};
}

export function useAuthProviders() {
	return useQuery<AuthProviders>({
		queryKey: ["auth-providers"],
		queryFn: async () => {
			const response = await fetch("/api/auth/providers");
			if (!response.ok) {
				throw new Error("Failed to fetch auth providers");
			}
			return response.json();
		},
		staleTime: Number.POSITIVE_INFINITY, // Never refetch - providers don't change at runtime
	});
}
