//! RFC 8785 (JCS) canonical JSON serialization and SHA-256 digests.
//!
//! The workflow-run wire contract carries `bundleDigest` and
//! `runtimePayloadDigest` fields whose meaning is "SHA-256 over the RFC 8785
//! canonical JSON bytes of the covered object". This module defines those
//! bytes for every Rust consumer (AnyHarness acceptance validation and the
//! Desktop worker's delivery preparation). It has a Python twin
//! (`server/proliferate/server/workflows/domain/canonical.py`) and a
//! TypeScript twin (`apps/packages/product-domain/src/workflows/canonical.ts`);
//! the golden fixtures under `fixtures/contracts/workflow-run/` are the
//! cross-language correctness fence.
//!
//! The only subtle part is number formatting. RFC 8785 §3.2.2.3 requires the
//! ECMAScript `Number::toString` algorithm. `ryu` supplies the shortest
//! round-tripping digits; `ecmascript_body` reformats them into the exact
//! ECMAScript positional/exponent layout (e.g. `1e21` -> `"1e+21"` but
//! `1e20` -> `"100000000000000000000"`).

use std::fmt;

use serde_json::Value;
use sha2::{Digest, Sha256};

/// JSON integer literals beyond the IEEE-754 exact-integer range parse to
/// different values in JavaScript (silent rounding) than in Rust/Python
/// (exact integers), so their canonical bytes could never agree across
/// languages. The guard below applies wherever `serde_json` preserves the
/// exact value (literals fitting `u64`/`i64`); literals overflowing those
/// types fall back to `f64` at parse time — exactly like `JSON.parse` — and
/// canonicalize as that double, byte-identically with JavaScript. The Python
/// twin sees every integer literal exactly and is the strict gate at the
/// Cloud write boundary.
const MAX_SAFE_INTEGER: u64 = 1 << 53;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonicalJsonError {
    NonFiniteNumber,
    IntegerOutsideExactRange(String),
}

impl fmt::Display for CanonicalJsonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFiniteNumber => {
                write!(f, "cannot canonicalize a non-finite number")
            }
            Self::IntegerOutsideExactRange(value) => write!(
                f,
                "cannot canonicalize an integer outside the IEEE-754 exact range (|value| > 2^53): {value}"
            ),
        }
    }
}

impl std::error::Error for CanonicalJsonError {}

/// Serialize a JSON value to its RFC 8785 canonical string form.
pub fn canonical_json(value: &Value) -> Result<String, CanonicalJsonError> {
    let mut out = String::new();
    serialize(value, &mut out)?;
    Ok(out)
}

/// Serialize a JSON value to canonical UTF-8 bytes.
pub fn canonical_bytes(value: &Value) -> Result<Vec<u8>, CanonicalJsonError> {
    canonical_json(value).map(String::into_bytes)
}

