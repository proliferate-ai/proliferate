import type { AuthResult } from "../../../../types";

export interface SessionWsConnectionContext {
	proliferateSessionId: string;
	auth: AuthResult;
}
