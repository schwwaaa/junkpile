# ShadeCore Parity — Runtime Infrastructure

This example ports the following ShadeCore concepts into the native wgpu track:

| ShadeCore concept | Example 35 implementation |
|---|---|
| Asset directory override | CLI, `JUNKPILE_ASSETS`, and `SHADECORE_ASSETS` |
| Log file override | CLI, `JUNKPILE_LOG_FILE`, and `SHADECORE_LOG_FILE` |
| Platform configuration | base config plus macOS/Windows/Linux overlay |
| Editable external assets | copied built-ins in a writable runtime root |
| Filesystem watching | recursive debounced watcher |
| Last-known-good shader | transactional Naga + wgpu pipeline replacement |
| Runtime selection state | atomically persisted shader/profile/parameter targets |
| Structured diagnostics | JSONL file plus bounded in-memory ring |
| Explicit ownership | startup policy, live selection, watcher, state, and logger remain separate |

This milestone does not implement media sinks. Recording, NDI, preview modes, and frame contracts remain isolated in their dedicated examples.
