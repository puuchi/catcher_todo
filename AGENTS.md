# FloatTodo Project Guide

## Product and runtime

- FloatTodo is a compact Electron desktop app for Windows and macOS. Entry: src/main.js; UI: src/index.html. No backend service is required.
- Keep the existing todo, current-activity, timeline and recycle workflows. Main-window close returns to the bubble; explicit quit saves state and prompts when a timer is running.
- Todo notes are optional strings and must remain compatible with legacy records, archives and recycled todos.

## Interface source of truth

- Use a warm ivory surface, forest green actions, sage secondary surfaces and restrained terracotta urgency. Preserve a light appearance and clear task hierarchy.
- src/style.css owns design tokens, window chrome, tabs, todos and appearance controls. src/activity.css owns current activity, timeline, detail, editor and recycle surfaces. Edit the owning rules rather than adding competing override layers.
- Bundled Manrope and Fraunces fonts live in assets/fonts with their OFL licenses. Do not introduce remote font requests or runtime network dependencies.
- Keep UI IDs, data-page attributes, keyboard support, native titlebar drag regions and readable layouts at 270px width. Icons are created by src/ui-icons.js; avoid mixing emoji and unrelated icon styles.
- Reference sources and visual QA entry point are documented in README.md. Update this guide and README when the architecture or design direction changes.

## Reliability and verification

- Fail visibly. Preserve original data on malformed storage or save failures; log context and present a useful error. Do not swallow exceptions or replace corrupt data with empty records.
- Use Windows-native launch commands. Prefer apply_patch for existing files and Python pathlib with explicit UTF-8 for new files or batch generation. Do not write file content using PowerShell redirection or Set-Content.
- npm test runs storage, timeline, recycle and window-boundary unit tests. npm run test:electron runs isolated Electron interaction suites. node test/design-qa.cjs captures layouts and checks bounds at 270x360, 320x480 and 400x600 without touching user data.
- Native always-on-top verification has a separately reproduced Electron/Windows limitation on this machine. Never silently remove that assertion; record any explicit FLOATODO_SKIP_NATIVE_PIN=1 validation separately.
