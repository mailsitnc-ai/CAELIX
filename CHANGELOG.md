# CAELIX changelog

## 0.1.16 — Smart context efficiency, expanded 2M window, and automatic `/reset`

- **Smart context efficiency & expanded window (`src/engine/tools.js`, `src/engine/index.js`):** Raised the local rolling chat window (`contextLimit`) to `2,000,000` (`1,000,000` on Groq), updated `contextReport()` to measure trimmed active AI memory instead of raw historical tool dumps, added default `300`-line / `16,000`-char smart slicing and long-line capping in `read_file` with tighter `list_dir`/`glob`/`grep` output caps, and added context-discipline guidance (`grep`/`glob` before `read_file`) to `systemPrompt()`.
- **Automatic `/reset` on threshold (`src/engine/index.js`, `src/renderer/app.js`):** Added automatic `/reset` rollover (`autoResetPercent: 70`, displayed in the Context tab) right after a completed turn reaches threshold, running `resetContext()` seamlessly, preserving scroll above the reset divider, carrying forward the compact `resetHandoff` summary, and emitting `auto-reset` to update the UI live.
- **Verified:** Extended `checks/verify_features.js` with smart-slicing + 2M trimmed-memory checks and `auto-reset` rollover verification; ran `npm run package`, `doctor`, `verify_features.js`, `terminal-probe.js`, and `selfcheck`.

## 0.1.15 — Folder-free Chat mode and AI-generated chat titles

- **Strict no-folder Chat mode (`src/store.js`, `src/main.js`, `src/renderer/`):** Fixed `SessionStore.list()` dropping each session's `surface`, normalized any existing `surface: 'chat'` sessions away from Code project folders to `CAELIX Chats` on startup, hid the footer folder/branch pills in Chat mode (`#strip-folder`, `#strip-branch`), skipped `git:branch` lookups and `@` code-file mentions in Chat mode, flushed pending `liveRaf` text frames before clearing live state on `done`/`error`, and added sequence guards in `refreshSessions()`/`openSession()` against overlapping switches.
- **AI-generated chat titles (`src/engine/index.js`, `src/engine/providers.js`, `src/main.js`):** Added automatic concise chat titling after the first completed turn in both Chat and Code modes (using `max_tokens: 48` on API providers with smart fallback for simulator/`claude` modes), updating the header and sidebar live via `session-updated` without ever overwriting manual user renames.
- **Verified:** Added feature verification checks (`SessionStore` surface normalization and AI chat titling with manual-rename protection) plus Chat-mode hidden-folder and AI-title assertions in `src/selfcheck.js`, rebuilt `dist/CAELIX.app`, and ran `doctor`, `verify_features.js`, `terminal-probe.js`, and `selfcheck`.

## 0.1.14 — Built-in browser, real PTY Mac terminal, and isolated Chat/Code workspaces

- **Built-in browser (`src/browser.js`, `src/engine/tools.js`, `src/main.js`, `src/renderer/`):** Added an embedded Chromium `WebContentsView` panel (`Browser` tab in the right panel + topbar `Browser` toggle that works in both Chat and Code modes) with Back, Forward, Reload, URL bar, external-open button, and automatic bounds/modal hiding. Wired all four agent browser tools (`browser_navigate`, `browser_read`, `browser_click`, `browser_type`) into `ToolRunner` with per-mode permission checks and React/HTML-safe input handling, supporting `https://` and local `http://` (such as `localhost`).
- **Working real Mac terminal (`src/engine/terminal.js`, `src/renderer/`):** Completed the `/usr/bin/expect` PTY `zsh -i` shell tabs with 500-column PTY sizing (preventing line wrapping on long paths), `Last login` header, real backspace (`\x08`) and carriage-return simulation, `PROMPT_EOL_MARK=''` cleanup, immediate flushing of live prompts (`user@host dir % `), non-wrapping completion marker detection (`__CX_<token>_$?__`), and a `Stop` (`Ctrl+C`) button.
- **Strict Chat vs. Code workspace separation (`src/main.js`, `src/store.js`, `src/renderer/app.js`, `src/engine/index.js`):** Chat-surface conversations now always live in `~/Documents/CAELIX Chats` and never inherit or leak into Code project folders. Switching between `Chat` and `Code` switches/isolates active sessions, filters sidebars strictly by surface, hides Code folder buttons in Chat mode, and adjusts the system prompt cleanly.
- **Verified:** `npm run doctor`, `checks/terminal-probe.js`, `checks/verify_features.js` (`ALL 20 FEATURE VERIFICATIONS PASSED`), and the expanded 27-step `npm run selfcheck` (including live built-in browser `navigate`/`type`/`click`/`read` and Chat/Code isolation) all pass with 0 errors.

