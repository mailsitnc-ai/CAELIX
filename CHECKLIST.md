# CAELIX — Verification Checklist

End-to-end audit against [`features.md`](features.md) and [`SPEC.md`](SPEC.md).

Markers:
- `[x]` — Verified directly by automated check, CLI run, or self-check on this machine.
- `[ ]` — Implemented in code, not live-verified here (explicit blocker noted).

---

## 1. Agent Harness (`features.md` §1)

- [x] **Projects** — Workspace scoping enforced (`ToolRunner.resolvePath` blocks outside paths and symlinks escaping root), recent projects stored (`sessions:list`), verified via `npm run selfcheck` ("create a chat in the test folder", "protected paths refuse a bypass write").
- [x] **Chats** — Create, rename, delete, search, switch, and reload persistence verified in `npm run selfcheck` (`CAELIX self-check chat` renamed, deleted inline `3 → 2`, and `9 messages restored` after renderer reload).
- [x] **System prompt** — Includes CAELIX identity, active mode rules, project folder, 19 available tool names, current task list, and loaded project memory; verified via `npm run selfcheck` ("memory saves and reaches the system prompt", "context report counts the whole turn").
- [x] **Project memory** — Loads `CAELIX.md`, `AGENTS.md`, `.caelix/CAELIX.md` and `@import` references up to depth 3 while blocking path traversal (`@../../etc/passwd`); verified in `npm run selfcheck` and `node checks/verify_features.js`.
- [x] **Modes** — `ask` (Manual), `accept` (Accept edits), `plan` (Plan), `bypass` (Bypass permissions) verified across UI chip switching (`npm run selfcheck`) and headless CLI (`node checks/verify_features.js`: `ask` denies without `--yes` and allows with `--yes`, `accept` writes directly, `plan` denies `write_file`).
- [x] **Permissions** — Blocking inline permission card (`Always allow`, `Allow once`, `Cancel`) verified on `write_file` and `web_search` in `npm run selfcheck`; `.git/config` protected-path refusal verified even in `bypass` mode.
- [x] **Streaming** — Token/word-by-word delta rendering (`121 ms` to first words in source self-check, `106 ms` in packaged self-check) and in-place tool cards verified in `npm run selfcheck`.
- [x] **Cancellation** — `Engine.stop(sessionId)` aborts mid-stream turn cleanly (`Cancelled.`) and terminates subprocesses; verified in `node checks/verify_features.js`.
- [x] **Context control & compaction** — Category token report (`System and memory`, `Messages`, `Tool results`) verified in `npm run selfcheck` (`434` / `437` tokens); `>100k` token compaction preserving full saved transcript verified in `node checks/verify_features.js`.
- [x] **Retries & rate-limit countdown** — Patient `429` retry up to 5 attempts honoring `Retry-After` and exponential backoff (`2s`–`45s`) with live countdown events (`retry`), plus bounded retries for `408`/`5xx`/network errors, verified against local mock HTTP servers in `node checks/verify_features.js`.
- [x] **Structured error recovery** — Unwraps array/object API errors (including Gemini `403 [{ "error": ... }]`), removes typing indicator dots cleanly, and shows quick `Open Keys` / `Switch Model` buttons.
- [x] **Usage telemetry** — Token count and elapsed time recorded per turn and rendered in composer footer and status strip (`checks/steps/09-context-report.png`, `11-light-theme.png`).
- [x] **Slash commands, `/compact` & `/btw`** — Autocomplete `/` menu and execution of `/compact`, `/btw` (ephemeral side note excluded from session history), `/helper`, `/mcp`, `/hooks`, `/memory`, `/keys`, `/model`, `/mode`, `/context`, `/cost`, `/usage`, `/status`, `/review`, `/export`, `/clear`, `/new`, and `/help` verified in `npm run selfcheck` and `node checks/verify_features.js`.

---

## 2. Harness Tools (`features.md` §1 · `node src/cli.js tools` → `19 tools.`)

