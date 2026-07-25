//! Emulated-loop writes as serialized [`SessionDomainOp`]s. Live sessions
//! own event sequencing, so runtime-owned loop transitions on a running
//! session ride the actor mailbox (sink lock, published envelopes); offline
//! sessions use the `*_offline` service variants instead.

use std::any::Any;
use std::sync::Arc;

use super::model::LoopRecord;
use super::service::{EmulatedLoopSpec, LoopEventContext, LoopService};
use crate::live::sessions::model::{
    SessionDomainOp, SessionObserverContext, SessionOpEmitter, SessionOpStep,
};

fn loop_event_context(ctx: &SessionObserverContext) -> LoopEventContext {
    LoopEventContext {
        session_id: ctx.session_id.clone(),
        workspace_id: ctx.workspace_id.clone(),
        turn_id: ctx.turn_id.clone(),
        next_seq: ctx.next_seq,
    }
}

pub(crate) struct EmulatedLoopCreateOp {
    pub loop_service: Arc<LoopService>,
    pub spec: EmulatedLoopSpec,
}

pub(crate) struct EmulatedLoopCreateOpOutput {
    pub result: anyhow::Result<LoopRecord>,
}

impl SessionDomainOp for EmulatedLoopCreateOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let ctx = loop_event_context(&emitter.event_ctx());
        let result = match self.loop_service.create_emulated_with_context(&ctx, &self.spec) {
            Ok((record, envelopes)) => {
                emitter.publish(envelopes);
                Ok(record)
            }
            Err(error) => Err(error),
        };
        SessionOpStep::Done(Box::new(EmulatedLoopCreateOpOutput { result }) as Box<dyn Any + Send>)
    }
}

pub(crate) struct EmulatedLoopClearOp {
    pub loop_service: Arc<LoopService>,
    pub loop_id: Option<String>,
    pub reason: Option<String>,
}

pub(crate) struct EmulatedLoopClearOpOutput {
    pub result: anyhow::Result<Vec<LoopRecord>>,
}

impl SessionDomainOp for EmulatedLoopClearOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let ctx = loop_event_context(&emitter.event_ctx());
        let result = match self.loop_service.clear_emulated_with_context(
            &ctx,
            self.loop_id.as_deref(),
            self.reason.as_deref(),
        ) {
            Ok((records, envelopes)) => {
                emitter.publish(envelopes);
                Ok(records)
            }
            Err(error) => Err(error),
        };
        SessionOpStep::Done(Box::new(EmulatedLoopClearOpOutput { result }) as Box<dyn Any + Send>)
    }
}

pub(crate) struct EmulatedLoopFireOp {
    pub loop_service: Arc<LoopService>,
    pub loop_id: String,
}

pub(crate) struct EmulatedLoopFireOpOutput {
    pub result: anyhow::Result<Option<LoopRecord>>,
}

impl SessionDomainOp for EmulatedLoopFireOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let ctx = loop_event_context(&emitter.event_ctx());
        let result = match self
            .loop_service
            .record_emulated_fire_with_context(&ctx, &self.loop_id)
        {
            Ok((record, envelopes)) => {
                emitter.publish(envelopes);
                Ok(record)
            }
            Err(error) => Err(error),
        };
        SessionOpStep::Done(Box::new(EmulatedLoopFireOpOutput { result }) as Box<dyn Any + Send>)
    }
}
