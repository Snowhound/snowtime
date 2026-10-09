# Third-party licenses

`generate.sh` writes `native/THIRD_PARTY_LICENSES`, which the release image copies to
`/usr/share/doc/snowtime/`. Run it after any change to `Cargo.lock`, with
[cargo-about](https://github.com/EmbarkStudios/cargo-about) 0.9 installed and the crates
fetched (`cargo fetch`):

```sh
native/licenses/generate.sh
```

The v8 crate on crates.io ships no license files, so `v8/` holds the ones for the code its
prebuilt Linux library contains, found by the source paths compiled into
`librusty_v8_simdutf_release_x86_64-unknown-linux-gnu.a` 149.4.0. They come from
[rusty_v8 v149.4.0](https://github.com/denoland/rusty_v8/tree/v149.4.0) and the submodule
revisions it pins:

| Files                     | Repository                            | Revision   |
| ------------------------- | ------------------------------------- | ---------- |
| `rusty_v8.LICENSE`        | `denoland/rusty_v8`                   | `v149.4.0` |
| `v8.*`, `v8-*`            | `denoland/v8`                         | `73d1969`  |
| `icu.LICENSE`             | `chromium/deps/icu`                   | `ee5f27a`  |
| `abseil.LICENSE`          | `chromium/src/third_party/abseil-cpp` | `5e42a36`  |
| `libcxx.LICENSE`          | `llvm/llvm-project` libcxx mirror     | `99457fa`  |
| `libcxxabi.LICENSE`       | `llvm/llvm-project` libcxxabi mirror  | `8f11bb1`  |
| `llvm-libc.LICENSE`       | `llvm/llvm-project` libc mirror       | `cb95278`  |
| `highway.LICENSE`         | `google/highway` mirror               | `2607d3b`  |
| `simdutf.LICENSE`         | `chromium/src/third_party/simdutf`    | `f7356ee`  |
| `fp16.LICENSE`            | `Maratyszcza/FP16`                    | `3d2de18`  |
| `fast_float.LICENSE-MIT`  | `fastfloat/fast_float` mirror         | `05087a3`  |
| `dragonbox.LICENSE-Boost` | `jk-jeon/dragonbox` mirror            | `beeeef9`  |

Replace them when the v8 crate's version changes. V8's `third_party/glibc` (its `sin` and
`cos`) is under LGPL-2.1; task 081.37 records what that asks of a binary release.
