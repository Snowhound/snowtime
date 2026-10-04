//! Better Auth's signed cookies (better-call's signCookieValue and getSignedCookie): the
//! value, a dot, and its HMAC-SHA256 under the secret in base64, URL-encoded.
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

fn mac(secret: &str, value: &str) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC takes any key");
    mac.update(value.as_bytes());
    mac
}

pub fn sign(value: &str, secret: &str) -> String {
    let signature = STANDARD.encode(mac(secret, value).finalize().into_bytes());
    encode_uri_component(&format!("{value}.{signature}"))
}

/// The value of a signed cookie, or None when it is missing or its signature doesn't hold.
pub fn verify<'a>(cookie: &'a str, secret: &str) -> Option<&'a str> {
    let dot = cookie.rfind('.').filter(|&i| i >= 1)?;
    let (value, signature) = (&cookie[..dot], &cookie[dot + 1..]);
    if signature.len() != 44 || !signature.ends_with('=') {
        return None;
    }
    let signature = STANDARD.decode(signature).ok()?;
    mac(secret, value).verify_slice(&signature).ok()?;
    Some(value)
}

/// A cookie's value in a Cookie header, URL-decoded as better-call's parseCookies does.
pub fn find(header: &str, name: &str) -> Option<String> {
    header.split(';').find_map(|pair| {
        let (key, value) = pair.trim().split_once('=')?;
        (key == name).then(|| decode_uri_component(value))
    })
}

/// A Set-Cookie header, with attributes in better-call's order.
pub fn serialize(name: &str, value: &str, max_age: Option<i64>, secure: bool) -> String {
    let mut cookie = format!("{name}={value}");
    if let Some(max_age) = max_age {
        cookie.push_str(&format!("; Max-Age={max_age}"));
    }
    cookie.push_str("; Path=/; HttpOnly");
    if secure {
        cookie.push_str("; Secure");
    }
    cookie.push_str("; SameSite=Lax");
    cookie
}

fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for &b in text.as_bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// Leaves the value as it is when it isn't valid percent-encoding, as parseCookies does.
fn decode_uri_component(text: &str) -> String {
    if !text.contains('%') {
        return text.to_owned();
    }
    let b = text.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let Some(byte) = b
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            else {
                return text.to_owned();
            };
            out.push(byte);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_as_better_call_does() {
        // perf/stress/session.ts signs the same way.
        let signed = sign("abc", "secret");
        assert_eq!(
            signed,
            "abc.mUba1OAOkT%2FIvo5dP34RCkqegy%2BD%2BwnDRShdeGONig4%3D"
        );
        let header = format!("other=1; better-auth.session_token={signed}");
        let cookie = find(&header, "better-auth.session_token").unwrap();
        assert_eq!(verify(&cookie, "secret"), Some("abc"));
        assert_eq!(verify(&cookie, "other"), None);
    }
}