- [x] `read_file` — Line-numbered text slices and base64 image blocks (`pixel.png`) verified in `npm run selfcheck`.
- [x] `write_file` — File creation, unified diff emission, permission gating verified in `npm run selfcheck`.
- [x] `edit_file` / `multi_edit` — Atomic multi-replacement edit (`caelix-note.md`) verified in `npm run selfcheck`.
- [x] `list_dir` / `glob` / `grep` — Workspace-confined listing, mtime-sorted pattern match, JS fallback grep verified via `node src/cli.js tools` and harness `ToolRunner`.
- [x] `bash` — Interactive persistent shell tabs and non-interactive shell execution verified in `npm run selfcheck` ("run a command in the terminal panel", "open a second terminal tab and keep its shell state").
- [x] `todo_write` — Checklist state persisted and rendered in `#todo-bar` (`1/3 done`) in `npm run selfcheck`.
- [x] `web_fetch` — Registered tool schema (`node src/cli.js tools`) with mandatory `network` permission gate (`ToolRunner.webFetch`). Live external URL fetch not executed offline.
- [x] `web_search` — Permission gate denial without hanging verified in `npm run selfcheck`; registered in `19 tools.`. Live external DuckDuckGo search not executed offline.
- [x] `notebook_edit` — `.ipynb` `read`, `insert`, `replace`, and `delete` preserving JSON cell structure verified in `npm run selfcheck` (`demo.ipynb`) and `node checks/verify_features.js`.
- [x] `task_start` / `task_output` / `task_stop` — Background process lifecycle verified in `npm run selfcheck` ("background task starts, lists and stops").
- [x] `skill` — Local skill discovery (`SKILLS.md` / `.agents/skills/*/SKILL.md` / `CAELIX.md`) verified in `npm run selfcheck`.
- [x] `present_plan` & `ask_user` — Plan card and interactive/headless question cards verified in `npm run selfcheck` and `node src/cli.js run`.
- [x] `subagent` & Helper Agent — Read-only `subagent` tool, live step/summary card (`Helper Agent`), UI launcher modal (`Helper`), and `/helper` command verified in `npm run selfcheck`.
- [x] **MCP servers (`src/engine/mcp.js`)** — Stdio and HTTP MCP client support (`.mcp.json` & user `mcp.json`), dynamic `mcp__<server>__<tool>` registration/execution, and UI management modal verified in `node checks/verify_features.js` and `npm run selfcheck`.
- [x] **Hooks (`src/engine/hooks.js`)** — `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` shell hooks (`.caelix/hooks.json` & user `hooks.json`) with JSON stdin and exit-code `2` blocking + UI modal verified in `node checks/verify_features.js` and `npm run selfcheck`.

---

## 3. Command Line (`features.md` §1)

- [x] `node src/cli.js --help` — Verified exit `0`.
- [x] `node src/cli.js tools` — Verified exit `0`, prints `19 tools.`
- [x] `node src/cli.js doctor` — Verified exit `0`, checks Node.js, Electron binary, assets (`icon.svg`, `icon-1024.png`, `icon.icns`), Git, optional Claude CLI path, `keys.enc`, and engine.
- [x] `node src/cli.js run "<prompt>" --cwd ... --provider simulator --mode ... [--yes] [--json]` — Verified in `ask`, `ask --yes`, `accept`, `plan` modes with NDJSON events (`node checks/verify_features.js`).

---

## 4. Code View, Speed, Packaging & Visual Target (`features.md` §2, §4–§6 · `SPEC.md` §7)

- [x] **Three-column layout & proportions** — `48 px` top bar with traffic-light inset, `260 px` left sidebar (collapsed `56 px`), max `800 px` centered transcript & composer (`16 px` radius), `380 px` right panel (`Changes`, `Terminal`, `Context`), dark default + light theme (`checks/steps/01-empty-state.png`, `checks/selfcheck.png`, `checks/steps/11-light-theme.png`).
- [x] **Remaining surfaces implemented & checked** — File/image attachments + drag-drop + `@` mentions, inline checkpoints + restore, system prompt inspector, missing-key Send gate, bypass warning banner, Normal/Verbose (`Ctrl+O`), keyboard shortcuts (`Cmd+N`, `Cmd+\`, `Cmd+B`, `Cmd+K`, `Ctrl+O`, `` Ctrl+` ``, `Esc`), desktop notifications when unfocused.
- [x] **Startup & memory budgets (`< 2000 ms`)**:
  - Source self-check (`env -u ELECTRON_RUN_AS_NODE npm run selfcheck`): `22/22` steps passed, `window 539 ms`, `first paint 106.8 ms`, working set `379 MB`, `0` errors.
  - Packaged bundle (`dist/CAELIX.app`, `codesign --verify --strict` exit `0`): `22/22` steps passed, `window 515 ms`, `first paint 110.3 ms`, working set `336 MB`, `0` errors.
- [x] **CAELIX branding & Desktop shortcut** — Four-point star SVG/PNG/`.icns` assets used across window, Dock, bundle `Info.plist`, and `/Users/shivam/Desktop/CAELIX.app` (`scripts/package.js`).

---

## 5. External Providers (`features.md` §3)

- [x] **Encrypted local keystore (`safeStorage`)** — Save, mask (`••••••••real`), reload exclusion from renderer, and delete verified in `npm run selfcheck`; `keys.enc` stored in macOS Application Support outside repository.
- [x] **NVIDIA NIM & Groq catalogs & sync** — `36` curated NVIDIA models (`deepseek-ai/deepseek-v4.1-flash` default) + live `/v1/models` sync, **Groq** (`groq`) curated chat/coding models + live `/openai/v1/models` sync, `35s` idle/first-byte stall timeout, and `delta.reasoning_content` status feedback verified in `node checks/verify_features.js` and `npm run selfcheck`.
- [ ] **Live Gemini / OpenRouter / NVIDIA / Groq API keys** — Request formatting, SSE parser, 5-attempt `429` countdown retry loop, array error parsing, model catalog refresh (`providers:refresh`), and custom model ID entry are implemented and SSE+retry+timeout tested against local mock HTTP servers (`node checks/verify_features.js`), but live keyed inference calls were not run without user API keys.
- [ ] **Optional real `claude` CLI provider** — `Engine.runClaude` JSON-stream subprocess integration implemented and binary detected at `~/.local/bin/claude`, but blocked from live execution because local CLI auth state is unauthenticated (`loggedIn: false`).

