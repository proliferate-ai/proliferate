import { oc } from "@orpc/contract";
import { z } from "zod";
import { AuthProvidersSchema } from "../schemas/auth";

export const authContract = {
	providers: oc.input(z.object({}).optional()).output(AuthProvidersSchema),
};
