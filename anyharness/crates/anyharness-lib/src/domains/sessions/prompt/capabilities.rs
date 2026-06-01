use agent_client_protocol as acp;
use anyharness_contract::v1::{PromptCapabilities, SessionLiveConfigSnapshot};

pub fn capabilities_from_acp(capabilities: Option<&acp::PromptCapabilities>) -> PromptCapabilities {
    capabilities
        .map(|capabilities| PromptCapabilities {
            image: capabilities.image,
            audio: capabilities.audio,
            embedded_context: capabilities.embedded_context,
        })
        .unwrap_or_default()
}

pub fn capabilities_from_live_config(
    snapshot: Option<&SessionLiveConfigSnapshot>,
) -> PromptCapabilities {
    snapshot
        .map(|snapshot| snapshot.prompt_capabilities)
        .unwrap_or_default()
}
