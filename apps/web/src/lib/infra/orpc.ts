"use client";

/**
 * oRPC client with TanStack Query integration.
 *
 * Points at the backend service for all product API calls.
 */

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "@proliferate/orpc-contract";

const DEFAULT_BACKEND_URL = "http://localhost:3001";

const getBaseUrl = () => {
	if (typeof window !== "undefined") {
		return process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;
	}
	return process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;
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

const client: ContractRouterClient<AppRouter> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
