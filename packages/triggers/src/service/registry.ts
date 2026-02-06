import type { PollingTrigger, TriggerDefinition, WebhookTrigger } from "./base";

/**
 * Registry of all trigger definitions
 */
class TriggerRegistry {
	private webhookTriggers = new Map<string, WebhookTrigger>();
	private pollingTriggers = new Map<string, PollingTrigger>();

	registerWebhook(trigger: WebhookTrigger): void {
		this.webhookTriggers.set(trigger.id, trigger);
	}

	registerPolling(trigger: PollingTrigger): void {
		this.pollingTriggers.set(trigger.id, trigger);
	}

	getWebhook(id: string): WebhookTrigger | undefined {
		return this.webhookTriggers.get(id);
	}

	getPolling(id: string): PollingTrigger | undefined {
		return this.pollingTriggers.get(id);
	}

	/**
	 * Get all webhook triggers for a provider (e.g., "github")
	 */
	webhooksByProvider(provider: string): WebhookTrigger[] {
		return Array.from(this.webhookTriggers.values()).filter((t) => t.provider === provider);
	}

	/**
	 * Get all polling triggers for a provider (e.g., "gmail")
	 */
	pollingByProvider(provider: string): PollingTrigger[] {
		return Array.from(this.pollingTriggers.values()).filter((t) => t.provider === provider);
	}

	/**
	 * Get all triggers (for /providers endpoint)
	 */
	all(): TriggerDefinition[] {
		return [...this.webhookTriggers.values(), ...this.pollingTriggers.values()];
	}
}

export const registry = new TriggerRegistry();
