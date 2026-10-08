//! Bounds on auth values stored in the shared database.
use serde_json::Value;

pub(super) const URL_BYTES: usize = 2048;
pub(super) const JSON_BYTES: usize = 4096;
pub(super) const PASSKEY_NAME_UNITS: usize = 100;
pub(super) const SCOPE_ISSUES: usize = 32;

pub(super) fn url_issue(value: &Value, path: &str) -> Option<String> {
    value
        .as_str()
        .filter(|v| v.len() > URL_BYTES)
        .map(|_| format!("[body.{path}] Too big: expected string to have <=2048 bytes"))
}
pub(super) fn json_issue(value: &Value, path: &str) -> Option<String> {
    value
        .as_object()
        .filter(|_| value.to_string().len() > JSON_BYTES)
        .map(|_| format!("[body.{path}] Too big: expected JSON to have <=4096 bytes"))
}
pub(super) fn passkey_name_issue(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|v| {
            v.trim_matches(crate::schemas::js_whitespace)
                .encode_utf16()
                .count()
                > PASSKEY_NAME_UNITS
        })
        .map(|_| "[body.name] Too big: expected string to have <=100 characters".into())
}
pub(super) fn user_agent(value: &str) -> &str {
    let mut end = value.len().min(512);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn stored_bounds_include_json_encoding_and_utf8_bytes() {
        assert!(url_issue(&json!("a".repeat(2048)), "image").is_none());
        assert!(url_issue(&json!("ä".repeat(1025)), "image").is_some());
        assert!(json_issue(&json!({"v":"a".repeat(4088)}), "metadata").is_none());
        assert!(json_issue(&json!({"v":"a".repeat(4089)}), "metadata").is_some());
        assert!(json_issue(&json!({"v":"\n".repeat(2045)}), "additionalData").is_some());
    }
    #[test]
    fn passkey_names_count_trimmed_utf16_units() {
        assert!(passkey_name_issue(&json!(format!(" {} ", "😀".repeat(50)))).is_none());
        assert!(passkey_name_issue(&json!("😀".repeat(51))).is_some());
        assert!(passkey_name_issue(&json!("a".repeat(100))).is_none());
        assert!(passkey_name_issue(&json!("a".repeat(101))).is_some());
    }
    #[test]
    fn user_agents_truncate_on_a_utf8_boundary() {
        assert_eq!(user_agent("short"), "short");
        assert_eq!(user_agent(&"a".repeat(513)).len(), 512);
        assert_eq!(
            user_agent(&format!("{}😀", "a".repeat(510))),
            "a".repeat(510)
        );
        assert_eq!(user_agent(&"😀".repeat(129)).len(), 512);
    }
}
