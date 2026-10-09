use deno_core::{JsRuntime, RuntimeOptions, op2, v8};
use deno_error::JsErrorBox;
use std::{path::PathBuf, sync::OnceLock, time::Instant};

#[path = "../extensions.rs"]
mod extensions;

#[op2(fast)]
fn op_bench_now() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

#[op2]
#[buffer]
fn op_encode_rust(#[string] text: &str) -> Vec<u8> {
    text.as_bytes().to_vec()
}

#[op2]
#[buffer]
fn op_encode_simdutf(scope: &mut v8::PinScope, text: v8::Local<v8::String>) -> Vec<u8> {
    let length = text.length();
    if text.is_onebyte() {
        let mut input = vec![0; length];
        text.write_one_byte_v2(scope, 0, &mut input, v8::WriteFlags::empty());
        let mut output = vec![0; length * 2];
        // SAFETY: simdutf requires twice the Latin-1 input length in output capacity.
        let written = unsafe { v8::simdutf::convert_latin1_to_utf8(&input, &mut output) };
        output.truncate(written);
        output
    } else {
        let mut input = vec![0; length];
        text.write_v2(scope, 0, &mut input, v8::WriteFlags::empty());
        let mut output = vec![0; length * 3];
        // SAFETY: simdutf requires three bytes per UTF-16 code unit in output capacity.
        let written = unsafe { v8::simdutf::convert_utf16le_to_utf8(&input, &mut output) };
        if written == 0 && length != 0 {
            return deno_core::serde_v8::to_utf8(text, scope).into_bytes();
        }
        output.truncate(written);
        output
    }
}

fn without_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes)
}

#[op2]
#[string]
fn op_decode_rust(#[buffer] bytes: &[u8]) -> String {
    String::from_utf8_lossy(without_bom(bytes)).into_owned()
}

#[op2]
#[string]
fn op_decode_encoding_rs(#[buffer] bytes: &[u8]) -> String {
    encoding_rs::UTF_8
        .decode_without_bom_handling(without_bom(bytes))
        .0
        .into_owned()
}

#[op2]
fn op_decode_simdutf<'s, 'i>(
    scope: &mut v8::PinScope<'s, 'i>,
    #[buffer] bytes: &[u8],
) -> Result<v8::Local<'s, v8::String>, JsErrorBox> {
    let bytes = without_bom(bytes);
    let mut output = vec![0; bytes.len()];
    // SAFETY: UTF-16 output cannot use more code units than the input has UTF-8 bytes.
    let length = unsafe { v8::simdutf::convert_utf8_to_utf16le(bytes, &mut output) };
    if length == 0 && !bytes.is_empty() {
        return v8::String::new_from_utf8(scope, bytes, v8::NewStringType::Normal)
            .ok_or_else(|| JsErrorBox::range_error("string too long"));
    }
    v8::String::new_from_two_byte(scope, &output[..length], v8::NewStringType::Normal)
        .ok_or_else(|| JsErrorBox::range_error("string too long"))
}

#[op2]
#[string]
fn op_url_ada(#[string] input: &str, #[string] base: &str) -> Result<String, JsErrorBox> {
    ada_url::Url::parse(input, if base.is_empty() { None } else { Some(base) })
        .map(|url| url.href().to_owned())
        .map_err(|error| JsErrorBox::type_error(error.to_string()))
}

deno_core::extension!(
    candidates,
    ops = [
        op_bench_now,
        op_encode_rust,
        op_encode_simdutf,
        op_decode_rust,
        op_decode_encoding_rs,
        op_decode_simdutf,
        op_url_ada,
    ]
);

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    anyhow::ensure!(args.len() == 3, "web-api-bench <page-name> <results-dir>");
    let results = PathBuf::from(&args[2]);
    let html = std::fs::read_to_string(results.join(format!("{}-v8.html", args[1])))?;
    let answers: serde_json::Value =
        serde_json::from_slice(&std::fs::read(results.join("answers.json"))?)?;
    let page: serde_json::Value =
        serde_json::from_slice(&std::fs::read(results.join(format!("{}.json", args[1])))?)?;
    let trace: serde_json::Value = serde_json::from_slice(&std::fs::read(
        results.join(format!("profiles/{}-trace.apis.json", args[1])),
    )?)?;
    let inputs = serde_json::json!({ "page": args[1], "html": html, "answers": answers, "request": page, "trace": trace });
    let mut exts = extensions::extensions();
    exts.push(candidates::init());
    let mut runtime = JsRuntime::new(RuntimeOptions {
        create_params: Some(v8::CreateParams::default().heap_limits(0, 128 << 20)),
        startup_snapshot: Some(include_bytes!(concat!(env!("OUT_DIR"), "/render.bin"))),
        extensions: exts,
        ..Default::default()
    });
    runtime.execute_script(
        "bench-inputs.js",
        format!("globalThis.benchInputs = {inputs}"),
    )?;
    runtime.execute_script(
        "js-encoding.js",
        include_str!("../../bundle/bench/dist/js-encoding.js"),
    )?;
    let value = runtime.execute_script(
        "api-microbench.js",
        include_str!("../../bundle/bench/api-microbench.js"),
    )?;
    let promise = runtime.resolve(value);
    runtime
        .with_event_loop_promise(promise, Default::default())
        .await?;
    Ok(())
}
