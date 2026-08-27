use serde_json::json;

use super::confirmed_model_from_ext_response;

#[test]
fn init_meta_model_setter_requires_exact_effective_readback() {
    let confirmed = json!({ "_meta": { "model": { "Ok": "grok-4.6" } } });
    let acknowledgement_only = json!({ "ok": true });

    assert_eq!(
        confirmed_model_from_ext_response(&confirmed).as_deref(),
        Some("grok-4.6")
    );
    assert_eq!(confirmed_model_from_ext_response(&acknowledgement_only), None);
}
