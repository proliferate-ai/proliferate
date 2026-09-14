# Feature 

We are adding a way to allow users to save workflows that orchestrate agents with pre-defined step-wise goals. 

A workflow will have its workspace and each node (i.e. step) of the workflow will have its own session within that workspace. 
The orchestration layer of this feature will: 
1) Create a workspace for running a workflow
2) Manage state transition from one node to another by creating a new session when the current node met its goal
3) Maintain the workflow-level states (e.g. which node its currently at, overall workflow state)

# In depth feature requirements

### What is a workflow?
A workflow is a linearly connect set of nodes that runs in the local machine. Each node is either `agent` or `human_in_loop` and the only difference between these two node types is whether the node's goal is autonomously verified by agent or by a human. 

For the sake of logical organization, we will go through the requirements and new components in CP/DP split. 

### CP (server-side workflow definition CRUD):
**What:** Create/save/edit workflow definitions. A workflow definition is a user-scoped, persistent JSON DSL saved in the CP Postgres.

**Workflow definition structure**:
1. A workflow definition is a linearly connect set of nodes
2. A workflow consists of 2 types of nodes:
	1. agent 
	2. human_in_loop
3. Every node has the following required fields
	1. Input prompt (text)
	2. Model config (optional); when undefined, it users the user default for sessions 
4. A workflow can have at 1-10 nodes

**Workflow runtime env configs**
1. User can configure a workflow definition to run in a repo root, or in a new worktree
2. Workflow can only be configured to run in local machine for now (no cloud sandbox support)

**Context docs (defining a workflow)**
Context docs are md files that user can define as context/template for every agent in the workflow. This will be stored as part of workflow definition Postgres and will be copied over to the run instance on the local machine. Agents can read/write every context doc within that workflow run instance (i.e. the source context docs in CP)
Summary points:
	1. User can save md files as context docs in a workflow definition
	2. All agents in the workflow has write/read access to all context docs
	3. Before the first node starts, each run materializes its own writable copy of the definition's context docs under `<workspace-root>/.proliferate/context/`
### DP (invoke)
**What:** Invoke a workflow and orchestrate each node of the workflow until the workflow completes

**Invocation flow**
1. User can click 'Run' from workflow definition list to invoke a workflow
2. For now, we only support running a workflow in local machine (not )
3. Upon invocation, snapshot of the workflow definition is created from the JSON DSL in CP table and copied to DP sqlite table on the local machine; this copied definition will be used by the workflow run orchestrator to prevent corruption of the definition (i.e. user updating the workflow definition while there is a running instance of a workflow)
4. Invocation creates a new local workspace dedicated for that instance of workflow run
5. Workspace is either created in a new worktree or in the repo root depending on the config in its workflow definition
6. The runtime orchestrator creates a session in the workspace 

**Workflow states**
Workflow can be in one of these states:
	1. running: actively running
	2. idle: either human_in_loop waiting for review or was interrupted
	3. completed: all nodes completed 
	4. failed: execution failed

**How does a node run concretely?**
1. Node is simply a new session that runs with the input prompt from the node's definition
2. We will not use the harness native goal feature. 
3. We will prompt the goal as part of the input prompt that we send to agents.
4. Agent node autonomously executes and completes a step and it automatically proceed to the next node once it achieves its goal
5. Human_in_loop node requires human to manually verify achievement of the goal
6. Within a workflow, each node is in one of these states
	1. pending
	2. running
	3. completed
	4. failed

**User interaction with nodes**
User can interact with any node, agent or human_in_loop, running or completed. The UI/UX expectation is the same as normal sessions. More explicitly, expected behaviour is for this matrix is:
- agent
	- running
		- Message gets queued, 
	- completed
		- User can chat in the session just like any other session. Since this node is marked completed, the orchestration layer of the workflow is unaffected from further turns.
- human_in_loop
	- running
		- 
	- completed
		- User can chat in the session just like any other session. Since this node is marked completed, the orchestration layer of the workflow is unaffected from further turns.

**When is a node done?**
For `agent` node, end of turn is when it's done. For `human_in_loop`, it's when the user clicks 'Goal achieved' in the UI.

**What happens when a workflow is interrupted mid-execution?**
User has to take a manual action to continue interrupted workflows that have not completed. Upon restart of the app, we will show the non-complete workflows as a popup on the bottom right to ask user whether they want to continue running the workflow. If yes, we will keep the interrupted session node and we will create a new session for the interrupted node in the existing workspace created by that workflow.

**Context docs (running a workflow)**
Context docs are snapshotted and copied to DP sqlite because they are part of the workflow definition raw in CP Postgres. 
# UI Specifics

### Workflows main page
https://claude.ai/code/artifact/179c957b-dd2f-4e87-b7fb-3ec04cc10d99

### Workflow builder page
https://claude.ai/design/p/fe0bb5b4-13ec-48a7-b8a2-9bf9b1aab3e2?file=CreateWorkflowArtifact.dc.html&via=share

### Running/non-running sessions
Looks the same as normal workspace except the workflow graph view on the right pane. 

### How workflow runs appear alongside normal workspaces

# Interaction journeys

### Creating a workflow

### Running a workflow

### Orchestrating node completion -> start next node

# Mental model (hypotheses)
A workflow run is a durable row in DP table that defines a state machine 

The session engine's `Manager → Handle → Actor` stack exists to own a _live resource that can't be reconstructed from the database_: an OS subprocess, an ACP connection, streams, pending interaction callbacks. A workflow run owns none of those. Its entire state — cursor, node statuses, session bindings, prompt ids — is durable rows,

# Uncertainties
1. How do we force goal pursuing for nodes? Currently we give user the full input prompt for session, so depending on input prompt and the model user, the agent might stop to ask for questions before achieving its goal from the initial prompt.
2. What is the clean way to introduce new object that orchestrates a workflow run? How should it interact with the existing objects that manage sessions in a workspace? Specifically:
	-  **`SessionRuntime
	- **`LiveSessionManager`** 
	- **`LiveSessionHandle`** 
	- **`SessionActor`**
3. Should user be able to interact with running nodes? Should we allow steering mid-turn?
