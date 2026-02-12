import { orpc } from "@/lib/orpc";
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
		...orpc.auth.providers.queryOptions({ input: undefined }),
		staleTime: Number.POSITIVE_INFINITY, // Never refetch - providers don't change at runtime
	});
}
