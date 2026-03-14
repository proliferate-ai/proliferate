/**
 * oRPC contract implementer.
 *
 * Binds the shared contract to the backend's base context so that
 * all procedure handlers receive a typed `{ request }` context.
 */

import { implement } from "@orpc/server";
import { appContract } from "@proliferate/orpc-contract";
import type { BaseContext } from "./context";

export const orpc = implement(appContract).$context<BaseContext>();
