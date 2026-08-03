use crate::{assets::RuntimeAssets, renderer::RendererHandle};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    sync::mpsc::channel,
    thread,
    time::Duration,
};

pub struct HotReloadGuard {
    _watcher: RecommendedWatcher,
}

impl HotReloadGuard {
    pub fn start(assets: RuntimeAssets, renderer: RendererHandle) -> Result<Self, String> {
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

        thread::Builder::new()
            .name("junkpile-shader-asset-watcher".into())
            .spawn(move || loop {
                match event_rx.recv() {
                    Ok(Ok(_)) => {
                        thread::sleep(Duration::from_millis(160));
                        while event_rx.try_recv().is_ok() {}
                        match assets.load_bundle() {
                            Ok(bundle) => {
                                let _ = renderer.apply_bundle(bundle, "filesystem hot reload");
                            }
                            Err(error) => {
                                renderer.report_reload_failure("filesystem hot reload", error);
                            }
                        }
                    }
                    Ok(Err(error)) => {
                        renderer.report_reload_failure(
                            "filesystem watcher",
                            format!("file watcher error: {error}"),
                        );
                    }
                    Err(_) => break,
                }
            })
            .map_err(|error| format!("could not start asset watcher thread: {error}"))?;

        Ok(Self { _watcher: watcher })
    }
}