/// SHA-256 hex digest over the canonical UTF-8 bytes of `value`.
pub fn sha256_hex(value: &Value) -> Result<String, CanonicalJsonError> {
    let bytes = canonical_bytes(value)?;
    let digest = Sha256::digest(&bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use fmt::Write as _;
        write!(hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(hex)
}

fn serialize(value: &Value, out: &mut String) -> Result<(), CanonicalJsonError> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::String(text) => serialize_string(text, out),
        Value::Number(number) => serialize_number(number, out)?,
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                serialize(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            // RFC 8785 sorts keys by their UTF-16 code units, which differs
            // from Rust's scalar-value `str` ordering for supplementary-plane
            // characters (surrogate code units sort below U+E000..U+FFFF).
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                serialize_string(key, out);
                out.push(':');
                serialize(&map[key.as_str()], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

fn serialize_string(text: &str, out: &mut String) {
    // serde_json applies exactly the RFC 8785 / `JSON.stringify` minimal
    // escaping: the two mandatory escapes (`"` and `\`), the short control
    // escapes (\b \t \n \f \r), and `\u00xx` for the remaining C0 controls,
    // with every other code point emitted as raw UTF-8.
    let escaped = serde_json::to_string(text).expect("string serialization cannot fail");
    out.push_str(&escaped);
}

fn serialize_number(number: &serde_json::Number, out: &mut String) -> Result<(), CanonicalJsonError> {
    if let Some(unsigned) = number.as_u64() {
        if unsigned > MAX_SAFE_INTEGER {
            return Err(CanonicalJsonError::IntegerOutsideExactRange(unsigned.to_string()));
        }
        out.push_str(&unsigned.to_string());
    } else if let Some(signed) = number.as_i64() {
        if signed < -(MAX_SAFE_INTEGER as i64) {
            return Err(CanonicalJsonError::IntegerOutsideExactRange(signed.to_string()));
        }
        out.push_str(&signed.to_string());
    } else if let Some(float) = number.as_f64() {
        if !float.is_finite() {
            return Err(CanonicalJsonError::NonFiniteNumber);
        }
        out.push_str(&ecmascript_number(float));
    } else {
        // serde_json without `arbitrary_precision` always exposes one of the
        // three accessors above.
        return Err(CanonicalJsonError::NonFiniteNumber);
    }
    Ok(())
}

/// Render a finite `f64` per ECMAScript `Number::toString` (RFC 8785).
fn ecmascript_number(value: f64) -> String {
    if value == 0.0 {
        // Both +0 and -0 serialize to "0".
        return "0".to_owned();
    }
    let negative = value < 0.0;

    // `ryu` produces the shortest round-tripping decimal digits in either
    // positional or exponent form; normalize into the ECMAScript `s` (digit
    // string) and `n` (decimal point position) variables.
    let mut buffer = ryu::Buffer::new();
    let formatted = buffer.format_finite(value.abs());
    let (mantissa, exponent_text) = match formatted.split_once(['e', 'E']) {
        Some((mantissa, exponent_text)) => (mantissa, exponent_text),
        None => (formatted, "0"),
    };
    let exponent_shift: i64 = exponent_text.parse().expect("ryu exponent is a valid integer");
    let (int_part, frac_part) = mantissa.split_once('.').unwrap_or((mantissa, ""));

    let mut digits = String::with_capacity(int_part.len() + frac_part.len());
    digits.push_str(int_part);
    digits.push_str(frac_part);
    let mut exponent = exponent_shift - frac_part.len() as i64;

    // Leading zeros do not change the digit-string value; trailing zeros fold
    // into the exponent so `s` is the minimal digit string.
    let leading = digits.len() - digits.trim_start_matches('0').len();
    digits.replace_range(..leading, "");
    let trailing = digits.len() - digits.trim_end_matches('0').len();
    exponent += trailing as i64;
    digits.truncate(digits.len() - trailing);
    debug_assert!(!digits.is_empty(), "a nonzero float always has a nonzero digit");

    let k = digits.len() as i64;
    let n = k + exponent;
    let body = ecmascript_body(&digits, k, n);
    if negative {
        format!("-{body}")
    } else {
        body
    }
}

fn ecmascript_body(s: &str, k: i64, n: i64) -> String {
    if k <= n && n <= 21 {
        let mut body = s.to_owned();
        body.extend(std::iter::repeat('0').take((n - k) as usize));
        body
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &s[..n as usize], &s[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), s)
    } else {
        let exponent = n - 1;
        let sign = if exponent >= 0 { '+' } else { '-' };
        let magnitude = exponent.abs();
        if k == 1 {
            format!("{s}e{sign}{magnitude}")
        } else {
            format!("{}.{}e{sign}{magnitude}", &s[..1], &s[1..])
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::{json, Value};

    use super::{canonical_json, sha256_hex, CanonicalJsonError};

    fn fixture(name: &str) -> Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/contracts/workflow-run")
            .join(name);
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read fixture {path:?}: {error}"));
        serde_json::from_str(&raw).expect("fixture must be valid JSON")
    }

    #[test]
    fn golden_canonical_cases_agree() {
        let file = fixture("canonical-cases.json");
        let cases = file["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().expect("case name");
            let value = &case["value"];
            let expected_canonical = case["canonical"].as_str().expect("case canonical");
            let expected_sha256 = case["sha256"].as_str().expect("case sha256");
            let canonical = canonical_json(value)
                .unwrap_or_else(|error| panic!("case {name} failed to canonicalize: {error}"));
            assert_eq!(canonical, expected_canonical, "canonical mismatch for case {name}");
            let digest = sha256_hex(value).expect("digest");
            assert_eq!(digest, expected_sha256, "sha256 mismatch for case {name}");
        }
    }

    #[test]
    fn golden_resolved_bundle_digest_agrees() {
        let file = fixture("resolved-bundle.json");
        let expected_sha256 = file["sha256"].as_str().expect("bundle sha256");
        let digest = sha256_hex(&file["bundle"]).expect("digest");
        assert_eq!(digest, expected_sha256);
    }

    #[test]
    fn ecmascript_number_thresholds() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (0.1, "0.1"),
            (4.5, "4.5"),
            (0.002, "0.002"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1e23, "1e+23"),
            (1e30, "1e+30"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1e-27, "1e-27"),
            (333333333.33333329, "333333333.3333333"),
            (9007199254740994.0, "9007199254740994"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
            (2.5e22, "2.5e+22"),
            (-2.5e-22, "-2.5e-22"),
        ];
        for (value, expected) in cases {
            assert_eq!(
                canonical_json(&json!(value)).unwrap(),
                *expected,
                "value {value:?}"
            );
        }
    }

    #[test]
    fn key_sort_uses_utf16_code_units() {
        // U+1F600 encodes as surrogates D83D DE00, which sort below U+FB33.
        let value = json!({
            "\u{FB33}": 1,
            "\u{1F600}": 2,
            "\u{20AC}": 3,
            "1": 4,
            "\r": 5,
        });
        let canonical = canonical_json(&value).unwrap();
        assert_eq!(
            canonical,
            "{\"\\r\":5,\"1\":4,\"\u{20AC}\":3,\"\u{1F600}\":2,\"\u{FB33}\":1}"
        );
    }

    #[test]
    fn integers_beyond_exact_range_are_rejected() {
        // Literals that fit `u64`/`i64` keep their exact value, so the guard
        // sees them; u64::MAX and i64::MIN are the edges of that band.
        for literal in [
            "9007199254740993",
            "-9007199254740993",
            "18446744073709551615",
            "-9223372036854775808",
        ] {
            let value: Value = serde_json::from_str(literal).unwrap();
            assert!(
                matches!(
                    canonical_json(&value),
                    Err(CanonicalJsonError::IntegerOutsideExactRange(_))
                ),
                "literal {literal} must be rejected"
            );
        }
        let boundary: Value = serde_json::from_str("9007199254740992").unwrap();
        assert_eq!(canonical_json(&boundary).unwrap(), "9007199254740992");
        let negative_boundary: Value = serde_json::from_str("-9007199254740992").unwrap();
        assert_eq!(canonical_json(&negative_boundary).unwrap(), "-9007199254740992");
    }

    #[test]
    fn integer_literals_overflowing_u64_follow_ecmascript_rounding() {
        // Beyond u64/i64 `serde_json` falls back to `f64` at parse time,
        // exactly like `JSON.parse`; the canonical bytes must match what
        // `JSON.stringify(JSON.parse(literal))` produces. The Python twin
        // rejects these same literals at the Cloud write boundary.
        for (literal, expected) in [
            ("18446744073709551616", "18446744073709552000"),
            ("100000000000000000001", "100000000000000000000"),
            ("-9223372036854775809", "-9223372036854776000"),
            ("-18446744073709551617", "-18446744073709552000"),
        ] {
            let value: Value = serde_json::from_str(literal).unwrap();
            assert_eq!(
                canonical_json(&value).unwrap(),
                expected,
                "literal {literal}"
            );
        }
    }

    #[test]
    fn lone_surrogate_escapes_are_rejected_at_parse() {
        // Rust strings cannot hold lone surrogates, so the cross-language
        // "no digest exists for them anywhere" posture relies on serde_json
        // rejecting the escape before this module can be reached.
        assert!(serde_json::from_str::<Value>("\"\\ud800\"").is_err());
        assert!(serde_json::from_str::<Value>("{\"\\udfff\":1}").is_err());
    }

    #[test]
    fn string_escaping_is_minimal() {
        let value = json!("\u{20AC}$\u{000F}\nA'B\"\\\"/");
        assert_eq!(
            canonical_json(&value).unwrap(),
            "\"\u{20AC}$\\u000f\\nA'B\\\"\\\\\\\"/\""
        );
    }
}
