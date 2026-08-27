//! Scrubbing for Sentry payloads leaving the desktop native shell.
//!
//! Everything this process reports passes through here first: absolute paths,
//! bearer tokens, URL query strings and any value under a sensitive-looking
//! key are redacted before the event or log is handed to the transport.
//! Mirrors the worker's scrubber (each binary carries its own copy, the
//! established per-emitter pattern).

use sentry::protocol::{Breadcrumb, Event, Frame, Log, LogEntry, Stacktrace, Value};

use super::RUNTIME_ENV_TAG;

fn scrub_text(value: &str) -> String {
    redact_absolute_paths(&strip_query_segments(&redact_bearer_tokens(value)))
}

fn redact_bearer_tokens(value: &str) -> String {
    let mut output = String::new();
    let mut remaining = value;
    while let Some(index) = remaining.find("Bearer ") {
        output.push_str(&remaining[..index]);
        output.push_str("[redacted-token]");
        let token_start = index + "Bearer ".len();
        let token_end = remaining[token_start..]
            .find(char::is_whitespace)
            .map(|offset| token_start + offset)
            .unwrap_or(remaining.len());
        remaining = &remaining[token_end..];
    }
    output.push_str(remaining);
    output
}

fn strip_query_segments(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut output = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '?' && preceding_token_is_urlish(&output) {
            index += 1;
            while index < chars.len()
                && !chars[index].is_whitespace()
                && !matches!(chars[index], '"' | '\'' | ')' | '<' | '>')
            {
                index += 1;
            }
            continue;
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

fn preceding_token_is_urlish(value: &str) -> bool {
    let token = value
        .rsplit(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '(' | '<' | '>'))
        .next()
        .unwrap_or_default();
    token.contains("://")
        || token.starts_with('/')
        || token.starts_with("./")
        || token.starts_with("../")
}

fn redact_absolute_paths(value: &str) -> String {
    let mut output = String::new();
    let mut index = 0;
    while index < value.len() {
        let rest = &value[index..];
        if rest.starts_with("/Users/")
            || rest.starts_with("/home/")
            || rest.starts_with("/private/var/mobile/")
            || rest.starts_with("/var/mobile/")
            || rest.starts_with("/data/user/")
            || rest.starts_with("/data/data/")
            || starts_with_windows_path(rest)
        {
            output.push_str("[redacted-path]");
            index += rest
                .find(|ch: char| {
                    ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ')' | '<' | '>')
                })
                .unwrap_or(rest.len());
            continue;
        }
        let ch = rest.chars().next().expect("non-empty rest");
        output.push(ch);
        index += ch.len_utf8();
    }
    output
}

fn starts_with_windows_path(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(drive) = chars.next() else {
        return false;
    };
    if !drive.is_ascii_alphabetic() || chars.next() != Some(':') {
        return false;
    }
    match chars.next() {
        Some('\\') => true,
        Some('/') => chars.next() != Some('/'),
        _ => false,
    }
}

fn sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    [
        "authorization",
        "cookie",
        "token",
        "secret",
        "password",
        "api_key",
        "apikey",
        "credential",
        "prompt",
        "content",
        "stdout",
        "stderr",
        "request_body",
        "body",
        "env",
        "file_path",
        "path",
        "query",
        "search",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn scrub_value(value: &mut Value, key: Option<&str>) {
    if key.is_some_and(sensitive_key) {
        *value = Value::String("[redacted]".to_string());
        return;
    }

    match value {
        Value::String(text) => {
            *text = scrub_text(text);
        }
        Value::Array(items) => {
            for item in items {
                scrub_value(item, None);
            }
        }
        Value::Object(map) => {
            for (entry_key, entry_value) in map {
                scrub_value(entry_value, Some(entry_key));
            }
        }
        _ => {}
    }
}

fn scrub_optional_text(value: &mut Option<String>) {
    if let Some(text) = value {
        *text = scrub_text(text);
    }
}

fn scrub_log_entry(logentry: &mut Option<LogEntry>) {
    if let Some(logentry) = logentry {
        logentry.message = scrub_text(&logentry.message);
        for param in &mut logentry.params {
            scrub_value(param, None);
        }
    }
}

fn scrub_frame(frame: &mut Frame) {
    scrub_optional_text(&mut frame.filename);
    scrub_optional_text(&mut frame.abs_path);
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
    }
}

pub(super) fn scrub_breadcrumb(mut breadcrumb: Breadcrumb) -> Option<Breadcrumb> {
    scrub_optional_text(&mut breadcrumb.message);
    for (key, value) in &mut breadcrumb.data {
        scrub_value(value, Some(key));
    }
    Some(breadcrumb)
}

