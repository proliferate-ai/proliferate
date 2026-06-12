use super::publish::publish_session_event_strict;
use super::SessionEventSink;
use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionError, RuntimeInjectedSessionEvent,
};
use crate::observability::transcript_phase::record_transcript_phase_event;
use anyharness_contract::v1::SessionEventEnvelope;

impl SessionEventSink {
    pub(crate) fn inject_runtime_event(
        &mut self,
        event: RuntimeInjectedSessionEvent,
    ) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
        let touch_session_activity = event.updates_session_activity_at();
        let envelope = publish_session_event_strict(
            &self.session_id,
            &mut self.next_seq,
            &self.event_tx,
            self.store.as_ref(),
            event.into_session_event(),
            None,
            None,
            touch_session_activity,
        )?;
        record_transcript_phase_event(&mut self.transcript_phase_debug, &envelope);
        Ok(envelope)
    }
}
