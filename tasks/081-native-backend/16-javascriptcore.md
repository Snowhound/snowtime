# 081.16: JavaScriptCore as the render engine

Status: todo

On the same bundle, Bun runs Solid's synchronous render in 7.3 ms where V8 takes 12.7
([engine-gap report](server-rendering/engine-gap-wsl.md)). JSC's DFG tier is worth 37% to
Bun, while TurboFan is worth 5% to V8. Task 081.14 is expected to leave V8 at about 1.4–1.5
times Bun's CPU. This task checks whether embedding JSC would close that gap, before
anyone builds it.

The engine spike (subtask 01) found the macOS system JSC, through its C API, slower than
V8 on this bundle (16.9 vs 13.7 ms on the timer). So Bun's speed may come from its own
WebKit build, its options, or its native APIs rather than JSC itself. The spike also saw
JSC grow to 300–400 MB of RSS under back-to-back renders.

## Gate: plain JSC on Linux

Before any Rust work, run the render bundle in the `jsc` shell of Bun's prebuilt Linux
WebKit (`oven-sh/WebKit`), with the same answers, phase timers, and limits as the report:

- If JSC's phase B is within about 15% of Bun's and its RSS fits the host's budget, build
  the prototype below.
- Otherwise Bun's lead is specific to Bun. Record that, and compare a Bun render sidecar
  with V8 after task 081.14 instead.

## Prototype

A renderer behind the same interface as the V8 one (`Pool`, `PageRequest`, `Page`), so
the host picks the engine at build time. JSC lacks a startup snapshot, so measure renderer
start. Take from Bun only what fits a narrow C++ glue layer (encoding, streams); vendoring
Bun's bindings layer means maintaining a fork of Bun's internals.

## Licensing

Parts of JavaScriptCore are LGPL-2.1. Snowtime and the porting kit being open source lets
users relink a statically linked binary, which LGPL requires. Distributed binaries and
images still need the license notices and the WebKit source with our changes. A porting
kit user who ships closed-source binaries takes on the same obligations, so the kit keeps
V8 (BSD-3-Clause) as an option and documents when to pick each.

## Acceptance criteria

- [ ] The gate run recorded: JSC shell, Bun, and V8 on the four pages, with phases A, B,
      and C, CPU, and RSS, and the decision it leads to
- [ ] If the gate passes: a JSC renderer behind the V8 renderer's interface, passing the
      render tests and hydration on all four pages
- [ ] If the gate passes: CPU, p95, renderer start, and RSS at one renderer and at the
      host's renderer count, against V8 after task 081.14 and against Bun
- [ ] If the gate fails: a Bun sidecar measured the same way, against V8 after task 081.14
- [ ] The LGPL obligations for Snowtime's images and for porting kit users checked and
      written into the porting kit, with V8 kept as the engine for closed-source ports
