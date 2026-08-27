//! The one span field that crosses into Sentry: a validated `session_id`.
//!
//! Span-attribute inheritance stays off in the Sentry layer for privacy;
//! this module records the `session_id` span field into span extensions at
//! creation and lets the event mapper tag each event with the nearest
//! enclosing span's value. Nothing else crosses.

use tracing::Subscriber;
use tracing_subscriber::{layer::Context as LayerContext, registry::LookupSpan, Layer};

pub(super) const SESSION_ID_SPAN_FIELD: &str = "session_id";

/// Typed span extension: the validated `session_id` recorded at span creation
/// by [`SessionIdSpanLayer`].
struct SpanSessionId(String);

struct SessionIdVisitor(Option<String>);

impl tracing::field::Visit for SessionIdVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == SESSION_ID_SPAN_FIELD {
            self.0 = Some(value.to_string());
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == SESSION_ID_SPAN_FIELD {
            self.0 = Some(format!("{value:?}").trim_matches('"').to_string());
        }
    }
}

/// Only a canonical lowercase UUID leaves the process as a `session_id` tag;
/// a client-supplied custom session id stays local (bounded beats complete
/// for a vendor-bound tag).
pub(super) fn canonical_session_id(candidate: &str) -> Option<&str> {
    let bytes = candidate.as_bytes();
    if bytes.len() != 36 {
        return None;
    }
    let canonical = bytes.iter().enumerate().all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => *byte == b'-',
        _ => byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase(),
    });
    canonical.then_some(candidate)
}

/// Records the `session_id` span field into span extensions so the Sentry
/// mapper can tag events without enabling blanket span-attribute inheritance
/// (which stays off for privacy — only this one validated field crosses).
pub(super) struct SessionIdSpanLayer;

impl<S> Layer<S> for SessionIdSpanLayer
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
{
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        id: &tracing::span::Id,
        ctx: LayerContext<'_, S>,
    ) {
        let mut visitor = SessionIdVisitor(None);
        attrs.record(&mut visitor);
        let Some(candidate) = visitor.0 else { return };
        let Some(valid) = canonical_session_id(&candidate) else {
            return;
        };
        if let Some(span) = ctx.span(id) {
            span.extensions_mut()
                .insert(SpanSessionId(valid.to_string()));
        }
    }
}

/// The nearest enclosing span's validated `session_id`, if the event fired
/// inside session work.
pub(super) fn session_id_for_event<S>(
    event: &tracing::Event<'_>,
    context: &LayerContext<'_, S>,
) -> Option<String>
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
{
    let span = context.event_span(event)?;
    span.scope().find_map(|span| {
        span.extensions()
            .get::<SpanSessionId>()
            .map(|s| s.0.clone())
    })
}

#[cfg(test)]
mod tests {
    use super::super::{sentry_event_mapper, tests::sentry_test_options};
    use super::{canonical_session_id, SessionIdSpanLayer};

    const SESSION_UUID: &str = "c3f1a8d2-5b47-4e19-9a6c-0d8e2f7b41ca";

    fn session_tag_events(emit: impl FnOnce()) -> Vec<sentry::protocol::Event<'static>> {
        use tracing_subscriber::layer::SubscriberExt;
        let subscriber = tracing_subscriber::registry()
            .with(SessionIdSpanLayer)
            .with(sentry_tracing::layer().event_mapper(sentry_event_mapper));
        sentry::test::with_captured_events_options(
            || tracing::subscriber::with_default(subscriber, emit),
            sentry_test_options(),
        )
    }

    #[test]
    fn error_inside_session_span_carries_the_session_id_tag() {
        // The field is recorded Display-style (`%id`) at the production call
        // sites (domains/sessions/runtime, live/sessions/manager), so record it
        // the same way here.
        let events = session_tag_events(|| {
            let id = SESSION_UUID.to_string();
            let span = tracing::info_span!("session_work", session_id = %id);
            let _guard = span.enter();
            let inner = tracing::info_span!("nested_operation");
            let _inner_guard = inner.enter();
            tracing::error!("failure inside session work");
        });
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].tags.get("session_id").map(String::as_str),
            Some(SESSION_UUID),
            "an ERROR inside a session span must carry the session_id tag"
        );
    }

    #[test]
    fn non_uuid_session_id_never_becomes_a_tag() {
        let events = session_tag_events(|| {
            let span = tracing::info_span!("session_work", session_id = "session-01");
            let _guard = span.enter();
            tracing::error!("failure inside custom-id session work");
        });
        assert_eq!(events.len(), 1);
        assert!(
            !events[0].tags.contains_key("session_id"),
            "a client-supplied custom session id stays local-only"
        );
    }

    #[test]
    fn error_outside_any_session_span_stays_untagged() {
        let events = session_tag_events(|| {
            tracing::error!("failure outside session work");
        });
        assert_eq!(events.len(), 1);
        assert!(!events[0].tags.contains_key("session_id"));
    }

    #[test]
    fn canonical_session_id_admits_lowercase_uuid_only() {
        assert_eq!(canonical_session_id(SESSION_UUID), Some(SESSION_UUID));
        for rejected in [
            "session-01",
            "C3F1A8D2-5B47-4E19-9A6C-0D8E2F7B41CA",
            "c3f1a8d25b474e199a6c0d8e2f7b41ca",
            "",
            "c3f1a8d2-5b47-4e19-9a6c-0d8e2f7b41ca-extra",
        ] {
            assert_eq!(canonical_session_id(rejected), None, "{rejected}");
        }
    }
}