pub(super) fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    scrub_optional_text(&mut event.message);
    scrub_optional_text(&mut event.culprit);
    scrub_optional_text(&mut event.transaction);
    scrub_log_entry(&mut event.logentry);

    if let Some(user) = &mut event.user {
        user.email = None;
        user.username = None;
        user.ip_address = None;
        user.other.clear();
    }

    if let Some(request) = &mut event.request {
        if let Some(url) = &mut request.url {
            url.set_query(None);
            url.set_fragment(None);
        }
        request.data = None;
        request.query_string = None;
        request.cookies = None;
        request.headers.clear();
        request.env.clear();
    }

    for breadcrumb in &mut event.breadcrumbs.values {
        scrub_optional_text(&mut breadcrumb.message);
        for (key, value) in &mut breadcrumb.data {
            scrub_value(value, Some(key));
        }
    }
    for exception in &mut event.exception.values {
        scrub_optional_text(&mut exception.value);
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
        scrub_optional_text(&mut thread.name);
        scrub_stacktrace(&mut thread.stacktrace);
        scrub_stacktrace(&mut thread.raw_stacktrace);
    }
    for (key, value) in &mut event.extra {
        scrub_value(value, Some(key));
    }
    for (key, value) in &mut event.tags {
        if key == RUNTIME_ENV_TAG {
            // Bounded deployment identity: the runtime-environment tag survives
            // (allowed live value `e2b`). Every other env-like tag key still
            // matches `sensitive_key` and stays redacted.
            *value = scrub_text(value);
        } else if sensitive_key(key) {
            *value = "[redacted]".to_string();
        } else {
            *value = scrub_text(value);
        }
    }

    Some(event)
}

pub(super) fn scrub_log(mut log: Log) -> Option<Log> {
    log.body = scrub_text(&log.body);
    for (key, attribute) in &mut log.attributes {
        scrub_value(&mut attribute.0, Some(key));
    }
    Some(log)
}

#[cfg(test)]
mod tests {
    use sentry::protocol::{Event, Exception, Frame, Stacktrace, Value};

    use super::scrub_event;

    #[test]
    fn sentry_event_scrubber_removes_paths_urls_and_bodies() {
        let mut event = Event::new();
        event.message = Some(
            "failed at /home/proliferate/workspace/file.rs?code=secret Bearer abc123".to_string(),
        );
        event.extra.insert(
            "body".to_string(),
            Value::String("raw response".to_string()),
        );
        event.exception.values.push(Exception {
            value: Some(
                "request failed https://app.proliferate.com/auth/callback?code=abc&state=def"
                    .to_string(),
            ),
            stacktrace: Some(Stacktrace {
                frames: vec![Frame {
                    abs_path: Some("/home/proliferate/app/main.rs".to_string()),
                    context_line: Some("let token = secret;".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        });

        let scrubbed = scrub_event(event).expect("event should remain");

        assert_eq!(
            scrubbed.message.as_deref(),
            Some("failed at [redacted-path] [redacted-token]")
        );
        assert_eq!(
            scrubbed.extra["body"],
            Value::String("[redacted]".to_string())
        );
        assert_eq!(
            scrubbed.exception.values[0].value.as_deref(),
            Some("request failed https://app.proliferate.com/auth/callback")
        );
        let frame = &scrubbed.exception.values[0]
            .stacktrace
            .as_ref()
            .expect("stacktrace")
            .frames[0];
        assert_eq!(frame.abs_path.as_deref(), Some("[redacted-path]"));
        assert!(frame.context_line.is_none());
    }

    #[test]
    fn runtime_env_tag_survives_while_other_env_tags_are_redacted() {
        let mut event = Event::new();
        event
            .tags
            .insert("runtime_env".to_string(), "e2b".to_string());
        event
            .tags
            .insert("deploy_env".to_string(), "prod".to_string());
        event
            .tags
            .insert("environment_name".to_string(), "prod".to_string());

        let scrubbed = scrub_event(event).expect("event should remain");

        // Bounded deployment identity is preserved; other env-like tags are not.
        assert_eq!(
            scrubbed.tags.get("runtime_env").map(String::as_str),
            Some("e2b")
        );
        assert_eq!(
            scrubbed.tags.get("deploy_env").map(String::as_str),
            Some("[redacted]")
        );
        assert_eq!(
            scrubbed.tags.get("environment_name").map(String::as_str),
            Some("[redacted]")
        );
    }
}
