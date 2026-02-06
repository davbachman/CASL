Original prompt: OK, let's add some I/O. When you open up the history pane, there should be a button to print history. There should be a save and import buttons somewhere to save custom defined tools, and import saved tools. There should also be Save and Import Construction buttons to save all work, and resume where you left off.

## Work log
- Added toolbar controls for saving/importing tools and full construction snapshots.
- Added hidden file inputs and import handlers.
- Added history pane `Print History` action with print-friendly popup rendering.
- Added tool JSON serialization/deserialization with ID remapping to avoid collisions.
- Added full construction serialization/deserialization (docs, views, custom tools, active geometry/tool, show steps), with undo stack reset on import.
- Added basic normalization for imported docs/views and active tool fallback behavior.
- Replaced the top control strip with a real menubar (`File`, `Model`, `Edit`, `Window`) and wired each item to existing app actions.
- Added menu UI state syncing for selected model and Show/Hide History enablement.
- Renamed `Window` to `View` and added `Show Steps` / `Hide Steps` commands wired to step-visibility toggle state.
- Updated save actions to use native save-file dialogs (`showSaveFilePicker`) for choosing filename/location when supported.
- Fixed menubar command routing to call app actions directly (instead of synthetic hidden-button clicks) so save dialogs retain trusted user activation.
- Exposed `createApp` command API and routed menubar actions through it to avoid user-activation loss for dialog APIs.
- Added legacy Chromium save-dialog support (`chooseFileSystemEntries`) and improved blocked-permission detection for native save dialogs.
- Added Safari-specific save helper window fallback with explicit "Download Linked File As..." instructions and copy-JSON option.

## Notes
- JavaScript runtime syntax check was not run because `node` is not available in the current environment.

## Next TODOs
- Manually test import/export round-trip in browser with multiple geometries and custom tools.
- Manually verify popup print flow in browsers with strict popup blocking settings.
- Manually test menubar behavior (outside click close, Escape close, menu command routing).
