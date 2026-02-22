import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";
import { cli } from "@proliferate/services";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const log = logger.child({ route: "cli/auth/device" });

export async function POST() {
	try {
		const devUserId =
			env.DEV_USER_ID && env.DEV_USER_ID !== "disabled" ? env.DEV_USER_ID : undefined;
		const result = await cli.createDeviceCode(devUserId);
		const requestHeaders = await headers();
		const forwardedHost = requestHeaders.get("x-forwarded-host");
		const forwardedProto = requestHeaders.get("x-forwarded-proto") || "https";
		const hostHeader = requestHeaders.get("host");

		let baseUrl: string;
		if (forwardedHost) {
			baseUrl = `${forwardedProto}://${forwardedHost}`;
		} else if (hostHeader && !hostHeader.includes("localhost")) {
			baseUrl = `https://${hostHeader}`;
		} else {
			baseUrl = env.NEXT_PUBLIC_APP_URL;
		}

		return NextResponse.json({
			deviceCode: result.deviceCode,
			userCode: result.userCode,
			verificationUrl: `${baseUrl}/device?code=${result.userCode}`,
			expiresIn: result.expiresIn,
			interval: result.interval,
		});
	} catch (err) {
		log.error({ err }, "Failed to create CLI device code");
		return NextResponse.json({ error: "failed_to_create_device_code" }, { status: 500 });
	}
}
