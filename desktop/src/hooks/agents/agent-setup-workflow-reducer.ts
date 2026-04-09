export type PendingAction =
  | null
  | "install"
  | "login"
  | "restart"
  | `save:${string}`;

export interface AgentSetupWorkflowState {
  pendingAction: PendingAction;
  installError: string | null;
  credentialsError: string | null;
  loginError: string | null;
  applyError: string | null;
  envInputs: Record<string, string>;
  loginCommand: string | null;
  loginMessage: string | null;
  savedKeys: Set<string>;
}

export type AgentSetupWorkflowAction =
  | { type: "reset" }
  | { type: "install_started" }
  | { type: "install_failed"; error: string }
  | { type: "install_finished" }
  | { type: "login_started" }
  | { type: "login_succeeded"; command: string; message: string | null }
  | { type: "login_failed"; error: string }
  | { type: "login_finished" }
  | { type: "credential_edit_started"; name: string }
  | { type: "credential_input_updated"; name: string; value: string }
  | { type: "credential_save_started"; name: string }
  | { type: "credential_saved"; name: string }
  | { type: "credential_save_failed"; error: string }
  | { type: "credential_save_finished" }
  | { type: "restart_started" }
  | { type: "restart_failed"; error: string }
  | { type: "restart_finished" };

export function createInitialAgentSetupWorkflowState(): AgentSetupWorkflowState {
  return {
    pendingAction: null,
    installError: null,
    credentialsError: null,
    loginError: null,
    applyError: null,
    envInputs: {},
    loginCommand: null,
    loginMessage: null,
    savedKeys: new Set(),
  };
}

export function agentSetupWorkflowReducer(
  state: AgentSetupWorkflowState,
  action: AgentSetupWorkflowAction,
): AgentSetupWorkflowState {
  switch (action.type) {
    case "reset":
      return createInitialAgentSetupWorkflowState();
    case "install_started":
      return {
        ...state,
        pendingAction: "install",
        installError: null,
      };
    case "install_failed":
      return {
        ...state,
        installError: action.error,
      };
    case "install_finished":
      return {
        ...state,
        pendingAction: null,
      };
    case "login_started":
      return {
        ...state,
        pendingAction: "login",
        loginError: null,
      };
    case "login_succeeded":
      return {
        ...state,
        loginCommand: action.command,
        loginMessage: action.message,
      };
    case "login_failed":
      return {
        ...state,
        loginCommand: null,
        loginMessage: null,
        loginError: action.error,
      };
    case "login_finished":
      return {
        ...state,
        pendingAction: null,
      };
    case "credential_edit_started":
      return {
        ...state,
        credentialsError: null,
        envInputs: {
          ...state.envInputs,
          [action.name]: "",
        },
      };
    case "credential_input_updated":
      return {
        ...state,
        credentialsError: null,
        envInputs: {
          ...state.envInputs,
          [action.name]: action.value,
        },
      };
    case "credential_save_started":
      return {
        ...state,
        pendingAction: `save:${action.name}`,
        credentialsError: null,
      };
    case "credential_saved": {
      const nextEnvInputs = { ...state.envInputs };
      delete nextEnvInputs[action.name];
      return {
        ...state,
        envInputs: nextEnvInputs,
        savedKeys: new Set([...state.savedKeys, action.name]),
      };
    }
    case "credential_save_failed":
      return {
        ...state,
        credentialsError: action.error,
      };
    case "credential_save_finished":
      return {
        ...state,
        pendingAction: null,
      };
    case "restart_started":
      return {
        ...state,
        pendingAction: "restart",
        applyError: null,
      };
    case "restart_failed":
      return {
        ...state,
        applyError: action.error,
      };
    case "restart_finished":
      return {
        ...state,
        pendingAction: null,
      };
    default:
      return state;
  }
}
