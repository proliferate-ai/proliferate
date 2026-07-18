use std::{collections::BTreeMap, time::SystemTime};

use sentry::protocol::{
    Breadcrumb, Context as SentryContext, EnvelopeItem, Event, Exception, Frame, Log, LogEntry,
    LogLevel, Request, Span, Stacktrace, Transaction, User, Value,
};
use sentry::Envelope;

use super::{
    breadcrumb, envelope, event, log, scrub_bounded_text, MAX_CORRELATION_ID_BYTES,
    MAX_DIAGNOSTIC_COLLECTION_ITEMS, MAX_DIAGNOSTIC_STRING_BYTES, MAX_TRANSACTION_SPANS,
    SAFE_SERVER_NAME,
};

fn string_field<'a>(fields: &'a BTreeMap<String, Value>, key: &str) -> &'a str {
    match fields.get(key) {
        Some(Value::String(value)) => value,
        other => panic!("expected string field {key}, got {other:?}"),
    }
}

#[test]
fn free_text_redaction_is_case_insensitive_bounded_and_covers_secret_shapes() {
    let raw = format!(
        "bEaReR   lower-bearer-secret BaSiC\tbasic-secret \
         API_KEY=assignment-secret \
         \"access_token\":\"json-secret\" \
         ANTHROPIC_API_KEY=environment-secret \
         ghp_prefixed-secret \
         -----BEGIN PRIVATE KEY-----\npem-secret\n-----END PRIVATE KEY----- \
         /Users/customer/private/file \
         https://runtime.invalid/start?credential=query-secret {}",
        "x".repeat(MAX_DIAGNOSTIC_STRING_BYTES + 64)
    );

    let scrubbed = scrub_bounded_text(&raw);

    for secret in [
        "lower-bearer-secret",
        "basic-secret",
        "assignment-secret",
        "json-secret",
        "environment-secret",
        "prefixed-secret",
        "pem-secret",
        "/Users/customer",
        "query-secret",
    ] {
        assert!(!scrubbed.contains(secret), "leaked {secret}: {scrubbed}");
    }
    assert!(scrubbed.len() <= MAX_DIAGNOSTIC_STRING_BYTES);
    assert!(scrubbed.contains("[redacted-token]"));
    assert!(scrubbed.contains("[redacted-secret]"));
    assert!(scrubbed.contains("[redacted-path]"));
}

