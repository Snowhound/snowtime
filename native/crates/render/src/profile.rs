use deno_core::{InspectorSessionKind, JsRuntime, JsRuntimeInspector, LocalInspectorSession};
use std::{cell::RefCell, path::PathBuf, rc::Rc};

#[derive(serde::Deserialize)]
struct ProfileResponse {
    result: ProfileResult,
}
#[derive(serde::Deserialize)]
struct ProfileResult {
    profile: Box<serde_json::value::RawValue>,
}

pub(crate) struct Profile {
    path: PathBuf,
    renders: usize,
    count: usize,
    session: LocalInspectorSession,
    output: Rc<RefCell<Option<Box<serde_json::value::RawValue>>>>,
    trace: bool,
    allocations: bool,
}

impl Profile {
    pub(crate) fn enabled() -> bool {
        std::env::var_os("RENDER_CPU_PROFILE").is_some()
            || std::env::var_os("RENDER_ALLOCATION_PROFILE").is_some()
    }

    pub(crate) fn new(runtime: &mut JsRuntime) -> Option<Self> {
        let allocations = std::env::var_os("RENDER_ALLOCATION_PROFILE").is_some();
        let path = PathBuf::from(
            std::env::var_os("RENDER_ALLOCATION_PROFILE")
                .or_else(|| std::env::var_os("RENDER_CPU_PROFILE"))?,
        );
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
                // Keep deep allocation trees as raw JSON instead of parsing and cloning them.
                if let Ok(response) = serde_json::from_str::<ProfileResponse>(&message.content) {
                    *result.borrow_mut() = Some(response.result.profile);
                } else if let Ok(value) =
                    serde_json::from_str::<serde_json::Value>(&message.content)
                {
                    if value.get("id").and_then(|id| id.as_i64()) == Some(5) {
                        if let Some(text) = value
                            .pointer("/result/result/value")
                            .and_then(|v| v.as_str())
                            && let Err(error) = std::fs::write(&trace_path, text)
                        {
                            eprintln!("Cannot write API trace: {error}");
                        }
                    } else if let Some(error) = value.get("error") {
                        eprintln!("Render profiler: {error}");
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
            allocations,
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
            if self.allocations {
                self.session
                    .post_message(1, "HeapProfiler.enable", None::<serde_json::Value>);
                self.session.post_message(
                    3,
                    "HeapProfiler.startSampling",
                    Some(serde_json::json!({"samplingInterval": 131072,
                        "includeObjectsCollectedByMajorGC": true,
                        "includeObjectsCollectedByMinorGC": true})),
                );
                return;
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
        if self.renders == 51 + self.count {
            self.session.post_message(
                4,
                if self.allocations {
                    "HeapProfiler.stopSampling"
                } else {
                    "Profiler.stop"
                },
                None::<serde_json::Value>,
            );
        }
    }

    pub(crate) fn after(&mut self) {
        self.renders += 1;
        if self.renders == 52 + self.count
            && let Some(profile) = self.output.borrow_mut().take()
            && let Err(error) = std::fs::write(&self.path, profile.get())
        {
            eprintln!(
                "Cannot write render profile {}: {error}",
                self.path.display()
            );
        }
        if self.trace && self.renders == 52 {
            self.session.post_message(5, "Runtime.evaluate",
                Some(serde_json::json!({ "expression": "JSON.stringify(renderApiCalls)", "returnByValue": true })));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ProfileResponse;

    #[test]
    fn preserves_deep_allocation_profiles() {
        let profile = format!("{}0{}", "[".repeat(256), "]".repeat(256));
        let message = format!(r#"{{"id":4,"result":{{"profile":{profile}}}}}"#);
        let response: ProfileResponse = serde_json::from_str(&message).unwrap();
        assert_eq!(response.result.profile.get(), profile);
        assert!(serde_json::from_str::<serde_json::Value>(&message).is_err());
    }
}
