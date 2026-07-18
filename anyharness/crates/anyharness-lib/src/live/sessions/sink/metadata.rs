use super::normalization::meta::parse_meta;
use super::state::ParsedMeta;
use super::SessionEventSink;

impl ParsedMeta {
    pub(super) fn parent_tool_call_id(&self, source_agent_kind: &str) -> Option<String> {
        self.anyharness
            .as_ref()
            .and_then(|meta| meta.parent_tool_call_id.clone())
            .or_else(|| {
                (source_agent_kind == "claude")
                    .then(|| {
                        self.claude_code
                            .as_ref()
                            .and_then(|meta| meta.parent_tool_use_id.clone())
                    })
                    .flatten()
            })
    }
}

impl SessionEventSink {
    pub(super) fn meta_parent_tool_call_id(
        &self,
        meta: Option<&serde_json::Value>,
    ) -> Option<String> {
        parse_meta(meta).parent_tool_call_id(&self.source_agent_kind)
    }
}
