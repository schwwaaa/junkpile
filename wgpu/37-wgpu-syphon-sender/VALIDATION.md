# Validation Record

## Static validation completed

- Tauri product name contains no forbidden filesystem characters.
- JavaScript syntax checked with Node.
- Every `byId()` reference resolves to an HTML element.
- Every invoked Tauri command is registered.
- Rust source delimiter counts are balanced.
- No stale NDI dependency or command remains outside historical documentation references.
- Objective-C bridge declarations match Rust FFI declarations.
- Vendored Syphon framework contains both arm64 and x86_64 slices.
- Package excludes Cargo target and node_modules directories.
- ZIP integrity verified.

## Runtime validation required on macOS

1. Compile and launch with `npm run dev`.
2. Confirm the build warning identifies the vendored Syphon framework.
3. Start the source at 1080p60.
4. Confirm `Junkpile 37` appears in a Syphon receiver.
5. Confirm client status changes to connected.
6. Confirm live animation appears in the receiver.
7. Test stop/start lifecycle.
8. Test source rename.
9. Test 1440p60 and 4K30.
10. Confirm renderer remains responsive if the receiver disconnects.
