use deno_core::{op2, v8};

#[op2]
#[buffer]
fn op_render_encode(scope: &mut v8::PinScope, text: v8::Local<v8::String>) -> Vec<u8> {
    let length = text.length();
    if length <= 256 {
        return deno_core::serde_v8::to_utf8(text, scope).into_bytes();
    }
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

deno_core::extension!(encoding_ops, ops = [op_render_encode]);
