# Anima

[中文](./README.zh-CN.md) | [English](./README.en.md)

Anima is an AI desktop companion for macOS, built with Electron and a local Python backend.

![Anima Hero](https://your-image-host.example.com/anima/hero-en.png)

## Highlights

- Chat execution engine (sync + streaming)
- Multi-provider model configuration and model fetching
- Local tool calling (files, shell, web search/fetch, image/video generation)
- Skills system (`SKILL.md`-based, on-demand loading)
- Automation jobs (Cron scheduler)
- Optional Telegram channel integration
- Voice transcription stack (model management + transcription)
- Built-in Python backend bundled with the app
- Auto update via GitHub Releases

![Main UI Placeholder](https://your-image-host.example.com/anima/screenshot-main-en.png)

## Feature Details

### 1. Conversation and Run Engine

- Backend provides both `/api/runs` and `/api/runs?stream=1` (non-streaming + SSE streaming).
- Supports run resume (`/api/runs/{id}/resume`) and run retrieval (`/api/runs/{id}`).
- Chat history and run data are managed through dedicated chat APIs (`/api/chats/*`).

### 2. Model and Provider Management

- Multi-provider setup with model fetching via `/api/providers/fetch_models`.
- Built-in OpenAI Codex OAuth profile support in settings.
- Per-run overrides for provider/model and runtime options.

### 3. Tooling System (Builtin + MCP)

- Built-in tools include:
  - Workspace/file operations: `glob_files`, `list_dir`, `read_file`, `edit_file`, `write_file`, `rg_search`
  - Shell execution: `bash`
  - Web retrieval: `WebSearch`, `WebFetch`
  - Media generation: `screenshot`, `generate_image`, `generate_video`
  - Skill loading: `load_skill`
  - Automation controls: `cron_list`, `cron_upsert`, `cron_delete`, `cron_run`
- MCP tool discovery and unified listing are available through `/tools/list`.

### 4. Permission and Safety Controls

- `bash` supports two permission modes:
  - `workspace_whitelist` (default): restricted to workspace + whitelist roots
  - `full_access`: unrestricted mode
- Command blacklist/whitelist is configurable using command entries (not regex required).
- In default mode, blacklisted commands can require explicit human confirmation before execution.
- Web fetch pipeline blocks localhost/private-network targets by default to reduce SSRF risk.

### 5. Skills System

- Local skill scanning, frontmatter validation, and on-demand content loading.
- Settings APIs support listing skills, reading skill content, and opening the skills directory.
- Built-in skills and user-defined skills can coexist.

### 6. Automation (Cron Jobs)

- CRUD + manual trigger endpoints for jobs (`/api/cron/jobs` + `cron_run`).
- Supports one-time schedules, interval schedules, and cron expressions.
- Scheduler state is reconciled on backend startup.

### 7. Telegram Channel (Optional)

- Telegram integration is reconciled from settings at backend startup.
- Incoming Telegram messages can trigger runs and return responses.
- Reply pipeline supports text, image, document, and video payloads.

### 8. Voice Capabilities

- Voice model base dir/catalog/installed/download-status APIs.
- Transcription API (`/voice/transcribe`) and chunked voice stream APIs (`/voice/stream/*`).

### 9. Desktop and Dev Utilities

- Built-in PTY terminal service (create/write/resize/kill).
- Detects local preview URLs from terminal output and forwards them to UI.
- Integrated app update state flow (check/download/install).

## Requirements

- macOS
- Node.js + npm
- Python 3

## Development

```bash
npm install
npm run dev
```

If your Python path is custom:

```bash
ANIMA_PYTHON=/path/to/python3 npm run dev
```

## Build & Package (macOS)

```bash
npm install
npm run build
npm run dist:mac
```

Or directly:

```bash
npm install
npm run dist:mac
```

Artifacts are generated under `dist/`:

- `dist/*.dmg`
- `dist/*.zip`
- `dist/mac-*/Anima.app` (in some build modes)

## Auto Update

This project uses `electron-updater` + `electron-builder`. Once a release is published on GitHub Releases, the app can fetch and apply updates automatically.

![Updater Placeholder](https://your-image-host.example.com/anima/screenshot-updater-en.png)

## Release Flow

1. Bump `package.json` version and commit.
2. Tag and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. CI runs `npm run dist:mac:publish` and uploads artifacts to the tagged Release.

One-command release script:

```bash
npm run release -- 0.1.1
```

Or interactive:

```bash
npm run release
```

## FAQ

- Stale app icon: macOS may cache Dock/Finder icons. You can run `killall Dock` if needed.
- Unsigned/unnotarized build: Gatekeeper prompts may appear. Use right-click "Open" or remove quarantine:

```bash
xattr -dr com.apple.quarantine /Applications/Anima.app
```

## Project Structure (Simplified)

```text
.
├── src/              # Electron renderer/main/preload
├── pybackend/        # Local Python backend
├── skills/           # Built-in skills
├── build/            # Packaging assets
└── scripts/          # Build/release helper scripts
```

## License

[MIT](./LICENSE)
