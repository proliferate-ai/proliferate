use super::publish::publish_session_event_strict;
use super::SessionEventSink;
use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionError, RuntimeInjectedSessionEvent,
};
use crate::live::sessions::runtime_events::into_session_event;
use crate::observability::transcript_phase::record_transcript_phase_event;
use anyharness_contract::v1::{SessionEvent, SessionEventEnvelope};

impl SessionEventSink {
    pub(crate) fn inject_runtime_event(
        &mut self,
        event: RuntimeInjectedSessionEvent,
    ) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
        let touch_session_activity = event.updates_session_activity_at();
        self.inject_session_event_strict(into_session_event(event), touch_session_activity)
    }

    pub(in crate::live::sessions) fn inject_session_event_strict(
        &mut self,
        event: SessionEvent,
        touch_session_activity: bool,
    ) -> Result<SessionEventEnvelope, RuntimeEventInjectionError> {
        if !self.event_sequence_owned {
            return Err(RuntimeEventInjectionError::PersistenceFailed(
                "event sequence ownership has been relinquished".to_string(),
            ));
        }
        if self.has_staged_terminal() {
            return Err(RuntimeEventInjectionError::PersistenceFailed(
                "terminal transaction unresolved".to_string(),
            ));
        }
        let envelope = publish_session_event_strict(
            &self.session_id,
            &mut self.next_seq,
            &self.event_tx,
            self.store.as_ref(),
            event,
            None,
            None,
            touch_session_activity,
        )?;
        record_transcript_phase_event(&mut self.transcript_phase_debug, &envelope);
        Ok(envelope)
    }
}