#[test]
fn event_scrubber_removes_malicious_payloads_and_bounds_safe_values() {
    let long_workspace_id = "w".repeat(MAX_DIAGNOSTIC_STRING_BYTES + 64);
    let active_contexts = (0..MAX_DIAGNOSTIC_COLLECTION_ITEMS + 8)
        .map(|index| Value::String(format!("context-{index}")))
        .collect::<Vec<_>>();
    let raw_event = Event {
        message: Some(
            "failure at /Users/customer/private.txt with Bearer event-secret \
             https://runtime.invalid/start?token=query-secret"
                .to_string(),
        ),
        logentry: Some(LogEntry {
            message: "failed at /home/customer/private.txt".to_string(),
            params: vec![Value::String("raw prompt parameter".to_string())],
        }),
        user: Some(User {
            id: Some("user-1".to_string()),
            email: Some("customer@example.com".to_string()),
            ip_address: Some(Default::default()),
            username: Some("customer-name".to_string()),
            other: BTreeMap::from([(
                "profile".to_string(),
                Value::String("private profile".to_string()),
            )]),
        }),
        request: Some(Request {
            url: Some(
                "https://runtime.invalid/start?token=query-secret#fragment"
                    .parse()
                    .expect("valid URL"),
            ),
            method: Some("POST".to_string()),
            data: Some("raw request body".to_string()),
            query_string: Some("token=query-secret".to_string()),
            cookies: Some("session=cookie-secret".to_string()),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer header-secret".to_string(),
            )]),
            env: BTreeMap::from([("API_TOKEN".to_string(), "env-secret".to_string())]),
        }),
        server_name: Some("private-customer-hostname".into()),
        contexts: BTreeMap::from([(
            "malicious".to_string(),
            SentryContext::Other(BTreeMap::from([
                (
                    "incident_id".to_string(),
                    Value::String("incident-1".to_string()),
                ),
                ("workspace_id".to_string(), Value::String(long_workspace_id)),
                ("active_contexts".to_string(), Value::Array(active_contexts)),
                (
                    "authorization".to_string(),
                    Value::String("Bearer context-secret".to_string()),
                ),
                (
                    "provider_output".to_string(),
                    Value::String("raw provider output".to_string()),
                ),
                (
                    "customer_name".to_string(),
                    Value::String("private name".to_string()),
                ),
                (
                    "runtime_request:request_id".to_string(),
                    Value::String("customer@example.com".to_string()),
                ),
                (
                    "session_flow:flow_id".to_string(),
                    Value::String("sk-ant-private".to_string()),
                ),
                (
                    "session_flow:flow_kind".to_string(),
                    Value::String("prompt_submit".to_string()),
                ),
                (
                    "session_flow:flow_source".to_string(),
                    Value::String("prompt submit".to_string()),
                ),
                (
                    "session_flow:prompt_id".to_string(),
                    Value::String("prompt-1".to_string()),
                ),
            ])),
        )]),
        breadcrumbs: vec![Breadcrumb {
            message: Some(
                "child output at C:\\Users\\customer\\secret.txt Bearer child-secret".to_string(),
            ),
            data: BTreeMap::from([
                (
                    "request_id".to_string(),
                    Value::String("request-1".to_string()),
                ),
                (
                    "stderr".to_string(),
                    Value::String("raw child stderr".to_string()),
                ),
            ]),
            ..Default::default()
        }]
        .into(),
        exception: vec![Exception {
            value: Some(
                "exception at /private/var/mobile/customer.txt Bearer exception-secret".to_string(),
            ),
            stacktrace: Some(Stacktrace {
                frames: vec![Frame {
                    filename: Some("/Users/customer/source.rs".to_string()),
                    abs_path: Some("/Users/customer/source.rs".to_string()),
                    context_line: Some("let token = secret;".to_string()),
                    pre_context: vec!["raw source before".to_string()],
                    post_context: vec!["raw source after".to_string()],
                    vars: BTreeMap::from([(
                        "prompt".to_string(),
                        Value::String("raw frame prompt".to_string()),
                    )]),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        }]
        .into(),
        tags: BTreeMap::from([
            ("runtime_env".to_string(), "e2b".to_string()),
            ("sandbox_id".to_string(), "provider-sandbox-1".to_string()),
            ("raw_env".to_string(), "env-secret".to_string()),
            (
                "route_url".to_string(),
                "https://runtime.invalid/private".to_string(),
            ),
        ]),
        extra: BTreeMap::from([
            (
                "catalog_version".to_string(),
                Value::String("catalog-1".to_string()),
            ),
            (
                "response_body".to_string(),
                Value::String("raw response".to_string()),
            ),
        ]),
        ..Default::default()
    };

    let event = event(raw_event).expect("event retained");
    let message = event.message.as_deref().expect("event message");
    assert!(!message.contains("event-secret"));
    assert!(!message.contains("/Users/customer"));
    assert!(!message.contains("query-secret"));
    assert!(event.request.is_none());
    assert_eq!(event.server_name.as_deref(), Some(SAFE_SERVER_NAME));

    let user = event.user.as_ref().expect("ID-only user retained");
    assert_eq!(user.id.as_deref(), Some("user-1"));
    assert!(user.email.is_none());
    assert!(user.ip_address.is_none());
    assert!(user.username.is_none());
    assert!(user.other.is_empty());

    let fields = match event.contexts.get("malicious") {
        Some(SentryContext::Other(fields)) => fields,
        other => panic!("expected scrubbed context, got {other:?}"),
    };
    assert_eq!(string_field(fields, "incident_id"), "incident-1");
    assert_eq!(
        string_field(fields, "workspace_id").len(),
        MAX_DIAGNOSTIC_STRING_BYTES
    );
    match fields.get("active_contexts") {
        Some(Value::Array(values)) => {
            assert_eq!(values.len(), MAX_DIAGNOSTIC_COLLECTION_ITEMS)
        }
        other => panic!("expected bounded auth contexts, got {other:?}"),
    }
    assert!(!fields.contains_key("authorization"));
    assert!(!fields.contains_key("provider_output"));
    assert!(!fields.contains_key("customer_name"));
    assert!(!fields.contains_key("runtime_request:request_id"));
    assert!(!fields.contains_key("session_flow:flow_id"));
    assert_eq!(
        string_field(fields, "session_flow:flow_kind"),
        "prompt_submit"
    );
    assert!(!fields.contains_key("session_flow:flow_source"));
    assert_eq!(string_field(fields, "session_flow:prompt_id"), "prompt-1");

    assert_eq!(
        event.tags.get("runtime_env").map(String::as_str),
        Some("e2b")
    );
    assert_eq!(
        event.tags.get("sandbox_id").map(String::as_str),
        Some("provider-sandbox-1")
    );
    assert!(!event.tags.contains_key("raw_env"));
    assert!(!event.tags.contains_key("route_url"));
    assert_eq!(string_field(&event.extra, "catalog_version"), "catalog-1");
    assert!(!event.extra.contains_key("response_body"));

    let logentry = event.logentry.as_ref().expect("log entry retained");
    assert!(!logentry.message.contains("/home/customer"));
    assert!(logentry.params.is_empty());
    let breadcrumb = &event.breadcrumbs[0];
    assert!(!breadcrumb
        .message
        .as_deref()
        .expect("breadcrumb message")
        .contains("child-secret"));
    assert_eq!(string_field(&breadcrumb.data, "request_id"), "request-1");
    assert!(!breadcrumb.data.contains_key("stderr"));

    let exception = &event.exception[0];
    let exception_value = exception.value.as_deref().expect("exception value");
    assert!(!exception_value.contains("exception-secret"));
    assert!(!exception_value.contains("/private/var/mobile"));
    let frame = &exception
        .stacktrace
        .as_ref()
        .expect("stacktrace retained")
        .frames[0];
    assert_eq!(frame.filename.as_deref(), Some("[redacted-path]"));
    assert_eq!(frame.abs_path.as_deref(), Some("[redacted-path]"));
    assert!(frame.context_line.is_none());
    assert!(frame.pre_context.is_empty());
    assert!(frame.post_context.is_empty());
    assert!(frame.vars.is_empty());
}

#[test]
fn transaction_envelopes_are_scrubbed_before_transport() {
    let mut spans = vec![Span {
        op: Some("provider /Users/customer/private Basic span-secret".to_string()),
        description: Some(
            "request https://runtime.invalid/run?token=span-query-secret".to_string(),
        ),
        tags: BTreeMap::from([
            ("runtime_env".to_string(), "e2b".to_string()),
            ("request_id".to_string(), "customer@example.com".to_string()),
            (
                "flow_id".to_string(),
                "prompt_submit:1721320000000:abc123".to_string(),
            ),
            ("raw_env".to_string(), "private".to_string()),
        ]),
        data: BTreeMap::from([
            (
                "prompt_id".to_string(),
                Value::String("prompt-1".to_string()),
            ),
            (
                "flow_source".to_string(),
                Value::String("prompt submit".to_string()),
            ),
            (
                "provider_output".to_string(),
                Value::String("raw provider stderr".to_string()),
            ),
        ]),
        ..Default::default()
    }];
    spans.extend((0..MAX_TRANSACTION_SPANS).map(|_| Span::default()));

    let transaction = Transaction {
        name: Some(format!(
            "POST /Users/customer/private Basic transaction-secret {}",
            "n".repeat(MAX_DIAGNOSTIC_STRING_BYTES + 64)
        )),
        user: Some(User {
            id: Some("user-1".to_string()),
            email: Some("customer@example.com".to_string()),
            username: Some("customer".to_string()),
            ip_address: Some(Default::default()),
            other: BTreeMap::from([(
                "profile".to_string(),
                Value::String("private profile".to_string()),
            )]),
        }),
        tags: BTreeMap::from([
            ("runtime_env".to_string(), "e2b".to_string()),
            ("flow_kind".to_string(), "prompt_submit".to_string()),
            ("flow_source".to_string(), "sk-ant-private".to_string()),
            ("raw_env".to_string(), "private".to_string()),
        ]),
        extra: BTreeMap::from([
            (
                "measurement_operation_id".to_string(),
                Value::String("mop_test-123".to_string()),
            ),
            (
                "request_id".to_string(),
                Value::String("r".repeat(MAX_CORRELATION_ID_BYTES + 1)),
            ),
            (
                "request_body".to_string(),
                Value::String("raw request body".to_string()),
            ),
        ]),
        contexts: BTreeMap::from([(
            "inherited".to_string(),
            SentryContext::Other(BTreeMap::from([
                (
                    "runtime_request:request_id".to_string(),
                    Value::String("request-1".to_string()),
                ),
                (
                    "session_flow:flow_id".to_string(),
                    Value::String("customer@example.com".to_string()),
                ),
                (
                    "session_flow:flow_kind".to_string(),
                    Value::String("prompt_submit".to_string()),
                ),
            ])),
        )]),
        request: Some(Request {
            data: Some("raw transaction request".to_string()),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer request-secret".to_string(),
            )]),
            ..Default::default()
        }),
        server_name: Some("private-customer-hostname".into()),
        spans,
        ..Default::default()
    };
    let mut raw_envelope = Envelope::new();
    raw_envelope.add_item(transaction);

    let scrubbed_envelope = envelope(raw_envelope);
    let transaction = match scrubbed_envelope.items().next() {
        Some(EnvelopeItem::Transaction(transaction)) => transaction,
        other => panic!("expected transaction envelope, got {other:?}"),
    };

    let name = transaction.name.as_deref().expect("transaction name");
    assert!(name.len() <= MAX_DIAGNOSTIC_STRING_BYTES);
    assert!(!name.contains("transaction-secret"));
    assert!(!name.contains("/Users/customer"));
    assert!(transaction.request.is_none());
    assert_eq!(transaction.server_name.as_deref(), Some(SAFE_SERVER_NAME));

    let user = transaction.user.as_ref().expect("ID-only user retained");
    assert_eq!(user.id.as_deref(), Some("user-1"));
    assert!(user.email.is_none());
    assert!(user.username.is_none());
    assert!(user.ip_address.is_none());
    assert!(user.other.is_empty());

    assert_eq!(
        transaction.tags.get("runtime_env").map(String::as_str),
        Some("e2b")
    );
    assert_eq!(
        transaction.tags.get("flow_kind").map(String::as_str),
        Some("prompt_submit")
    );
    assert!(!transaction.tags.contains_key("flow_source"));
    assert!(!transaction.tags.contains_key("raw_env"));
    assert_eq!(
        string_field(&transaction.extra, "measurement_operation_id"),
        "mop_test-123"
    );
    assert!(!transaction.extra.contains_key("request_id"));
    assert!(!transaction.extra.contains_key("request_body"));

    let inherited = match transaction.contexts.get("inherited") {
        Some(SentryContext::Other(fields)) => fields,
        other => panic!("expected inherited context, got {other:?}"),
    };
    assert_eq!(
        string_field(inherited, "runtime_request:request_id"),
        "request-1"
    );
    assert!(!inherited.contains_key("session_flow:flow_id"));
    assert_eq!(
        string_field(inherited, "session_flow:flow_kind"),
        "prompt_submit"
    );

    assert_eq!(transaction.spans.len(), MAX_TRANSACTION_SPANS);
    let span = &transaction.spans[0];
    let op = span.op.as_deref().expect("span op");
    assert!(!op.contains("span-secret"));
    assert!(!op.contains("/Users/customer"));
    assert!(!span
        .description
        .as_deref()
        .expect("span description")
        .contains("span-query-secret"));
    assert_eq!(
        span.tags.get("flow_id").map(String::as_str),
        Some("prompt_submit:1721320000000:abc123")
    );
    assert!(!span.tags.contains_key("request_id"));
    assert!(!span.tags.contains_key("raw_env"));
    assert_eq!(string_field(&span.data, "prompt_id"), "prompt-1");
    assert!(!span.data.contains_key("flow_source"));
    assert!(!span.data.contains_key("provider_output"));
}

