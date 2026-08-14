export interface OperationFamilySpecV1 {
  pattern: string;
  operations: readonly string[];
  semanticOwner: string;
  boundary: string;
  owningPr: number;
}

export const P0_OPERATION_FAMILIES: readonly OperationFamilySpecV1[] = [
  {
    pattern: "collector.{boot,shutdown,export}; collector.producer.attach",
    operations: [
      "collector.boot",
      "collector.shutdown",
      "collector.export",
      "collector.producer.attach",
    ],
    semanticOwner: "Collector service",
    boundary:
      "Collector initialization, shutdown, export, or registration begins through readiness, orderly stop, snapshot completion, or admission/rejection.",
    owningPr: 2,
  },
  {
    pattern:
      "desktop.collector.{start,restart,stop}; desktop.anyharness_process.{start,restart,stop}; desktop.worker_process.{start,stop}",
    operations: [
      "desktop.collector.start",
      "desktop.collector.restart",
      "desktop.collector.stop",
      "desktop.anyharness_process.start",
      "desktop.anyharness_process.restart",
      "desktop.anyharness_process.stop",
      "desktop.worker_process.start",
      "desktop.worker_process.stop",
    ],
    semanticOwner: "Tauri process supervisor",
    boundary:
      "The supervisor accepts the process action through child readiness, stop, or an allowed terminal.",
    owningPr: 3,
  },
  {
    pattern: "desktop application operations",
    operations: [
      "desktop.application.boot",
      "desktop.authentication.restore",
      "desktop.authentication.login",
      "desktop.authentication.logout",
      "desktop.workspace.create",
      "desktop.workspace.open",
      "desktop.workspace.close",
      "desktop.target.create",
      "desktop.target.connect",
      "desktop.target.disconnect",
      "desktop.target.teardown",
      "desktop.prompt.submit",
      "desktop.update.check",
      "desktop.update.download",
      "desktop.update.verify",
      "desktop.update.install",
      "desktop.update.relaunch",
    ],
    semanticOwner:
      "Desktop/ProductClient application service accepting the intent",
    boundary:
      "Intent acceptance or boot start through client orchestration completion, prompt handoff, or an allowed terminal.",
    owningPr: 8,
  },
  {
    pattern: "desktop.support_snapshot.{prepare,submit}",
    operations: [
      "desktop.support_snapshot.prepare",
      "desktop.support_snapshot.submit",
    ],
    semanticOwner: "Existing Desktop support workflow",
    boundary:
      "After per-export consent, preparation or submission begins through bounded artifact or receipt, or an allowed terminal.",
    owningPr: 6,
  },
  {
    pattern: "anyharness operations",
    operations: [
      "anyharness.runtime.boot",
      "anyharness.runtime.shutdown",
      "anyharness.workspace.create",
      "anyharness.workspace.open",
      "anyharness.workspace.close",
      "anyharness.target.create",
      "anyharness.target.connect",
      "anyharness.target.disconnect",
      "anyharness.target.teardown",
      "anyharness.session.create",
      "anyharness.session.restore",
      "anyharness.turn.execute",
      "anyharness.agent.start",
      "anyharness.agent.handshake",
      "anyharness.agent.request",
      "anyharness.agent.terminate",
      "anyharness.stream",
      "anyharness.model.request",
      "anyharness.tool.invoke",
      "anyharness.mcp.invoke",
      "anyharness.plugin.invoke",
      "anyharness.skill.invoke",
      "anyharness.hook.invoke",
      "anyharness.subagent.invoke",
      "anyharness.permission.request",
      "anyharness.user_interaction.request",
      "anyharness.goal.run",
      "anyharness.autonomous_loop.run",
      "anyharness.review.run",
      "anyharness.workflow.run",
      "anyharness.persistence.migrate",
    ],
    semanticOwner:
      "Desktop-bundled AnyHarness semantic use case or adapter beginning the work",
    boundary:
      "Work admission through semantic or protocol result, including observable unwind, transport loss, or an allowed terminal.",
    owningPr: 9,
  },
  {
    pattern: "desktop_worker.{boot,shutdown,runtime_connect,command_execute}",
    operations: [
      "desktop_worker.boot",
      "desktop_worker.shutdown",
      "desktop_worker.runtime_connect",
      "desktop_worker.command_execute",
    ],
    semanticOwner: "Desktop-launched Worker service or command owner",
    boundary:
      "Initialization, shutdown, connection, or command admission through readiness, stop, connection, result, or an allowed terminal.",
    owningPr: 9,
  },
  {
    pattern: "server transport operations",
    operations: [
      "server.http.request",
      "server.sse.stream",
      "server.websocket.connection",
      "server.gateway.forward",
    ],
    semanticOwner: "Owning server transport",
    boundary:
      "Transport admission through response completion, close, forward resolution, or an allowed transport terminal; never domain work.",
    owningPr: 10,
  },
  {
    pattern: "server domain operations",
    operations: [
      "server.workspace.provision",
      "server.workspace.teardown",
      "server.sandbox.provision",
      "server.sandbox.teardown",
      "server.runtime.enroll",
      "server.runtime.converge",
      "server.runtime.update",
      "server.runtime.decommission",
      "server.worker.dispatch",
      "server.workflow.run",
      "server.integration.connect",
      "server.integration.sync",
      "server.authentication.exchange",
      "server.authentication.refresh",
      "server.support_report.submit",
      "server.support_report.process",
      "server.job.execute",
      "server.outbox.deliver",
      "server.webhook.handle",
      "server.webhook.deliver",
      "server.model_gateway.request",
    ],
    semanticOwner:
      "Owning server domain service; model gateway only when it constructs and owns the provider request",
    boundary:
      "Domain work admission through committed or known domain result, including worker loss or an allowed terminal.",
    owningPr: 11,
  },
];

export const P0_OPERATION_NAMES = P0_OPERATION_FAMILIES.flatMap(
  (family) => family.operations,
);

const P0_OPERATION_NAME_SET = new Set(P0_OPERATION_NAMES);

export function isP0Operation(name: string): boolean {
  return P0_OPERATION_NAME_SET.has(name);
}
