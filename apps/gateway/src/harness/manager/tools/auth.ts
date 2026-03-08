import { signServiceToken } from "@proliferate/shared";
import type { ManagerToolContext } from "./types";

export async function getServiceJwt(ctx: ManagerToolContext): Promise<string> {
	return signServiceToken("manager-harness", ctx.serviceToken, "5m");
}