#[test]
fn breadcrumb_and_log_scrubbers_keep_only_bounded_safe_fields() {
    let breadcrumb = breadcrumb(Breadcrumb {
        message: Some("Bearer breadcrumb-secret at /home/customer/file".to_string()),
        data: BTreeMap::from([
            (
                "incident_id".to_string(),
                Value::String("incident-1".to_string()),
            ),
            (
                "content".to_string(),
                Value::String("raw content".to_string()),
            ),
        ]),
        ..Default::default()
    })
    .expect("breadcrumb retained");
    assert_eq!(string_field(&breadcrumb.data, "incident_id"), "incident-1");
    assert!(!breadcrumb.data.contains_key("content"));
    let breadcrumb_message = breadcrumb.message.as_deref().expect("breadcrumb message");
    assert!(!breadcrumb_message.contains("breadcrumb-secret"));
    assert!(!breadcrumb_message.contains("/home/customer"));

    let log = log(Log {
        level: LogLevel::Error,
        body: "Bearer log-secret at /Users/customer/file".to_string(),
        trace_id: None,
        timestamp: SystemTime::now(),
        severity_number: None,
        attributes: BTreeMap::from([
            ("requested_model".to_string(), "haiku".to_string().into()),
            (
                "flow_id".to_string(),
                "prompt_submit:1721320000000:abc123".to_string().into(),
            ),
            (
                "request_id".to_string(),
                "customer@example.com".to_string().into(),
            ),
            (
                "provider_output".to_string(),
                "raw provider output".to_string().into(),
            ),
            (
                "arbitrary".to_string(),
                "non-ID user data".to_string().into(),
            ),
        ]),
    })
    .expect("log retained");
    assert!(!log.body.contains("log-secret"));
    assert!(!log.body.contains("/Users/customer"));
    match log.attributes.get("requested_model") {
        Some(attribute) => assert_eq!(attribute.0, Value::String("haiku".to_string())),
        None => panic!("requested model must survive"),
    }
    match log.attributes.get("flow_id") {
        Some(attribute) => assert_eq!(
            attribute.0,
            Value::String("prompt_submit:1721320000000:abc123".to_string())
        ),
        None => panic!("valid flow ID must survive"),
    }
    assert!(!log.attributes.contains_key("request_id"));
    assert!(!log.attributes.contains_key("provider_output"));
    assert!(!log.attributes.contains_key("arbitrary"));
}
