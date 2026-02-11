import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mock setup
// ============================================

const { mockSend } = vi.hoisted(() => ({
	mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock("@proliferate/environment/server", () => ({
	env: {
		S3_BUCKET: "test-bucket",
		S3_REGION: "us-east-1",
		S3_ENDPOINT_URL: null,
		S3_ACCESS_KEY: null,
		S3_SECRET_KEY: null,
	},
}));

vi.mock("@aws-sdk/client-s3", () => {
	class MockS3Client {
		send = mockSend;
	}
	return {
		S3Client: MockS3Client,
		PutObjectCommand: class {
			constructor(public input: unknown) {
				Object.assign(this, input);
			}
		},
	};
});

const { writeCompletionArtifact, writeEnrichmentArtifact } = await import("./artifacts");

// ============================================
// writeCompletionArtifact
// ============================================

describe("writeCompletionArtifact", () => {
	beforeEach(() => vi.clearAllMocks());

	it("writes to correct S3 key", async () => {
		const key = await writeCompletionArtifact("run-1", { outcome: "succeeded" });

		expect(key).toBe("runs/run-1/completion.json");
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it("serializes payload as pretty JSON", async () => {
		const payload = { outcome: "succeeded", summary: "Fixed the bug" };
		await writeCompletionArtifact("run-1", payload);

		const putCommand = mockSend.mock.calls[0][0] as {
			Body: string;
			ContentType: string;
			Bucket: string;
			Key: string;
		};
		expect(putCommand.Body).toBe(JSON.stringify(payload, null, 2));
		expect(putCommand.ContentType).toBe("application/json");
		expect(putCommand.Bucket).toBe("test-bucket");
	});
});

// ============================================
// writeEnrichmentArtifact
// ============================================

describe("writeEnrichmentArtifact", () => {
	beforeEach(() => vi.clearAllMocks());

	it("writes to correct S3 key", async () => {
		const key = await writeEnrichmentArtifact("run-1", { analysis: "data" });

		expect(key).toBe("runs/run-1/enrichment.json");
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it("serializes payload as pretty JSON", async () => {
		const payload = { summary: "Auth bug", sources: ["linear-123"] };
		await writeEnrichmentArtifact("run-1", payload);

		const putCommand = mockSend.mock.calls[0][0] as {
			Body: string;
			ContentType: string;
			Bucket: string;
			Key: string;
		};
		expect(putCommand.Body).toBe(JSON.stringify(payload, null, 2));
		expect(putCommand.ContentType).toBe("application/json");
		expect(putCommand.Bucket).toBe("test-bucket");
	});

	it("uses different key than completion artifact", async () => {
		const completionKey = await writeCompletionArtifact("run-1", {});
		vi.clearAllMocks();
		const enrichmentKey = await writeEnrichmentArtifact("run-1", {});

		expect(completionKey).not.toBe(enrichmentKey);
		expect(completionKey).toContain("completion");
		expect(enrichmentKey).toContain("enrichment");
	});
});
