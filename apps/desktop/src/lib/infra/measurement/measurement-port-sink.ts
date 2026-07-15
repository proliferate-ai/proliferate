import type { MeasurementSink } from "@proliferate/product-client/infra/measurement";

import {
  isBootDiagnosticsBrowserFlagEnabled,
  recordBootDiagnostic,
  recordBootDiagnosticOnce,
} from "./boot-stall-diagnostics";
import { recordStoreActionDebugActivity } from "./debug-jank-activity";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "./debug-latency";
import {
  bindMeasurementCategories,
  finishMeasurementOperation,
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  measureDebugComputation,
  onMeasurementOperationFinish,
  recordMeasurementDiagnostic,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "./debug-measurement";
import { getDebugMeasurementDump } from "./debug-measurement-dump";
import {
  hashMeasurementScope,
  isAnyHarnessTimingEnabled,
  isDebugMeasurementEnabled,
  isMainThreadMeasurementEnabled,
} from "./debug-measurement-env";
import { getMeasurementRequestOptions } from "./debug-measurement-request-options";
import { envFlagEnabled, now, round } from "./debug-measurement-utils";
import {
  forgetSessionActivityDebugState,
  isSessionActivityDebugLoggingEnabled,
  logSessionActivityTransition,
} from "./debug-session-activity";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "./debug-startup";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
  failLatencyFlow,
  finishLatencyFlow,
  getLatencyFlowRequestHeaders,
  listActiveLatencyFlows,
  markLatencyFlowLiveAttached,
  resetLatencyFlowsForTest,
  startLatencyFlow,
} from "./latency-flow";
import { uniqueMeasurementOperationIds } from "./operation-ids";
import { recordTypingKeystrokeLatency } from "./typing-latency-probe";

/**
 * The concrete Desktop measurement implementation, shaped to the product-client
 * {@link MeasurementSink} port (WDU slice 04, ruling R1). Every method is a
 * retained `apps/desktop/src/lib/infra/measurement/**` function, so injecting
 * this sink makes the moved product tree's measurement calls byte-identical to
 * before the move. Consumed by `DesktopHostProviders` (production) and the
 * product-client vitest setup (test lane).
 */
export const desktopMeasurementSink: MeasurementSink = {
  recordBootDiagnostic,
  recordBootDiagnosticOnce,
  isBootDiagnosticsBrowserFlagEnabled,
  recordStoreActionDebugActivity,
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
  bindMeasurementCategories,
  finishMeasurementOperation,
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  measureDebugComputation,
  onMeasurementOperationFinish,
  recordMeasurementDiagnostic,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
  getDebugMeasurementDump,
  hashMeasurementScope,
  isAnyHarnessTimingEnabled,
  isDebugMeasurementEnabled,
  isMainThreadMeasurementEnabled,
  getMeasurementRequestOptions,
  envFlagEnabled,
  now,
  round,
  forgetSessionActivityDebugState,
  isSessionActivityDebugLoggingEnabled,
  logSessionActivityTransition,
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
  annotateLatencyFlow,
  cancelLatencyFlow,
  failLatencyFlow,
  finishLatencyFlow,
  getLatencyFlowRequestHeaders,
  listActiveLatencyFlows,
  markLatencyFlowLiveAttached,
  resetLatencyFlowsForTest,
  startLatencyFlow,
  uniqueMeasurementOperationIds,
  recordTypingKeystrokeLatency,
};
