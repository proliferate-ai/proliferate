use crate::live::sessions::actor::command::Resolution;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;

pub(in crate::live::sessions::actor) fn interaction_resolution_for_exit(
    disposition: &ActorExitDisposition,
) -> Resolution {
    match disposition {
        ActorExitDisposition::Dismiss => Resolution::Dismissed,
        ActorExitDisposition::Error { .. } | ActorExitDisposition::Close => {
            Resolution::Cancelled
        }
    }
}
