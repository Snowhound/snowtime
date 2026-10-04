use std::{hint::black_box, time::Instant};
use unicode_normalization::UnicodeNormalization;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let candidate = args.get(1).map(String::as_str).unwrap_or("aws-lc");
    let count: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(30);
    assert!(count >= 20);
    let password: String = "snowtime-local".nfkc().collect();
    let salt = b"071710cd2c2fa1763453bf1482dca2da";
    let expected = "edb03c843c67154697aceae268c793e9b949c9e39e0d444f9e4ecef881a2019028249ad4a1a9ab13ed7fd25a176bf57e83182606e561598f447bc6e3d2996296";
    let params = scrypt::Params::new(14, 16, 1).unwrap();
    let mut samples = Vec::new();
    for i in 0..count + 3 {
        let mut key = [0u8; 64];
        let start = Instant::now();
        match candidate {
            "aws-lc" => {
                // All pointers refer to live slices for the duration of this call.
                let result = unsafe {
                    aws_lc_sys::EVP_PBE_scrypt(
                        password.as_ptr().cast(),
                        password.len(),
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
                assert_eq!(result, 1);
            }
            "openssl" => openssl::pkcs5::scrypt(
                password.as_bytes(),
                salt,
                16384,
                16,
                1,
                64 * 1024 * 1024,
                &mut key,
            )
            .unwrap(),
            "rust" => scrypt::scrypt(password.as_bytes(), salt, &params, &mut key).unwrap(),
            _ => panic!("candidate must be aws-lc, openssl, or rust"),
        }
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        black_box(&key);
        assert_eq!(
            key.iter().map(|b| format!("{b:02x}")).collect::<String>(),
            expected
        );
        if i >= 3 {
            samples.push(ms);
        }
    }
    samples.sort_by(f64::total_cmp);
    let median = (samples[(count - 1) / 2] + samples[count / 2]) / 2.0;
    println!(
        "{candidate}: n={count}, median={median:.3} ms, min={:.3}, max={:.3}",
        samples[0],
        samples[count - 1]
    );
}
