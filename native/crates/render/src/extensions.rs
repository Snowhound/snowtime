#[path = "encoding.rs"]
mod encoding;

// Headers, Request, Response, and their body mixin, from deno_fetch 0.276.0's scripts in
// vendor/deno_fetch, without the crate: its ops and deno_net's open sockets, resolve DNS, and
// speak TLS, which no page needs. Keeping the extension's name keeps the scripts' specifiers.
deno_core::extension!(
    deno_fetch,
    deps = [deno_webidl, deno_web],
    lazy_loaded_js = [
        dir "vendor/deno_fetch",
        "20_headers.js",
        "21_formdata.js",
        "22_body.js",
        "22_http_client.js",
        "23_request.js",
        "23_response.js",
    ],
);

pub fn extensions() -> Vec<deno_core::Extension> {
    vec![
        encoding::encoding_ops::init(),
        deno_webidl::deno_webidl::init(),
        deno_web::deno_web::init(
            deno_web::BlobStore::default_arc(),
            None,
            false,
            Default::default(),
        ),
        deno_fetch::init(),
    ]
}
