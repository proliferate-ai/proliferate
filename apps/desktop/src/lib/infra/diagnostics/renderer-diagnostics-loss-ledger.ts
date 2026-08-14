// Saturating loss counters for the renderer batcher. Losses are counted per
// reason and per severity so a loss summary record can report both, and are
// subtracted again only once the collector has accepted the summary that
// reported them.

import type { SeverityV1 } from "@proliferate/product-client/internal/domain/diagnostics/contract";
import type { RendererLossReason, RendererLossSnapshot } from "./renderer-diagnostics-batcher-limits";
import { LOSS_REASONS, SEVERITIES } from "./renderer-diagnostics-batcher-limits";

export class RendererLossLedger {
  private readonly byReason = emptyReasonCounts();
  private readonly bySeverity = emptySeverityCounts();

  note(reason: RendererLossReason, severity: SeverityV1): void {
    this.byReason[reason] = incrementBounded(this.byReason[reason]);
    this.bySeverity[severity] = incrementBounded(this.bySeverity[severity]);
  }

  total(): number {
    return LOSS_REASONS.reduce(
      (total, reason) => Math.min(Number.MAX_SAFE_INTEGER, total + this.byReason[reason]),
      0,
    );
  }

  snapshot(): RendererLossSnapshot {
    return {
      total: this.total(),
      byReason: { ...this.byReason },
      bySeverity: { ...this.bySeverity },
    };
  }

  subtract(snapshot: RendererLossSnapshot): void {
    for (const reason of LOSS_REASONS) {
      this.byReason[reason] = Math.max(
        0,
        this.byReason[reason] - snapshot.byReason[reason],
      );
    }
    for (const severity of SEVERITIES) {
      this.bySeverity[severity] = Math.max(
        0,
        this.bySeverity[severity] - snapshot.bySeverity[severity],
      );
    }
  }
}

function emptyReasonCounts(): Record<RendererLossReason, number> {
  return Object.fromEntries(LOSS_REASONS.map((reason) => [reason, 0])) as Record<
    RendererLossReason,
    number
  >;
}

function emptySeverityCounts(): Record<SeverityV1, number> {
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    SeverityV1,
    number
  >;
}

function incrementBounded(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}
