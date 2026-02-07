import { SignJWT, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { verifyToken } from "./auth";

describe("verifyToken", () => {
	it("verifies HS256 tokens and returns payload", async () => {
		const secret = "test-secret";
		const token = await new SignJWT({ sub: "user_123", email: "u@example.com" })
			.setProtectedHeader({ alg: "HS256" })
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(secret));

		const payload = await verifyToken(token, secret);
		expect(payload?.sub).toBe("user_123");
		expect(payload?.email).toBe("u@example.com");
	});

	it("rejects tokens without a sub", async () => {
		const secret = "test-secret";
		const token = await new SignJWT({})
			.setProtectedHeader({ alg: "HS256" })
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(secret));

		const payload = await verifyToken(token, secret);
		expect(payload).toBeNull();
	});

	it("rejects ES256 tokens", async () => {
		const { privateKey } = await generateKeyPair("ES256");
		const token = await new SignJWT({ sub: "user_123" })
			.setProtectedHeader({ alg: "ES256" })
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(privateKey);

		const payload = await verifyToken(token, "test-secret");
		expect(payload).toBeNull();
	});

	it("does not fetch remote keys", async () => {
		if (typeof globalThis.fetch !== "function") return;

		const fetchSpy = vi.spyOn(globalThis, "fetch");
		try {
			const secret = "test-secret";
			const token = await new SignJWT({ sub: "user_123" })
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime("1h")
				.sign(new TextEncoder().encode(secret));

			await verifyToken(token, secret);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
