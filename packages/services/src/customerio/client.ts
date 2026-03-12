/**
 * Customer.io client.
 *
 * Uses the customerio-node SDK for identifying users on signup.
 * Gated on CUSTOMERIO_SITE_ID + CUSTOMERIO_API_KEY env vars.
 */

import { RegionEU, RegionUS, TrackClient } from "customerio-node";
import { getServicesLogger } from "../logger";

const log = getServicesLogger().child({ module: "customerio" });

export interface CustomerioConfig {
	siteId: string;
	apiKey: string;
	region?: "us" | "eu";
}

function createTrackClient(config: CustomerioConfig): TrackClient {
	const region = config.region === "eu" ? RegionEU : RegionUS;
	return new TrackClient(config.siteId, config.apiKey, { region });
}

export interface IdentifyUserInput {
	userId: string;
	email: string;
	name: string;
	createdAt: Date;
}

/**
 * Identify a user in Customer.io. Creates or updates the customer profile.
 */
export async function identifyUser(
	config: CustomerioConfig,
	input: IdentifyUserInput,
): Promise<void> {
	const client = createTrackClient(config);

	await client.identify(input.userId, {
		email: input.email,
		name: input.name,
		created_at: Math.floor(input.createdAt.getTime() / 1000),
	});

	log.info({ userId: input.userId }, "Identified user in Customer.io");
}

export interface TrackEventInput {
	userId: string;
	eventName: string;
	data?: Record<string, unknown>;
}

/**
 * Track an event for a user in Customer.io.
 */
export async function trackEvent(config: CustomerioConfig, input: TrackEventInput): Promise<void> {
	const client = createTrackClient(config);

	await client.track(input.userId, {
		name: input.eventName,
		...(input.data ? { data: input.data } : {}),
	});

	log.info({ userId: input.userId, event: input.eventName }, "Tracked event in Customer.io");
}
