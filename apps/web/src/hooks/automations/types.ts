/** Shared types for coworker/worker hooks */

export interface WorkerRunEvent {
	id: string;
	eventIndex: number;
	eventType: string;
	summaryText: string | null;
	payloadJson: unknown;
	sessionId: string | null;
	actionInvocationId: string | null;
	createdAt: string;
}

export interface ChildSession {
	id: string;
	title: string | null;
	status: string;
}

export interface WorkerRunWithEvents {
	id: string;
	workerId: string;
	status: string;
	summary: string | null;
	wakeEventId: string;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	events: WorkerRunEvent[];
	childSessions?: ChildSession[];
}

export interface PendingDirective {
	id: string;
	messageType: string;
	payloadJson: unknown;
	queuedAt: string;
	senderUserId: string | null;
}
