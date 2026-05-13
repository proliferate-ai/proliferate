#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::live::sessions::actor) struct ProposedPlanChunkAnyHarnessMeta {
    pub(in crate::live::sessions::actor) transcript_event: Option<String>,
    pub(in crate::live::sessions::actor) source_item_id: Option<String>,
    pub(in crate::live::sessions::actor) title: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
pub(in crate::live::sessions::actor) struct ProposedPlanChunkMeta {
    #[serde(default)]
    pub(in crate::live::sessions::actor) anyharness: Option<ProposedPlanChunkAnyHarnessMeta>,
    #[serde(rename = "claudeCode")]
    pub(in crate::live::sessions::actor) claude_code: Option<ProposedPlanClaudeMeta>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::live::sessions::actor) struct ProposedPlanClaudeMeta {
    pub(in crate::live::sessions::actor) tool_name: Option<String>,
}
