#[path = "src/extensions.rs"]
mod extensions;
fn main() {
    println!("cargo:rerun-if-env-changed=RENDER_PROTOTYPE_PROPS");
    let path = match std::env::var("RENDER_PROTOTYPE_PROPS").as_deref() {
        Ok("1") => "bundle/dist/render.prototype.js",
        Ok("0") | Err(_) => "bundle/dist/render.js",
        _ => panic!("RENDER_PROTOTYPE_PROPS must be 0 or 1"),
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