## 0.1.13 — OmniRoute as a managed local gateway provider

- New provider **OmniRoute** (www.omniroute.online): one OpenAI-compatible endpoint on localhost:20128 that routes across 352 providers with automatic fallback, quota pooling and circuit breakers. Verified live before adding: gateway up, key test, 475-model catalog, SSE streaming and `auto` routing all probed against a real gateway (20-check suite extended to cover the catalog, friendly failures and the model-refresh path).
- **No terminal needed:** CAELIX owns the helper's lifecycle. The first time an OmniRoute model is used or tested, `src/omniroute.js` launches the `omniroute` CLI as a managed child process (global bin first, `npx` fallback), waits bounded for port 20128, reuses it, and shuts it down on quit. Concurrent callers share one startup; crashes relaunch on next use; stdout/stderr land in `userData/logs/omniroute-helper.log`.
- Keys: the OmniRoute **gateway key** (from its dashboard → Endpoints) is stored in CAELIX's encrypted KeyStore like any other provider. `testKey` for omniroute probes `GET /v1/models` — proves key + helper without spending upstream tokens. Friendly errors for helper-not-running and invalid gateway key (401).
- Model picker: curated `auto` family (`auto`, `auto/coding`, `auto/fast`, `auto/cheap`, `auto/smart`) with honest notes; live Refresh pulls the real catalog (400 newest entries kept).
- Verified: `ALL 20 FEATURE VERIFICATIONS PASSED` (new OmniRoute check included), 25-step self-check passes (0 errors), and `checks/omniroute-e2e.js` drives the whole chain through CAELIX's own code — spawn (6.1 s), key test, live model refresh, streamed chat via `auto` (770 ms), clean shutdown with the port confirmed closed.

## 0.1.12 — Groq catalog refresh after provider rotation

- Live probing with a real stored Groq key showed Groq rotated its model catalog: `meta-llama/llama-4-scout-17b-16e-instruct`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `qwen/qwen3-32b`, `kimi-k2-instruct` and `groq/compound` now return `404` and no longer exist on current keys. The curated Groq list is rebuilt around the four models the catalog endpoint returns today, each verified streaming live (79-316 ms first reply): `openai/gpt-oss-20b` (new default), `qwen/qwen3.8-27b` (fastest, new high-headroom spillover target), `openai/gpt-oss-120b`, `allam-2-7b`. Quota-failover chains and `MODEL_NOTES` updated; rotated-out IDs are marked honestly in the notes.
- Verified: `ALL 19 FEATURE VERIFICATIONS PASSED` (Groq checks moved to the live catalog) and the 25-step self-check passes with 0 errors.

## 0.1.11 — favourite models and readable Gemini errors

