//! Pre-activation hard gate.

/// The isolation broker is installed and its cleanup primitives are available,
/// but WF-ID deliberately exposes no fresh activation edge until a later packet
/// can atomically validate the final envelope and mint authority.
pub(super) fn fresh_workflow_activation_available() -> bool {
    false
}
