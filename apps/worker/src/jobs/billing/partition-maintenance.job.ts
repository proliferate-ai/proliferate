/**
 * BullMQ processor: billing events partition maintenance.
 *
 * Runs daily at 02:00 UTC. Handles:
 * 1. Creating next month's partition (if billing_events is partitioned)
 * 2. Cleaning old billing_event_keys entries past retention window
 * 3. Logging partitions eligible for detachment (operator action)
 *
 * The partition creation uses CREATE TABLE IF NOT EXISTS, which is a no-op
 * if billing_events is not yet converted to a partitioned table.
 * This makes the job safe to run before and after the partitioning migration.
 */

import type { Logger } from "@proliferate/logger";
import type { BillingPartitionMaintenanceJob, Job } from "@proliferate/queue";
import { billing } from "@proliferate/services";
import { METERING_CONFIG } from "@proliferate/shared/billing";

/**
 * Get partition name for a given year/month.
 */
function partitionName(year: number, month: number): string {
	return `billing_events_${year}${String(month).padStart(2, "0")}`;
}

/**
 * Get the first day of a month as YYYY-MM-DD.
 */
function monthStart(year: number, month: number): string {
	return `${year}-${String(month).padStart(2, "0")}-01`;
}

function nextMonthYear(year: number, month: number): { year: number; month: number } {
	return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export async function processPartitionMaintenanceJob(
	_job: Job<BillingPartitionMaintenanceJob>,
	logger: Logger,
): Promise<void> {
	const log = logger.child({ op: "partition-maintenance" });
	const now = new Date();
	const currentYear = now.getUTCFullYear();
	const currentMonth = now.getUTCMonth() + 1; // 1-based

	// 1. Try to create next month's partition (safe no-op if table is not partitioned)
	const next = nextMonthYear(currentYear, currentMonth);
	const afterNext = nextMonthYear(next.year, next.month);
	const name = partitionName(next.year, next.month);

	try {
		const created = await billing.ensureBillingPartition(
			name,
			monthStart(next.year, next.month),
			monthStart(afterNext.year, afterNext.month),
		);
		if (created) {
			log.info({ partition: name }, "Ensured next month partition exists");
		} else {
			log.debug("billing_events is not partitioned — skipping partition creation");
		}
	} catch (err) {
		log.error({ err }, "Failed to create partition");
	}

	// 2. Clean old billing_event_keys past retention window
	const retentionDays = METERING_CONFIG.billingEventsHotRetentionDays;
	const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

	try {
		const deleted = await billing.cleanOldBillingEventKeys(cutoff);
		if (deleted > 0) {
			log.info({ deleted, cutoffDate: cutoff.toISOString() }, "Cleaned old billing event keys");
		}
	} catch (err) {
		log.error({ err }, "Failed to clean old billing event keys");
	}

	// 3. Identify partitions eligible for detachment (>90 days old)
	try {
		const partitions = await billing.listBillingEventPartitions();
		if (partitions.length > 0) {
			const cutoffMonth = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`;
			const eligible = partitions.filter((p) => {
				const suffix = p.replace("billing_events_", "");
				return suffix < cutoffMonth && /^\d{6}$/.test(suffix);
			});

			if (eligible.length > 0) {
				log.warn(
					{ eligiblePartitions: eligible, retentionDays, alert: true },
					"Partitions eligible for detachment — run operator runbook",
				);
			} else {
				log.debug({ totalPartitions: partitions.length }, "No partitions eligible for detachment");
			}
		}
	} catch (err) {
		log.debug({ err }, "Could not check partitions");
	}
}
