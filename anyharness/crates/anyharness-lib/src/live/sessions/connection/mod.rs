pub mod native_session;
pub mod process;
pub mod shutdown;
pub mod start;
pub mod stderr;
pub mod types;

pub(in crate::live::sessions) use crate::domains::agents::model::{AgentKind, ResolvedAgent};
pub(in crate::live::sessions) use crate::sessions::live_config::{
    LegacyModeOption, LegacyModeState,
};
pub(in crate::live::sessions) use crate::sessions::mcp_bindings::acp::to_acp_servers;
pub(in crate::live::sessions) use crate::sessions::mcp_bindings::model::SessionMcpServer;
pub(in crate::live::sessions) use agent_client_protocol as acp;
