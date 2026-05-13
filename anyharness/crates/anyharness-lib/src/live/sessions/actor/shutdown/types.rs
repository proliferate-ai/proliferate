#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone)]
pub(in crate::live::sessions::actor) enum ActorExitDisposition {
    Error {
        message: String,
        code: Option<String>,
    },
    Close,
    Dismiss,
}
