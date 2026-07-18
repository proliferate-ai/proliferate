use std::borrow::Cow;

use sentry::protocol::{
    Breadcrumb, Context as SentryContext, EnvelopeItem, Event, Frame, Log, LogEntry, Span,
    Stacktrace, ThreadId, Transaction, Value,
};
use sentry::Envelope;

mod redact;

use self::redact::{
    explicitly_safe_key, safe_string_value_for_key, safe_value_for_key, scrub_bounded_text,
};

const MAX_DIAGNOSTIC_STRING_BYTES: usize = 512;
const MAX_DIAGNOSTIC_COLLECTION_ITEMS: usize = 32;
const MAX_TRANSACTION_SPANS: usize = 128;
const MAX_CORRELATION_ID_BYTES: usize = 160;
const MAX_CORRELATION_SLUG_BYTES: usize = 64;
pub(super) const SAFE_SERVER_NAME: &str = "anyharness-runtime";

fn scrub_value(value: &mut Value) {
    match value {
        Value::String(text) => *text = scrub_bounded_text(text),
        Value::Array(items) => {
            items.truncate(MAX_DIAGNOSTIC_COLLECTION_ITEMS);
            for item in items {
                scrub_value(item);
            }
        }
        Value::Object(map) => map.retain(|key, value| {
            if !explicitly_safe_key(key) || !safe_value_for_key(key, value) {
                return false;
            }
            scrub_value(value);
            true
        }),
        _ => {}
    }
}

fn scrub_value_map(map: &mut std::collections::BTreeMap<String, Value>) {
    map.retain(|key, value| {
        if !explicitly_safe_key(key) || !safe_value_for_key(key, value) {
            return false;
        }
        scrub_value(value);
        true
    });
}

fn scrub_optional_text(value: &mut Option<String>) {
    if let Some(text) = value {
        *text = scrub_bounded_text(text);
    }
}

fn scrub_log_entry(logentry: &mut Option<LogEntry>) {
    if let Some(logentry) = logentry {
        logentry.message = scrub_bounded_text(&logentry.message);
        logentry.params.clear();
    }
}

fn scrub_thread_id(thread_id: &mut Option<ThreadId>) {
    if let Some(ThreadId::String(value)) = thread_id {
        *value = scrub_bounded_text(value);
    }
}

fn scrub_breadcrumb(breadcrumb: &mut Breadcrumb) {
    breadcrumb.ty = scrub_bounded_text(&breadcrumb.ty);
    scrub_optional_text(&mut breadcrumb.category);
    scrub_optional_text(&mut breadcrumb.message);
    scrub_value_map(&mut breadcrumb.data);
}

fn scrub_frame(frame: &mut Frame) {
    scrub_optional_text(&mut frame.function);
    scrub_optional_text(&mut frame.symbol);
    scrub_optional_text(&mut frame.module);
    scrub_optional_text(&mut frame.package);
    scrub_optional_text(&mut frame.filename);
    scrub_optional_text(&mut frame.abs_path);
    scrub_optional_text(&mut frame.addr_mode);
    frame.context_line = None;
    frame.pre_context.clear();
    frame.post_context.clear();
    frame.vars.clear();
}

fn scrub_stacktrace(stacktrace: &mut Option<Stacktrace>) {
    if let Some(stacktrace) = stacktrace {
        for frame in &mut stacktrace.frames {
            scrub_frame(frame);
        }
        stacktrace.registers.clear();
    }
}

fn scrub_context(context: &mut SentryContext) -> bool {
    match context {
        SentryContext::Other(values) => {
            scrub_value_map(values);
            !values.is_empty()
        }
        SentryContext::Trace(trace) => {
            trace.op = None;
            trace.description = None;
            trace.origin = None;
            scrub_value_map(&mut trace.data);
            true
        }
        SentryContext::Response(response) => {
            response.cookies = None;
            response.headers.clear();
            response.data = None;
            true
        }
        _ => false,
    }
}

pub(super) fn breadcrumb(mut breadcrumb: Breadcrumb) -> Option<Breadcrumb> {
    scrub_breadcrumb(&mut breadcrumb);
    Some(breadcrumb)
}

