import { describe, expect, it } from "vitest";
import { createWorker, createWorkerRun } from "./db";

describe("workers db invariants", () => {
	it("requires managerSessionId when creating workers", async () => {
		await expect(
			createWorker({
				organizationId: "org_test",
				name: "My Worker",
				managerSessionId: "",
			}),
		).rejects.toThrow("workers.managerSessionId is required");
	});

	it("requires managerSessionId when creating worker_runs", async () => {
		await expect(
			createWorkerRun({
				workerId: "worker_test",
				organizationId: "org_test",
				managerSessionId: "",
				wakeEventId: "wake_test",
			}),
		).rejects.toThrow("worker_runs.managerSessionId is required");
	});
});
