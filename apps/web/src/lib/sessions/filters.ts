import type { OriginFilter } from "@/config/sessions";

export function getSessionOrigin(
	session: {
		automationId?: string | null;
		origin?: string | null;
		clientType?: string | null;
	},
	automationOriginValue: OriginFilter,
): OriginFilter {
	if (session.automationId) return automationOriginValue;
	if (session.origin === "slack" || session.clientType === "slack") return "slack";
	if (session.origin === "cli" || session.clientType === "cli") return "cli";
	return "manual";
}

export function sortSessions<
	T extends {
		session: {
			operatorStatus?: string | null;
			runtimeStatus?: string | null;
			status: string | null;
			lastActivityAt?: Date | string | null;
		};
	},
>(items: T[]): T[] {
	const priority = (s: T["session"]) => {
		if (
			s.operatorStatus === "waiting_for_approval" ||
			s.operatorStatus === "needs_input" ||
			s.operatorStatus === "errored"
		) {
			return 0;
		}
		if (s.runtimeStatus === "running" || s.status === "running") return 1;
		if (s.runtimeStatus === "failed" || s.status === "failed") return 2;
		if (s.runtimeStatus === "completed" || s.status === "stopped") return 4;
		return 3;
	};
	return [...items].sort(
		(a, b) =>
			priority(a.session) - priority(b.session) ||
			new Date(b.session.lastActivityAt ?? 0).getTime() -
				new Date(a.session.lastActivityAt ?? 0).getTime(),
	);
}
