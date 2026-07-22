# wgpu 29 migration notes used by these examples

These notes capture the compiler issues encountered while validating examples `00` through `03` and the conventions used in `04` through `07`.

## Presenting a frame

```rust
self.queue.submit([encoder.finish()]);
frame.present();
```

Do not call `queue.present(frame)` with wgpu 29.

## Pipeline layouts

```rust
let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
    label: Some("pipeline layout"),
    bind_group_layouts: &[Some(&bind_group_layout)],
    immediate_size: 0,
});
```

The bind-group layout entries are optional references. `push_constant_ranges` is not the wgpu 29 field used by these examples.

## Instance descriptors

```rust
let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
    backends: wgpu::Backends::PRIMARY,
    ..wgpu::InstanceDescriptor::new_without_display_handle()
});
```

Do not use `..Default::default()` for `InstanceDescriptor` in wgpu 29.

## Standalone Cargo workspaces

Each example ends its `src-tauri/Cargo.toml` with:

```toml
[workspace]
```

This prevents Cargo from accidentally inheriting an unrelated or malformed workspace manifest located higher in the filesystem.
