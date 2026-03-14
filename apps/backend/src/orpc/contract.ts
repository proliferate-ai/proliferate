import { implement } from "@orpc/server";
import { appContract } from "@proliferate/orpc-contract";

export const orpc = implement(appContract).$context<{ request: Request }>();
