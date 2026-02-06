/**
 * Verification Tool Methods
 *
 * SDK-side access to verification files (screenshots from agent verify tool).
 * Mirrors gateway hub/capabilities/tools/ structure.
 */

import type { VerificationTools } from "../../client";
import type { HttpClient, VerificationFile } from "../../types";

/**
 * Create verification tools bound to an HTTP client
 */
export function createVerificationTools(http: HttpClient): VerificationTools {
	return {
		async list(
			proliferateSessionId: string,
			options?: { prefix?: string },
		): Promise<VerificationFile[]> {
			const params = new URLSearchParams();
			if (options?.prefix) {
				params.set("prefix", options.prefix);
			}

			const queryString = params.toString();
			const path = `/proliferate/${proliferateSessionId}/verification-media${queryString ? `?${queryString}` : ""}`;

			const data = await http.get<{ files: VerificationFile[] }>(path);
			return data.files;
		},

		async getUrl(proliferateSessionId: string, key: string): Promise<string> {
			const path = `/proliferate/${proliferateSessionId}/verification-media?key=${encodeURIComponent(key)}`;
			const data = await http.get<{ url: string }>(path);
			return data.url;
		},

		async getStream(
			proliferateSessionId: string,
			key: string,
		): Promise<{ data: ArrayBuffer; contentType: string }> {
			const path = `/proliferate/${proliferateSessionId}/verification-media?key=${encodeURIComponent(key)}&stream=true`;

			// This is a special case - we need the raw response, not JSON
			// The http client will need to handle this specially based on the stream param
			const result = await http.get<{ data: ArrayBuffer; contentType: string }>(path);
			return result;
		},
	};
}
