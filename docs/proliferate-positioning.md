# Proliferate Positioning Doc (Working Draft)

## 1) Positioning in One Line
Proliferate is the open-source control plane for long-running engineering agents that run inside your environment, with enterprise-grade policy, approvals, and auditability.

## 2) Category We Are Creating
We are not "another chat IDE."
We are building **engineering agent infrastructure**:
- Persistent team agents
- Background execution
- Policy-gated side effects
- Bring-your-own compute and environment

Think:
- OpenClaw-style persistent agent UX
- OpenCode/Claude Code/Codex-style coding execution
- Enterprise trust boundary and governance as first-class product surface

## 3) Core Problem We Solve
Teams want agents to do real engineering work, but they hit four blockers:
- Agents need access to real internal systems and private code environments
- Teams need long-running behavior, not just prompt/response sessions
- Security teams need control over credentials, approvals, and audit logs
- Existing tools are either too local/unsafe or too cloud-locked for strict environments

## 4) Product Thesis
Agent adoption will move from "copilot at keyboard" to "autonomous coworkers handling workflows."
The winner is the platform that provides:
- Reliable execution environments
- Safe capability provisioning
- Clear work review and approvals
- Deployment flexibility (cloud now, self-host when needed)

## 5) Our Differentiation (Durable Wedge)
Our durable wedge is not "better model quality." It is architecture and trust boundary.

### 5.1 Where agents run
- Managed cloud option for speed
- Self-host option for control
- Same agent model in both

### 5.2 Who holds keys and policy
- Control plane owns credential resolution
- Sandbox does not get privileged raw tokens by default
- All high-risk side effects pass through policy and approvals

### 5.3 Environment fidelity
- Agents run in real coding environments, not toy setups
- Works with full codebases, services, tests, and artifacts
- Built for practical engineering loops

### 5.4 Open-source extensibility
- Core is open and composable
- Native connectors for critical systems
- MCP/plugin path for long tail and custom internal tools

## 6) Ideal ICP (First 6 Months)
Primary ICP:
- B2B software and devtools companies
- 20 to 100 engineers
- Strong GitHub + CI + Sentry + Slack usage
- Pain from recurring engineering toil
- Fast decision cycles and technical champions

Examples of target profile:
- Platform lead at a fast-moving product company
- EM with high incident/CI burden
- Senior IC who wants async parallel execution, not just IDE assistance

## 7) Initial Use Cases (Focus, Not Breadth)
Start with one hero workflow and one adjacent workflow.

Hero:
- **Sentry issue -> child run -> PR + evidence**

Adjacent:
- **CI failure -> fix -> PR update**

Optional third once stable:
- **Dependency upgrade repair**

Do not expand to broad support/customer workflows in the initial phase.

## 8) Product Mental Model for Users
Users should think in terms of workforce, not brittle automations:
- "Create an agent that owns this job"
- "Check its active runs"
- "Approve risky actions"
- "Review outputs and artifacts"

Internally, triggers still exist, but UX should surface:
- Agent
- Run
- Approval
- Artifact
- Outcome

## 9) Messaging Framework

### 9.1 Core message
"Not a better chat IDE. The open control plane for long-running engineering agents inside your network."

### 9.2 Early-stage founder message
"Give us one recurring engineering pain loop. We will stand up a background agent that handles it and ships reviewable PRs."

### 9.3 Platform/security message
"Keep agent execution and credentials inside your trust boundary, with policy, approvals, and full audit trails."

### 9.4 Builder/platform message
"Bring your own coding harness and tools. Build agents on top of us, not around us."

## 10) Positioning vs Alternatives (High-Level)
- Cursor/GitHub/Codex/Devin are strong on agent UX and coding capability.
- Our wedge is deployment/control model:
  - Persistent team workflows
  - Trust-boundary-first execution
  - Open extensibility
  - Self-host path without product model changes

## 11) Packaging and Business Model
Three-lane model:
- OSS Core: free, self-hostable baseline
- Managed Cloud: fastest onboarding, usage-based economics
- Enterprise Self-Host: annual contract for governance and scale features

What enterprise pays for:
- SSO/RBAC/policy controls
- Compliance-grade audit exports
- Advanced approvals
- Premium support and deployment hardening

## 12) Milestones That Matter
Do not expand scope until these are real:
- First useful PR in less than 24 hours from onboarding
- More than 30% of agent PRs merged without heavy rewrite
- More than 80% run completion without manual operator rescue
- 2 paid self-host pilots with repeat weekly usage
- 15k to 20k MRR with repeatable implementation motion

## 13) What We Should Not Say
Avoid weak or brittle positioning:
- "We do everything Cursor does and more"
- "We are just automations"
- "We are also doing generic support agents right now"
- "Self-host is coming later" without proof

Prefer:
- "Persistent engineering agents with enterprise control boundaries"
- "Open-source rails for team agent workflows"

## 14) Final Positioning Statement (Website-Ready)
**Proliferate is the open-source control plane for long-running software engineering agents.  
Run agents in managed cloud or inside your own environment, give them real coding contexts, and keep policy, approvals, and credentials under your control.**
