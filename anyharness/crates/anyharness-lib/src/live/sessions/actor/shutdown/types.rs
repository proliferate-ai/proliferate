#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone)]
pub(in crate::live::sessions::actor) enum ActorExitDisposition {
    Error {
        message: String,
        code: Option<String>,
    },
    Close,
    Dismiss,
    /// Non-terminal actor retirement. Durable session identity, transcript,
    /// configuration, and native conversation remain available for restart.
    Unload,
}
