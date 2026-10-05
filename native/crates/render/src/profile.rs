use deno_core::{InspectorSessionKind, JsRuntime, JsRuntimeInspector, LocalInspectorSession};
use std::{cell::RefCell, path::PathBuf, rc::Rc};

pub(crate) struct Profile {
    path: PathBuf,
    renders: usize,
    count: usize,
    session: LocalInspectorSession,
    output: Rc<RefCell<Option<serde_json::Value>>>,
    trace: bool,
}

impl Profile {
    pub(crate) fn enabled() -> bool {
        std::env::var_os("RENDER_CPU_PROFILE").is_some()
    }

    pub(crate) fn new(runtime: &mut JsRuntime) -> Option<Self> {
        let path = PathBuf::from(std::env::var_os("RENDER_CPU_PROFILE")?);
        let count = std::env::var("RENDER_PROFILE_COUNT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(500);
        let output = Rc::new(RefCell::new(None));
        let result = output.clone();
        let trace_path = path.with_extension("apis.json");
        let session = JsRuntimeInspector::create_local_session(
            runtime.inspector(),
            Box::new(move |message| {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&message.content) {
                    if let Some(profile) = value.pointer("/result/profile") {
                        *result.borrow_mut() = Some(profile.clone());
                    } else if value.get("id").and_then(|id| id.as_i64()) == Some(5) {
                        if let Some(text) = value
                            .pointer("/result/result/value")
                            .and_then(|v| v.as_str())
                            && let Err(error) = std::fs::write(&trace_path, text)
                        {
                            eprintln!("Cannot write API trace: {error}");
                        }
                    } else if let Some(error) = value.get("error") {
                        eprintln!("CPU profiler: {error}");
                    }
                }
            }),
            InspectorSessionKind::NonBlocking {
                wait_for_disconnect: false,
            },
        );
        let trace = std::env::var_os("RENDER_API_TRACE").is_some();
        Some(Self {
            path,
            count,
            renders: 0,
            session,
            output,
            trace,
        })
    }

    pub(crate) fn before(&mut self) {
        // render-bench renders once, then warms up with 50 pages.
        if self.renders == 51 {
            if self.trace {
                self.session.post_message(
                    6,
                    "Runtime.evaluate",
                    Some(
                        serde_json::json!({ "expression": include_str!("../bundle/api-trace.js") }),
                    ),
                );
            }
            self.session
                .post_message(1, "Profiler.enable", None::<serde_json::Value>);
            self.session.post_message(
                2,
                "Profiler.setSamplingInterval",
                Some(serde_json::json!({ "interval": 1000 })),
            );
            self.session
                .post_message(3, "Profiler.start", None::<serde_json::Value>);
        }
    }

    pub(crate) fn after(&mut self) {
        self.renders += 1;
        if self.trace && self.renders == 52 {
            self.session.post_message(5, "Runtime.evaluate",
                Some(serde_json::json!({ "expression": "JSON.stringify(renderApiCalls)", "returnByValue": true })));
        }
        if self.renders == 51 + self.count {
            self.session
                .post_message(4, "Profiler.stop", None::<serde_json::Value>);
            if let Some(profile) = self.output.borrow_mut().take() {
                let bytes = serde_json::to_vec(&profile).expect("CPU profile is JSON");
                if let Err(error) = std::fs::write(&self.path, bytes) {
                    eprintln!("Cannot write CPU profile {}: {error}", self.path.display());
                }
            }
        }
    }
}
