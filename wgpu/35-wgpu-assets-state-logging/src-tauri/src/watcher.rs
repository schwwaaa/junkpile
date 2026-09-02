use crate::{
    assets::RuntimeAssets,
    renderer::RendererHandle,
    runtime::{LogLevel, StructuredLogger},
};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::{
    sync::mpsc::channel,
    thread,
    time::Duration,
};

pub struct HotReloadGuard {
    _watcher: RecommendedWatcher,
}

impl HotReloadGuard {
    pub fn start(
        assets: RuntimeAssets,
        renderer: RendererHandle,
        logger: StructuredLogger,
    ) -> Result<Self, String> {
        let (event_tx, event_rx) = channel::<Result<Event, notify::Error>>();
        let mut watcher = RecommendedWatcher::new(
            move |event| {
                let _ = event_tx.send(event);
            },
            Config::default().with_poll_interval(Duration::from_millis(200)),
        )
        .map_err(|error| format!("could not create asset watcher: {error}"))?;
        watcher
            .watch(assets.root(), RecursiveMode::Recursive)
            .map_err(|error| {
                format!(
                    "could not watch runtime assets at {}: {error}",
                    assets.root().display()
                )
            })?;

        logger.log(
            LogLevel::Info,
            "watcher",
            "watch_started",
            "recursive runtime asset watcher started",
            json!({ "root": assets.root().display().to_string() }),
        );

        thread::Builder::new()
            .name("junkpile-assets-state-watcher".into())
            .spawn(move || loop {
                match event_rx.recv() {
                    Ok(Ok(event)) => {
                        thread::sleep(Duration::from_millis(160));
                        while event_rx.try_recv().is_ok() {}

                        let changed_paths: Vec<String> = event
                            .paths
                            .iter()
                            .map(|path| path.display().to_string())
                            .collect();
                        let runtime_config_changed = event.paths.iter().any(|path| {
                            path.file_name()
                                .and_then(|value| value.to_str())
                                .map(|name| name.starts_with("runtime") && name.ends_with(".json"))
                                .unwrap_or(false)
                        });
                        if runtime_config_changed {
                            logger.log(
                                LogLevel::Info,
                                "config",
                                "restart_required",
                                "runtime platform configuration changed; restart required to re-resolve startup authority",
                                json!({ "paths": changed_paths.clone() }),
                            );
                        }

                        logger.log(
                            LogLevel::Debug,
                            "watcher",
                            "filesystem_event",
                            "asset filesystem event received",
                            json!({ "paths": changed_paths }),
                        );
                        match assets.load_bundle() {
                            Ok(bundle) => match renderer.apply_bundle(bundle, "filesystem hot reload") {
                                Ok(()) => logger.log(
                                    LogLevel::Info,
                                    "shader",
                                    "reload_complete",
                                    "validated assets replaced the live shader pipeline",
                                    json!({}),
                                ),
                                Err(error) => logger.log(
                                    LogLevel::Warn,
                                    "shader",
                                    "reload_rejected",
                                    "renderer rejected the candidate asset bundle",
                                    json!({ "error": error }),
                                ),
                            },
                            Err(error) => {
                                renderer.report_reload_failure("filesystem hot reload", error.clone());
                                logger.log(
                                    LogLevel::Warn,
                                    "shader",
                                    "validation_failed",
                                    "asset validation failed; last-known-good pipeline remains active",
                                    json!({ "error": error }),
                                );
                            }
                        }
                    }
                    Ok(Err(error)) => {
                        renderer.report_reload_failure(
                            "filesystem watcher",
                            format!("file watcher error: {error}"),
                        );
                        logger.log(
                            LogLevel::Error,
                            "watcher",
                            "watch_error",
                            "runtime asset watcher reported an error",
                            json!({ "error": error.to_string() }),
                        );
                    }
                    Err(_) => break,
                }
            })
            .map_err(|error| format!("could not start asset watcher thread: {error}"))?;

        Ok(Self { _watcher: watcher })
    }
}
