#[path = "encoding.rs"]
mod encoding;

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
        deno_net::deno_net::init(None, None),
        deno_fetch::deno_fetch::init(Default::default()),
    ]
}
