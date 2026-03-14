"use client";

/**
 * oRPC client with TanStack Query integration.
 *
 * Points at the backend service for all product API calls.
 */

import { publicConfig } from "@/lib/config/public";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "@proliferate/orpc-contract";

const link = new RPCLink({
	url: `${publicConfig.backendBaseUrl}/api/rpc`,
	fetch: (request, init) => {
		return globalThis.fetch(request, {
			...init,
			credentials: "include",
		});
	},
});

const client: ContractRouterClient<AppRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
