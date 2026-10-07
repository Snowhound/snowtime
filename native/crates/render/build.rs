#[path = "src/extensions.rs"]
mod extensions;
fn main() {
    println!("cargo:rerun-if-env-changed=RENDER_PROPS");
    let path = match std::env::var("RENDER_PROPS").as_deref() {
        Ok("plain") | Err(_) => "bundle/dist/render.js",
        Ok("prototype") => "bundle/dist/render.prototype.js",
        Ok("shared") => "bundle/dist/render.shared.js",
        _ => panic!("RENDER_PROPS must be plain, prototype, or shared"),
    };
    let bundle = std::fs::read_to_string(path)
        .expect("Build the render bundle first: bun native/crates/render/bundle/build.ts");
    println!("cargo:rerun-if-changed={path}");
    println!("cargo:rerun-if-changed=bundle/dist/manifest.json");
    println!("cargo:rerun-if-changed=bundle/bootstrap.js");
    println!("cargo:rerun-if-changed=src/extensions.rs");
    println!("cargo:rerun-if-changed=src/encoding.rs");
    let snapshot = deno_core::snapshot::create_snapshot(
        deno_core::snapshot::CreateSnapshotOptions {
            cargo_manifest_dir: env!("CARGO_MANIFEST_DIR"),
            extensions: extensions::extensions(),
            with_runtime_cb: Some(Box::new(move |runtime| {
                runtime
                    .execute_script("bootstrap.js", include_str!("bundle/bootstrap.js"))
                    .unwrap();
                runtime.execute_script("render.js", bundle.clone()).unwrap();
            })),
            startup_snapshot: None,
            skip_op_registration: false,
            extension_transpiler: None,
        },
        None,
    )
    .unwrap();
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    std::fs::write(out.join("render.bin"), snapshot.output).unwrap();
    std::fs::copy("bundle/dist/manifest.json", out.join("manifest.json")).unwrap();
}
