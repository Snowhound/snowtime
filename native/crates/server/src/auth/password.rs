//! Better Auth's password hashes (@better-auth/utils/password): scrypt with N = 16384,
//! r = 16, p = 1, and a 64-byte key over the NFKC-normalized password, stored as
//! `<hex salt>:<hex key>`. The salt is used as its hex text, not as bytes.
use rand::RngExt;
use unicode_normalization::UnicodeNormalization;

fn key(password: &str, salt: &str) -> [u8; 64] {
    let normalized: String = password.nfkc().collect();
    let mut key = [0u8; 64];
    // AWS-LC needs slightly more than 32 MiB for its ROMix buffer and scratch blocks.
    // The pointers remain valid for this call, and AWS-LC writes exactly key.len() bytes.
    let result = unsafe {
        aws_lc_sys::EVP_PBE_scrypt(
            normalized.as_ptr().cast(),
            normalized.len(),
            salt.as_ptr(),
            salt.len(),
            16384,
            16,
            1,
            64 * 1024 * 1024,
            key.as_mut_ptr(),
            key.len(),
        )
    };
    assert_eq!(result, 1, "scrypt derivation failed");
    key
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn verify(hash: &str, password: &str) -> bool {
    let Some((salt, expected)) = hash.split_once(':') else {
        return false;
    };
    // Constant time, as the comparison of two hex strings of equal length is in practice.
    let actual = hex(&key(password, salt));
    actual.len() == expected.len()
        && actual
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |d, (a, b)| d | (a ^ b))
            == 0
}

/// A fresh hash, which sign-in computes for an unknown address so the answer takes as long.
pub fn hash(password: &str) -> String {
    let salt: [u8; 16] = rand::rng().random();
    let salt = hex(&salt);
    format!("{salt}:{}", hex(&key(password, &salt)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_better_auths_hashes() {
        // From better-auth/crypto's hashPassword.
        let hashed = "071710cd2c2fa1763453bf1482dca2da:edb03c843c67154697aceae268c793e9b949c9e39e0d444f9e4ecef881a2019028249ad4a1a9ab13ed7fd25a176bf57e83182606e561598f447bc6e3d2996296";
        assert!(verify(hashed, "snowtime-local"));
        assert!(!verify(hashed, "snowtime-locals"));
    }

    #[test]
    fn verifies_normalized_password_with_nul() {
        // Bun node:crypto with Better Auth's parameters and an NFKC password.
        let hashed = "071710cd2c2fa1763453bf1482dca2da:97f3210942050020df2e3291e162ac0094e3b21891f553524bc8776bb99a90a0eafc1f43a70a73b9144abc343498a597f07d7580ac733e87c49e8e12ba0179e4";
        assert!(verify(hashed, "Ｓnow\0time"));
        assert!(verify(hashed, "Snow\0time"));
        assert!(!verify(hashed, "Snow"));
    }

    #[test]
    fn verifies_its_own_hashes() {
        let hashed = hash("snowtime-local");
        assert!(verify(&hashed, "snowtime-local"));
        assert!(!verify(&hashed, "snowtime-locals"));
    }
}