- **Favourite models:** every row in the model picker now has a star. Starred models are pinned in a `Favourites` section at the top of the picker (each entry keeps its provider colour and note), the star state persists in encrypted user settings across restarts, and starring never switches the model. Covered by a new self-check step that stars, reopens the picker and proves it stayed.
- **Readable Gemini errors:** the raw escaped JSON that showed as `Provider returned 403: [{\"error\"…}]` is fixed — provider error payloads that arrive as JSON-encoded strings (Gemini's OpenAI-compatible endpoint does this) are unwrapped, and the readable message is shown. A `403` billing refusal now renders as a clear explanation with the direct next step (`console.cloud.google.com/billing`), and an invalid Gemini key gets its own hint.
- The self-check's isolated profile now also deletes `settings.json`, so every run starts with clean settings.
- Verified: error-parsing unit checks (string-wrapped, plain array, invalid-key, NVIDIA 404) all pass; `ALL 19 FEATURE VERIFICATIONS PASSED` (billing-error check updated to assert the new guarantee); 25-step self-check passes from source (0 errors) and from the packaged `CAELIX.app` (0 errors, window 450 ms).


## 0.1.10 — NVIDIA live-model diagnosis and stall failover

- **Diagnosed the real NVIDIA problem with a live probe of every curated model** (twice each, using the stored key through CAELIX's own KeyStore — the key was never printed): 6 models serve requests (`nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/nemotron-3.5-super-vl-120b-a12b`, `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, `mistralai/mistral-large-4-1t-a52b`, `minimaxai/minimax-m3.1-flash`); 8 curated IDs return `404 Not found for account`; `deepseek-ai/deepseek-v4.1-flash` and `z-ai/glm-5.3-flash` hang indefinitely even with a 60 s window. The key itself was valid the whole time (`/v1/models` returns 62 entries).
- Catalog reordered **verified-live models first**; the NVIDIA default is now `nvidia/nemotron-3.5-lightning-30b-a3b` and the high-headroom spillover target is `nvidia/nemotron-3.5-super-vl-120b-a12b`. Hanging and 404ing IDs stay listed at the bottom for accounts that do have them, with honest `MODEL_NOTES`.
- **Key test resilience:** an NVIDIA probe now walks past model-level failures — `404` *and* stalls (`408`) — to the next candidate and reports which model it landed on (`fallbackFrom`); only key-level errors (`401/402/403`) abort the test immediately. Previously one hanging model failed the whole key test even though other models worked.
- **Runtime stall failover:** when an NVIDIA model stalls (first-byte timeout), the engine now treats it as a model-level failure, tries the verified sibling models, and never puts the key on cooldown for it. Previously a stall threw immediately with no failover.
- Verified live with the stored key: real streaming answer ("ready"), real tool call (`read_file` emitted), and the stall error correctly recognized by the new failover signal; `ALL 19 FEATURE VERIFICATIONS PASSED`; 24-step self-check with 0 errors (window 513 ms).

## 0.1.9 (Rate-limit key rotation, permission safety, Copy buttons, Task Summaries & `/reset`)

- Added **Quota Saver & 3-level auto-failover** (`src/engine/providers.js`, `src/engine/index.js`):
  - **Level 1 → Level 2 → Level 3 spillover:** rotates keys within the active provider first, then spills over to high-headroom sibling models with separate quota buckets (`gemini-2.5-flash-lite` / `flash` / `2.0-flash`, `llama-4-scout` / `llama-3.1-8b-instant` / `qwen3-32b`, `openrouter/free` / `:free` coding models), and then automatically spills over to **other saved providers** (`gemini` → `nvidia` → `openrouter` → `groq`) so work continues even when one account/provider hits its cap.
  - **Token Diet:** compacts tool JSON schemas sent to models (`compactToolSchemas`), filters mutating tool schemas out in Plan mode (`PLAN_SAFE_TOOLS`), keeps only the latest `2` tool results un-trimmed (`<= 5,500` chars on tight-TPM models), and shrinks older tool outputs to `280–360` chars to stop burning TPM quickly.
  - **High-headroom & `:free` OpenRouter models:** added `openrouter/free`, `qwen/qwen3-coder:free`, `meta-llama/llama-3.3-70b-instruct:free`, and `google/gemma-3-27b-it:free` plus stamina labels (`MODEL_NOTES`), Keys modal guidance, and automatic NVIDIA fallback probing (`nvidia/llama-3.1-nemotron-70b-instruct`, `nv-mistralai/mistral-nemo-12b-instruct`, `mistralai/mistral-7b-instruct-v0.3`) in `testKey` & `callKeyed` when single preview NVIDIA slugs return `404`.
- Added **`/reset` command** and **`Reset chat context (/reset)`** button in the Context panel: summarizes everything that has happened so far in the current chat (`summarizeMessages` via active model with an automatic offline/rate-limit fallback) into a single compact hidden handoff note (`resetHandoff`), moves `contextOffset` past the old bulky messages/tool outputs, drops tool-result tokens to `0`, keeps open `todos` and full chat scroll above a persistent `"Context reset — usage cleared, context summary carried forward"` divider, and shows the carried-over summary inline so you can continue immediately without losing context. Also updated the Context meter to show the model/provider's true chat window size (`1,000,000` for Gemini, `128,000` for Groq, `200,000` default) labeled `chat window` and `Not an account limit.`.

- Added **multi-key API rotation pools** (`src/store.js` `KeyStore`, `src/engine/index.js` `Engine.pickKey`/`callKeyed`, Keys modal `+ Add` & comma-separated paste + key chips): save 3–12 API keys per provider so hitting `429` (or quota/auth errors) switches immediately to the next healthy key with `0 ms` delay before falling back to countdown sleep when all keys are cooling down.
- Added curated **lightweight, long-context models** (`meta-llama/llama-4-scout-17b-16e-instruct` Groq default, `llama-3.1-8b-instant`, `qwen/qwen3-32b`, `moonshotai/kimi-k2-instruct`, Gemini `gemini-2.5-flash-lite` / `flash`, NVIDIA `nemotron-3.5-lightning-30b-a3b`) with capability hints in the Model menu, normalized hallucinated OpenAI/Harmony tool aliases (`repo_browser.list_dir` -> `list_dir`, `open_file` -> `read_file`, etc.), and trimmed older tool results (`> 4` turns old) before sending to avoid blowing free-tier TPM limits.
- Fixed permission handling so interactive prompts wait properly (`30 min` timeout instead of silent `2 min` auto-deny), clean up immediately on Stop (`chat:stop`), avoid duplicate permission DOM IDs, and **halt queued actions & rounds** if permission is denied so tasks never run behind your back.
- Added **Copy** buttons to assistant messages, user messages (hover), error cards (`Copy error`), and task summaries, plus automatic **`Summary` cards** (actions succeeded/failed, files read/changed, duration, and failure/pause reason) persisted across completions, cancellations, round limits (`15`), and errors.
- Added a **`Chat | </> Code`** workspace switcher in the top bar (plus `/chat` and `/code` slash commands) persisted via `settings:set`: **Chat** mode gives a distraction-free conversation layout, while **Code** mode shows the full right-hand `Changes`, `Terminal`, and `Context` panel.
- Kept **MCP servers, Skills (`CAELIX.md` / `Project memory`), Lifecycle Hooks, and Agents** active across **both** Chat and Code modes, with quick capability pills in the Chat empty state.
- Added a centered **Code workspace folder** card in empty Code sessions showing recent project folders (clickable to switch immediately) and a **Choose folder…** button (plus `/folder`).
- Preconfigured built-in local **MCP servers** (`desktop`: `mac_system_info`, `git_overview`, `listening_ports`, `clipboard_read`; `memory`: persistent `memory_save`, `memory_search`, `memory_delete` via `src/engine/mcp-builtin.js`), Homebrew `PATH` discovery, one-click presets, and Claude MCP import.
- Preconfigured default **Lifecycle Hooks** (destructive `bash` command guard, `.env`/key file edit guard, and post-edit JS/JSON syntax check) plus quick-add hook presets in the UI.
- Added **`AgentRegistry`** (`src/engine/agents.js`) with 5 built-in specialized agents (`explore`, `plan`, `review`, `verify`, `general`), `.caelix/agents/*.md` and `.claude/agents/*.md` custom agent support, and an upgraded **Agents** modal to pick or create reusable agents.
- Added **Groq** (`groq`) provider support (`https://api.groq.com/openai/v1/chat/completions`, curated models `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `llama-3.1-8b-instant`, `groq/compound`, live `/openai/v1/models` refresh excluding audio/TTS/guard models, `GROQ_API_KEY` CLI support, and Keys modal slot).
- Added live `Waiting` / `Queued` / `Thinking` status feedback when reasoning models stream `delta.reasoning_content` / `delta.reasoning` or SSE keepalive comments before visible answer text starts.
- Added a `35s` first-byte / idle-stall request timeout (`CAELIX_REQUEST_TIMEOUT_MS`) on `streamOpenAICompatible` (`err.noRetry = true`) and a `15s` timeout + active-model check on `keys:test`, plus `Open Keys` / `Switch Model` recovery actions on `404` and `408` errors.
- Removed opaque white screenshot corners from `assets/icon-1024.png`, `assets/icon.iconset/*.png`, and `assets/icon.icns` with clean inverse-alpha edge unblending (preserving the exact four-point star, colors, and proportions), and rebuilt `dist/CAELIX.app`.

## 0.1.9 — MCP servers, hooks, slash commands, Helper Agent, rate-limit retries and NVIDIA NIM catalog

- Added MCP server support (`src/engine/mcp.js`, `McpManager`) for stdio and HTTP servers configured in `.mcp.json` and user `mcp.json`, exposing discovered `mcp__<server>__<tool>` tools with permission-mode gating and a UI management modal (`MCP` button / `/mcp`).
- Added shell Hooks (`src/engine/hooks.js`, `HooksManager`) for `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` events configured in `.caelix/hooks.json` and user `hooks.json` (including exit-code `2` blocking), with a UI management modal (`Hooks` button / `/hooks`).
- Added live slash command autocomplete (`/` button or typing `/` at the start of the composer) supporting `/compact`, `/btw`, `/helper`, `/agent`, `/mcp`, `/hooks`, `/memory`, `/keys`, `/model`, `/mode`, `/context`, `/cost`, `/usage`, `/status`, `/review`, `/export`, `/clear`, `/new`, and `/help`.
- Added patient rate-limit (`429`) handling honoring `Retry-After` headers and exponential backoff up to 5 attempts with a live abortable countdown banner in the chat transcript.
- Added a dedicated Helper Agent UI launcher (`Helper` button, `/helper`, `/agent`), live `subagent` step/summary cards in the transcript, and step telemetry in local simulator subagents.
- Fixed JSON-array provider errors (such as Gemini `403 [{ "error": ... }]` responses) to extract readable messages, clear the typing dots, and show quick `Open Keys` and `Switch Model` action buttons.
- Expanded the curated NVIDIA NIM catalog to 36 verified active models (`deepseek-ai/deepseek-v4.1-flash` default) with increased `/v1/models` sync capacity (`400`) and background catalog syncing when opening the model picker or saving a key.
- Extended `checks/verify_features.js` to 14 checks and `src/selfcheck.js` to 22 steps covering MCP, Hooks, Slash Commands, Helper Agent, `/btw`, `/compact`, `429` countdown retries, and the expanded NVIDIA catalog.

## 0.1.8 — end-to-end verification checklist and release polish

- Added `CHECKLIST.md` auditing every `features.md` and `SPEC.md` item with verified CLI, harness, source Electron self-check, and packaged `CAELIX.app` measurements and honest external blockers.
- Verified headless CLI (`--help`, `tools`, `doctor`, `run` across `ask`/`accept`/`plan` modes), mid-stream cancellation, bounded `429`/`5xx` HTTP retries, `>100k`-token compaction, `CAELIX.md` `@import` traversal protection, and `.ipynb` `notebook_edit` actions via `checks/verify_features.js`.

## 0.1.7 — full 19-tool harness, multimodal inputs, themes and keyboard shortcuts

- Added `web_search`, `notebook_edit` (`.ipynb` cell replace/insert/delete), `skill` (`SKILLS.md` / `.agents/skills/*/SKILL.md` / `CAELIX.md`), and base64 image reading in `read_file` with multimodal provider forwarding and hidden internal image carrier messages (19 tools total).
- Added live model catalog refresh (`providers:refresh`), composer file/image attachments (`files:pick`, drag-and-drop), `@` file mention autocomplete, live `TodoWrite` checklist bar, system prompt inspector in the Context tab, missing-key composer gate, status strip (project folder, git branch, context %, token/duration telemetry), and completion notifications when unfocused.
- Added bypass-mode safety banner, Normal/Verbose view toggle (`Ctrl+O`), dark/light theme toggle (`html[data-theme="light"]`), keyboard shortcuts (`Cmd+N`, `Cmd+\`, `Cmd+B`, `Cmd+K`, `Ctrl+O`, `` Ctrl+` ``, `Esc`), and multi-round live assistant bubble splitting so streamed post-tool text matches persisted transcript order.
- Extended self-check to 21 steps covering every new harness and UI capability.

## 0.1.6 — macOS app bundle and Desktop shortcut

- Added `npm run package` (`scripts/package.js`) to build a signed-ready `dist/CAELIX.app` with CAELIX's executable, `Info.plist`, `caelix.icns` icon, and symlink-preserved Electron frameworks, stripping leftover `electron.icns` and `ElectronAsarIntegrity` metadata.
- Packaging creates a `CAELIX.app` shortcut on the user's Desktop (skip with `--no-shortcut`).
- Fixed the self-check race where closing a terminal tab interrupted an in-flight `pwd` IPC call, and added `CAELIX_CHECKS_DIR` so packaged self-checks keep the signed bundle untouched.
- Verified both source and packaged `CAELIX.app` self-checks pass all 19 steps (packaged window 384 ms, first paint 67.8 ms).

## 0.1.5 — tabbed terminals with a persistent shell

- The Terminal panel now has tabs. Each tab runs its own `zsh` in the project folder, so `cd`, exports and shell functions persist between commands.
- Output streams into the tab that ran the command, each tab can be closed, and closing the last one opens a fresh tab. Chat switching restores that chat's tabs, seeded with its earlier terminal text.
- Commands time out with a clear error, a busy terminal refuses a second command, and every shell is terminated when the app quits.
- The self-check grew to 19 steps: the new step opens a second tab, changes directory, proves `pwd` kept it, then closes the tab.

## 0.1.4 — checkpoints and restore

- Every turn that changes files saves a checkpoint outside the project, keeping the exact prior text of each file and whether it already existed; each chat keeps its newest 40.
- The Changes panel lists checkpoints. Restore takes a second click, puts the files back and removes files that the turn had created.
- A restore is refused while a reply is running, and checkpoint paths outside the project are ignored.
- The self-check grew to 18 steps and 11 screenshots, including a real restore that removes the multi-edit from the note.

## 0.1.3 — memory, context and safer permissions

- Mode labels now match the reference: Manual, Accept edits, Plan, Bypass permissions; permission cards offer Always allow, Allow once and Cancel.
- Added a Project memory editor for `CAELIX.md`, `AGENTS.md` and `.caelix/CAELIX.md`, with recursive `@import` lines, a 12 KB budget and the prompt-token count. Saved memory enters every reply.
- Added the Context tab with total, system/memory, message and tool-result tokens, a usage bar and a saved-message count.
- Long histories are trimmed to fit the context window; the reply reports how many messages were compacted and the window shows a notice.
- `.git`, `.claude` and `.caelix` are protected: a write there asks for permission even in Bypass permissions mode.
- Chats delete inline with a two-click confirmation; deleting the active chat opens the most recently updated one.
- The self-check grew to 17 steps and 10 screenshots, covering memory save and prompt inclusion, the context report, a refused protected write and chat deletion.

## 0.1.2 — headless CLI and the full local tool set

- Added `caelix run "<prompt>"` with `--cwd`, `--provider`, `--model`, `--mode`, `--yes` and `--json`; it uses the same engine, tools and event stream as the window.
- Added `caelix tools` and extended `caelix doctor` with harness, key-environment and Electron checks.
- Added `multi_edit`, `task_start`, `task_list`, `task_stop`, `ask_user`, `present_plan` and `subagent` to the shared tool runner; background tasks have a registry with output files, exit codes and stop control.
- Permission modes now actually gate the runner: bypass allows in-project actions, accept edits auto-allows file edits, plan denies every non-read action.
- Keyed providers retry a temporary failure twice with backoff and a visible retry event; a partial stream is never replayed.
- The window renders question cards with choices and a typed answer, plan cards, and a retry notice.
- Self-check grew to 13 steps and 8 screenshots, including a real multi-edit, question answer, plan card, and a background task that starts, lists and stops.
- Added the REA evidence summary to `SPEC.md` with its coverage and its explicit unknowns.

## 0.1.1 — study screenshots and spec

- Self-check now saves a screenshot for each journey step in `checks/steps/` and requires at least six valid images before it passes.
- Added `SPEC.md`: the observed harness and Code view, a numbered inventory with an end-to-end test per item, and the three-phase build plan.
- Saved the CAELIX journey screenshots in `study/screenshots/caelix/` for the visual comparison in phase 3.

## 0.1.0 — first version

- CAELIX Electron window with the official four-point-star icon (SVG, PNG sizes, `.icns`) used in the window, Dock and About panel.
- Three-column Code workspace: sidebar with chats, central transcript and composer, right Changes/Terminal panel.
- Keys screen for Gemini, OpenRouter and NVIDIA; keys encrypted with the macOS keychain outside the project and returned to the UI only as a mask.
- Model picker with curated lists and any custom model ID; mode picker with Ask, Accept edits, Plan and Bypass.
- Streaming engine with local tools (read, write, edit, list, glob, grep, shell, tasks, fetch), permission cards and a visible change history.
- Optional bridge that runs the installed `claude` command and streams its events into the same transcript.
- Saved chats, rename, reload persistence, terminal panel and project folder picker.
- Self-check: a keyless pretend model drives the real window through keys, streaming, permission, file write, terminal, rename, mode switch, panel and restart; writes `checks/selfcheck.png` and `checks/selfcheck.json`.