pub(super) fn event(mut event: Event<'static>) -> Option<Event<'static>> {
    scrub_optional_text(&mut event.message);
    scrub_optional_text(&mut event.culprit);
    scrub_optional_text(&mut event.transaction);
    scrub_log_entry(&mut event.logentry);
    scrub_optional_text(&mut event.logger);
    event.fingerprint = Cow::Owned(
        event
            .fingerprint
            .iter()
            .take(MAX_DIAGNOSTIC_COLLECTION_ITEMS)
            .map(|value| Cow::Owned(scrub_bounded_text(value)))
            .collect(),
    );

    if let Some(user) = &mut event.user {
        if let Some(id) = &mut user.id {
            *id = scrub_bounded_text(id);
        }
        user.email = None;
        user.username = None;
        user.ip_address = None;
        user.other.clear();
    }

    event.request = None;
    event.server_name = Some(Cow::Borrowed(SAFE_SERVER_NAME));

    for breadcrumb in &mut event.breadcrumbs.values {
        scrub_breadcrumb(breadcrumb);
    }
    for exception in &mut event.exception.values {
        exception.ty = scrub_bounded_text(&exception.ty);
        scrub_optional_text(&mut exception.value);
        scrub_optional_text(&mut exception.module);
        if let Some(mechanism) = &mut exception.mechanism {
            mechanism.ty = scrub_bounded_text(&mechanism.ty);
            scrub_optional_text(&mut mechanism.description);
            mechanism.help_link = None;
            scrub_value_map(&mut mechanism.data);
        }
        scrub_thread_id(&mut exception.thread_id);
        scrub_stacktrace(&mut exception.stacktrace);
        scrub_stacktrace(&mut exception.raw_stacktrace);
    }
    scrub_stacktrace(&mut event.stacktrace);
    if let Some(template) = &mut event.template {
        scrub_optional_text(&mut template.filename);
        scrub_optional_text(&mut template.abs_path);
        template.context_line = None;
        template.pre_context.clear();
        template.post_context.clear();
    }
    for thread in &mut event.threads.values {
        scrub_thread_id(&mut thread.id);
        scrub_optional_text(&mut thread.name);
        scrub_stacktrace(&mut thread.stacktrace);
        scrub_stacktrace(&mut thread.raw_stacktrace);
    }
    event.contexts.retain(|_, context| scrub_context(context));
    scrub_value_map(&mut event.extra);
    event.tags.retain(|key, value| {
        if !explicitly_safe_key(key) || !safe_string_value_for_key(key, value) {
            return false;
        }
        *value = scrub_bounded_text(value);
        true
    });

    Some(event)
}

pub(super) fn log(mut log: Log) -> Option<Log> {
    log.body = scrub_bounded_text(&log.body);
    log.attributes.retain(|key, attribute| {
        if !explicitly_safe_key(key) || !safe_value_for_key(key, &attribute.0) {
            return false;
        }
        scrub_value(&mut attribute.0);
        true
    });
    Some(log)
}

fn scrub_span(span: &mut Span) {
    scrub_optional_text(&mut span.op);
    scrub_optional_text(&mut span.description);
    span.tags.retain(|key, value| {
        if !explicitly_safe_key(key) || !safe_string_value_for_key(key, value) {
            return false;
        }
        *value = scrub_bounded_text(value);
        true
    });
    scrub_value_map(&mut span.data);
}

/// Sentry Rust 0.48 has event/log callbacks but no transaction callback. The
/// transport wrapper invokes this equivalent before every transaction envelope
/// is delegated to the HTTP transport.
pub(super) fn before_send_transaction(
    mut transaction: Transaction<'static>,
) -> Transaction<'static> {
    scrub_optional_text(&mut transaction.name);
    if let Some(user) = &mut transaction.user {
        if let Some(id) = &mut user.id {
            *id = scrub_bounded_text(id);
        }
        user.email = None;
        user.username = None;
        user.ip_address = None;
        user.other.clear();
    }
    transaction.tags.retain(|key, value| {
        if !explicitly_safe_key(key) || !safe_string_value_for_key(key, value) {
            return false;
        }
        *value = scrub_bounded_text(value);
        true
    });
    scrub_value_map(&mut transaction.extra);
    transaction
        .contexts
        .retain(|_, context| scrub_context(context));
    transaction.request = None;
    transaction.server_name = Some(Cow::Borrowed(SAFE_SERVER_NAME));
    transaction.spans.truncate(MAX_TRANSACTION_SPANS);
    for span in &mut transaction.spans {
        scrub_span(span);
    }
    transaction
}

pub(super) fn envelope(envelope: Envelope) -> Envelope {
    if envelope.items().next().is_none() {
        return envelope;
    }
    let headers = envelope.headers().clone();
    let mut scrubbed = Envelope::new().with_headers(headers);
    for item in envelope.into_items() {
        match item {
            EnvelopeItem::Transaction(transaction) => {
                scrubbed.add_item(before_send_transaction(transaction));
            }
            other => scrubbed.add_item(other),
        }
    }
    scrubbed
}

#[cfg(test)]
mod tests;
