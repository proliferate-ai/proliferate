"use client";

/**
 * oRPC client with TanStack Query integration.
 *
 * Usage:
 *   const { data } = useQuery(orpc.repos.list.queryOptions({ input: {} }));
 *   const mutation = useMutation(orpc.repos.create.mutationOptions());
 */

import type { AppRouter } from "@/server/routers";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

// Build absolute URL for oRPC - RPCLink requires absolute URLs
const getBaseUrl = () => {
	if (typeof window !== "undefined") {
		return window.location.origin;
	}
	return "";
};

const link = new RPCLink({
	url: `${getBaseUrl()}/api/rpc`,
	fetch: (request, init) => {
		return globalThis.fetch(request, {
			...init,
			credentials: "include",
		});
	},
});

const client: RouterClient<AppRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
