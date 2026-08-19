use super::validate_protected_incoming_line;
use crate::live::sessions::driver::frame_observer::{ForkWireResponse, FrameObserver};
use crate::live::sessions::driver::frame_tee::{log_frame, FrameDirection};

fn protected_observer() -> FrameObserver {
    let observer = FrameObserver::default();
    observer.protect_process_local_fork();
    observer
}

fn observe_request(observer: &FrameObserver, id: &str, method: &str) {
    log_frame(
        observer,
        "product-child",
        FrameDirection::Send,
        &format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"{method}"}}"#),
    );
}

fn observe_response(observer: &FrameObserver, line: &str) {
    log_frame(observer, "product-child", FrameDirection::Recv, line);
}

#[test]
fn protected_standard_success_is_typed_before_acp_dispatch() {
    let observer = protected_observer();
    observe_request(&observer, "9", "session/fork");
    let malformed =
        r#"{"jsonrpc":"2.0","id":9,"result":{"sessionId":{"provider-response-secret":true}}}"#;
    observe_response(&observer, malformed);

    let error = validate_protected_incoming_line(&observer, malformed.to_string())
        .expect_err("malformed typed result must fail before ACP dispatch");
    assert_eq!(error.to_string(), "protected ACP input was malformed");
    assert!(!error.to_string().contains("provider-response-secret"));
    assert_eq!(
        observer.fork_wire_response(),
        ForkWireResponse::ResultEnvelope,
        "the raw observer records ambiguity before fixed rejection"
    );
}

#[test]
fn protected_explicit_error_preserves_id_and_code_but_removes_provider_data() {
    let observer = protected_observer();
    observe_request(&observer, "11", "session/fork");
    let raw = r#"{"jsonrpc":"2.0","id":11,"error":{"code":-32001,"message":"provider-response-secret","data":{"provider-response-secret":true}}}"#;
    observe_response(&observer, raw);

    let sanitized = validate_protected_incoming_line(&observer, raw.to_string())
        .expect("known explicit error is sanitized");
    let value: serde_json::Value = serde_json::from_str(&sanitized).expect("sanitized JSON");
    assert_eq!(value["id"], 11);
    assert_eq!(value["error"]["code"], -32001);
    assert_eq!(value["error"]["message"], "protected ACP request failed");
    assert!(value["error"].get("data").is_none());
    assert!(!sanitized.contains("provider-response-secret"));
    assert_eq!(
        observer.fork_wire_response(),
        ForkWireResponse::ExplicitError
    );
}

#[test]
fn protected_response_with_neither_result_nor_error_fails_closed() {
    let observer = protected_observer();
    observe_request(&observer, "13", "session/load");
    let neither = r#"{"jsonrpc":"2.0","id":13}"#;
    let error = validate_protected_incoming_line(&observer, neither.to_string())
        .expect_err("response without result or error must fail closed");
    assert_eq!(error.to_string(), "protected ACP input was malformed");
}

#[test]
fn protected_preflight_rejects_null_valued_result_and_error_keys() {
    for (id, method, line) in [
        (
            21,
            "session/fork",
            r#"{"jsonrpc":"2.0","id":21,"result":{"sessionId":"child"},"error":null}"#,
        ),
        (
            22,
            "session/fork",
            r#"{"jsonrpc":"2.0","id":22,"result":null,"error":{"code":-32001,"message":"provider-response-secret"}}"#,
        ),
        (
            23,
            "session/fork",
            r#"{"jsonrpc":"2.0","id":23,"error":null}"#,
        ),
    ] {
        let observer = protected_observer();
        observe_request(&observer, &id.to_string(), method);
        observe_response(&observer, line);

        let error = validate_protected_incoming_line(&observer, line.to_string())
            .expect_err("null-valued envelope fields must fail closed");
        assert_eq!(error.to_string(), "protected ACP input was malformed");
        assert!(!error.to_string().contains("provider-response-secret"));
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::MalformedEnvelope
        );
    }
}

#[test]
fn protected_opaque_result_null_is_a_preserved_success_envelope() {
    let observer = protected_observer();
    observe_request(&observer, "24", "session/set_model");
    let raw = r#"{"jsonrpc":"2.0","id":24,"result":null}"#;
    observe_response(&observer, raw);

    assert_eq!(
        validate_protected_incoming_line(&observer, raw.to_string())
            .expect("an opaque null result is valid JSON and is preserved"),
        raw
    );
}

#[test]
fn protected_owned_extensions_preserve_opaque_success_product_data() {
    let observer = protected_observer();
    for (id, method) in [(14, "session/set_model"), (15, "_anyharness/goal/get")] {
        observe_request(&observer, &id.to_string(), method);
        let raw =
            format!(r#"{{"jsonrpc":"2.0","id":{id},"result":{{"provider-product-value":true}}}}"#);
        assert_eq!(
            validate_protected_incoming_line(&observer, raw.clone()).expect("opaque result"),
            raw
        );
    }
}
