import { oc } from "@orpc/contract";
import { z } from "zod";
import { SessionSchema } from "../schemas/sessions";

export const sessionsContract = {
	list: oc
		.input(z.object({}).optional())
		.output(z.object({ sessions: z.array(SessionSchema) })),

	get: oc.input(z.object({ id: z.string() })).output(SessionSchema),
};
