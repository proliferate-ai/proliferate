import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
	parseSignatureHeader,
	setSessionToken,
	setSignatureSecret,
	validateBearerToken,
	validateSignature,
} from "../auth.js";

describe("Auth", () => {
	describe("validateBearerToken", () => {
		beforeEach(() => {
			setSessionToken("test-token-123", 60);
		});

		it("accepts valid bearer token", () => {
			expect(validateBearerToken("Bearer test-token-123")).toBe(true);
		});

		it("rejects invalid bearer token", () => {
			expect(validateBearerToken("Bearer wrong-token")).toBe(false);
		});

		it("rejects missing authorization header", () => {
			expect(validateBearerToken(undefined)).toBe(false);
		});

		it("rejects non-bearer auth", () => {
			expect(validateBearerToken("Basic dXNlcjpwYXNz")).toBe(false);
		});

		it("rejects token with wrong length", () => {
			expect(validateBearerToken("Bearer short")).toBe(false);
		});
	});

	describe("Signature validation", () => {
		const secret = "test-signature-secret";

		beforeEach(() => {
			setSignatureSecret(secret);
		});

		it("parses valid signature header", () => {
			const header =
				"method=GET,path=/_proliferate/health,body_hash=abc123,exp=9999999999,nonce=uuid-1,sig=deadbeef";
			const result = parseSignatureHeader(header);
			expect(result).not.toBeNull();
			expect(result!.method).toBe("GET");
			expect(result!.path).toBe("/_proliferate/health");
			expect(result!.bodyHash).toBe("abc123");
			expect(result!.nonce).toBe("uuid-1");
		});

		it("returns null for incomplete header", () => {
			expect(parseSignatureHeader("method=GET,path=/test")).toBeNull();
		});

		it("validates correct HMAC signature", () => {
			const method = "GET";
			const path = "/_proliferate/health";
			const bodyHash = "e3b0c44298fc1c149afbf4c8996fb924";
			const expiry = String(Math.floor(Date.now() / 1000) + 300);
			const nonce = "unique-nonce-1";

			const message = `${method}${path}${bodyHash}${expiry}${nonce}`;
			const sig = createHmac("sha256", secret).update(message).digest("hex");

			const components = {
				method,
				path,
				bodyHash,
				expiry,
				nonce,
				signature: sig,
			};

			expect(validateSignature(method, path, bodyHash, components)).toBe(true);
		});

		it("rejects expired signature", () => {
			const method = "GET";
			const path = "/_proliferate/health";
			const bodyHash = "abc";
			const expiry = "1000000000"; // far in the past
			const nonce = "nonce-expired";
			const message = `${method}${path}${bodyHash}${expiry}${nonce}`;
			const sig = createHmac("sha256", secret).update(message).digest("hex");

			expect(
				validateSignature(method, path, bodyHash, {
					method,
					path,
					bodyHash,
					expiry,
					nonce,
					signature: sig,
				}),
			).toBe(false);
		});

		it("rejects nonce replay", () => {
			const method = "GET";
			const path = "/_proliferate/health";
			const bodyHash = "abc";
			const expiry = String(Math.floor(Date.now() / 1000) + 300);
			const nonce = "replay-nonce";
			const message = `${method}${path}${bodyHash}${expiry}${nonce}`;
			const sig = createHmac("sha256", secret).update(message).digest("hex");

			const components = { method, path, bodyHash, expiry, nonce, signature: sig };

			// First call should succeed
			expect(validateSignature(method, path, bodyHash, components)).toBe(true);

			// Second call with same nonce should fail
			expect(validateSignature(method, path, bodyHash, components)).toBe(false);
		});

		it("rejects mismatched method", () => {
			const method = "GET";
			const path = "/_proliferate/health";
			const bodyHash = "abc";
			const expiry = String(Math.floor(Date.now() / 1000) + 300);
			const nonce = "nonce-method";
			const message = `${method}${path}${bodyHash}${expiry}${nonce}`;
			const sig = createHmac("sha256", secret).update(message).digest("hex");

			expect(
				validateSignature("POST", path, bodyHash, {
					method,
					path,
					bodyHash,
					expiry,
					nonce,
					signature: sig,
				}),
			).toBe(false);
		});
	});
});
