# CAELIX — Features

CAELIX is a desktop coding agent for macOS. It pairs a complete local agent harness with a Code workspace modelled on the Code view of the Claude desktop app. It is an independent application: its name, icon, window, package metadata and interface are CAELIX only. Claude and Anthropic names appear solely to identify the optional real Claude Code provider and compatibility.

This document is the product contract. Every item is testable and every item must work without a Claude subscription.

## 1. The complete agent harness

The harness is the engine that turns a request into work on a folder. It must behave the same way whether it is driven by the window, by the CAELIX command line, or by the self-check.

1. **Projects** — choose any folder as the workspace. The folder is the boundary for file tools. Recent folders are listed. Each project keeps its own chats, memory and change history.
2. **Chats** — create, rename, delete, search and resume chats. A chat stores the full message history, tool calls, tool results, mode, model and permission decisions. Closing and reopening CAELIX restores the chat exactly where it stopped.
3. **System prompt** — a short CAELIX identity, the active folder, the current mode, the project memory file and the available tool list are assembled for every request. The prompt is visible in a read-only inspector.
4. **Project memory** — `CAELIX.md` in the chosen folder (plus `AGENTS.md` when present) is loaded as standing instructions. The agent can propose edits to memory; the user approves them like any other write.
5. **Modes** — Ask (read-only, every action needs approval), Accept edits (file reads and in-folder edits proceed, shell and out-of-folder writes need approval), Plan (read-only research and a written plan, no edits), and Bypass (all in-folder actions proceed; a persistent warning is shown). Mode is per chat and is sent to the model.
6. **Permissions** — a blocking permission card appears for writes, shell commands, network fetches and anything outside the project. The card names the exact action, the target and a short reason. Allow once, allow for the session, or deny. Denying returns a tool error to the model without stopping the chat.
7. **Streaming** — assistant text arrives token by token. The first word is painted as soon as the first delta arrives. Tool cards appear while the tool runs and update in place with status, duration and a result preview.
8. **Cancellation** — Stop cancels the in-flight model request and terminates a running shell child process. Partial text already streamed stays in the transcript and is marked interrupted.
9. **Context control** — the engine counts characters and estimated tokens, trims old tool output first, then old turns, and keeps the system prompt, memory and latest user request. A context meter shows the estimate.
10. **Retries** — transient provider failures (429, 5xx, network reset) retry with bounded backoff and show the attempt in the transcript. Authentication and validation errors do not retry.
11. **Usage** — input tokens, output tokens, estimated cost and elapsed time are recorded per turn and per chat when the provider reports them.

### Harness tools

All tools run locally, return structured results and are cancellable. Paths are resolved inside the project; escapes are refused.

1. **Read** — read a text or image file with line numbers, offset and limit. Detects binary files. Images are returned to vision-capable models as image blocks.
2. **Write** — create or replace a file. Emits a diff and requires permission in Ask and Accept-edits modes.
3. **Edit** — exact string replacement with a uniqueness check, optional replace-all, and a unified diff preview. Refuses ambiguous edits.
4. **MultiEdit** — apply several ordered edits to one file atomically; roll back if any edit fails.
5. **Glob** — find files by pattern, sorted by modification time, with a result cap.
6. **Grep** — search file contents with regular expressions or literal text, glob filters, context lines and a result cap. Uses a bundled JavaScript scanner when ripgrep is unavailable.
7. **List** — list a directory, including hidden entries, with type and size.
8. **Bash** — run a shell command in the project with a timeout, captured stdout/stderr, exit code and no interactive stdin. Dangerous patterns are flagged. The child is killed on Stop.
9. **TodoWrite** — maintain the visible task list for multi-step work. The window renders it as a checklist and the model sees the current list on every turn.
10. **WebFetch** — fetch an HTTP(S) URL, convert HTML to text, cap the response and show the final URL, status and content type. Requires permission.
11. **WebSearch** — search the web through the configured search endpoint and return titles, URLs and snippets. Requires permission.
12. **Notebook** — read and edit `.ipynb` cells as structured JSON without corrupting metadata.
13. **Task** — launch a bounded sub-agent with its own context and tool budget, then return a summary. Used only when the model asks for parallel research.
14. **Skill** — load a local instruction bundle from the project's skills folder on demand, keeping the base prompt small.
15. **Plan** — in Plan mode, submit a structured plan and wait for approval before any mutating tool.
16. **AskUser** — ask a structured multiple-choice question with an optional free-form answer. In the self-check and command-line non-interactive mode the default choice is used and the decision is logged.

Every tool description shipped to providers is written for CAELIX. No tool text, prompt or instruction is copied from Claude Code or the Claude app.

### Command line

`caelix` opens the window. `caelix run "<prompt>" --cwd <folder> --mode ask|accept|plan|bypass --model <id>` runs the same engine headlessly in print mode, streams events as JSON lines and exits with a status. `caelix doctor` checks the runtime, key store, provider reachability and window assets.

## 2. The Code view

The window is a three-column workspace with a top bar and a composer.

1. **Top bar** — traffic-light inset, project name and path, chat title (editable inline), model picker, mode picker, Keys button, panel toggle. Height 48 px.
2. **Left sidebar (260 px)** — CAELIX mark, New chat button, search field, chat list grouped by Today / Previous 7 days / Older, project switcher at the bottom. Collapsible to 56 px.
3. **Main column** — the transcript. User messages are right-aligned cards. Assistant replies are full-width prose with headings, lists, tables, inline code and fenced code blocks with copy buttons. Tool calls render as compact bordered cards with an icon, tool name, target, status and expandable result. Diffs render with added/removed line colouring.
4. **Composer** — multi-line input that grows to 200 px, attachment button, permission-mode chip, model chip, send/stop button. Enter sends, Shift+Enter adds a line. Disabled with an explanation when no key or model is configured.
5. **Right panel (380 px)** — two tabs: **Changes** and **Terminal**. Changes lists every file touched in the chat with add/remove counts and a unified diff. Terminal shows the shell commands, their live output and exit codes. The panel collapses fully.
6. **Permission cards** — inline in the transcript, never a native modal. They block only the tool call, keep the rest of the transcript usable, and remember "allow for session".
7. **Status strip** — folder, branch when Git is present, context meter, token usage, elapsed time and a streaming indicator.
8. **Keys screen** — a dedicated screen reachable from the top bar and from an empty state. One row each for Google Gemini, OpenRouter, NVIDIA and the optional Claude Code bridge. Paste a key, validate it, see it masked as `••••••••1234`, replace or delete it. Keys never return to the renderer in full.
9. **Model picker** — searchable list grouped by provider, with curated models plus a "Use any model ID" field. The chosen model is per chat.
10. **Empty states** — a new chat shows the CAELIX star, a one-line prompt, the active folder and three example tasks.
11. **Visual target** — at least 90% similarity to the Code view: same column widths, top bar height, sidebar rhythm, message spacing, composer shape, panel tabs and colour hierarchy. Dark theme by default, with a light theme that preserves the layout.

## 3. Providers and keys

1. **Gemini** — Google AI Studio keys, OpenAI-compatible chat completions endpoint, streaming, tool calls and vision. Any model ID the account can access.
2. **OpenRouter** — OpenRouter keys, streaming, tool calls, provider routing headers, any model ID.
3. **NVIDIA** — NVIDIA NIM keys, OpenAI-compatible endpoint, streaming and tool calls, any model ID.
4. **Claude Code** — optionally run the real installed `claude` command as the engine for a chat. CAELIX spawns it in the selected folder, streams its JSON events into the same transcript, and maps its permission requests to CAELIX permission cards. No Anthropic key is stored by CAELIX for this path; the installed tool uses its own sign-in.
5. **Keys screen** — paste, test, replace, delete. Validation performs a minimal authenticated request and reports a clear result.
6. **Encryption** — keys are encrypted with the OS keychain through Electron `safeStorage` and written to a single file in the application's user-data folder, outside the project. The renderer receives only a mask. Logs and self-check artifacts never contain key material.
7. **Model catalogue** — curated default lists ship for each provider; the picker can refresh provider model lists and accepts arbitrary IDs.

## 4. Speed

1. Cold window under 2 seconds on this Mac, measured from process start to the first painted frame. The renderer is plain HTML, CSS and JavaScript with no framework and no build step.
2. Nothing heavy loads until needed: provider SDKs are replaced by `fetch`, panels render on first open, syntax highlighting is applied only to visible code blocks, and the diff engine runs off the main thread when available.
3. Streaming paints each delta immediately. Batching is capped at one animation frame and never waits for a complete sentence.
4. Startup does not block on network, keychain, model lists or session indexing. The shell paints first; data fills in.

## 5. Self-check

1. `npm run selfcheck` starts the real window with a pretend provider that needs no key and drives the full journey: create a chat, send a prompt, watch a streamed reply, approve a tool, see a file change, open the terminal, rename the chat, switch mode, open Keys, collapse a panel, restart the renderer and reload the chat.
2. It writes to `checks/`: a PNG screenshot of the final window, a JSON report with every console error, uncaught exception and failed step, start and ready times, window-open duration, memory working set, and the app version.
3. It always closes the window and exits with code 0 only when every step and the performance budget pass.

## 6. Identity and packaging

1. The application is named **CAELIX** in the window title, About panel, menu bar, Dock, bundle name, `package.json` and every screen.
2. The official icon is the uploaded glowing blue-white four-point star on a deep navy-to-black rounded square. It is kept in `assets/` as SVG, PNG sizes and `.icns`, and is used for the window, Dock, bundle and desktop shortcut.
3. No Claude or Anthropic logo, wordmark, colour scheme or product name is used for CAELIX. Compatibility text may say "Runs the real Claude Code" only where the optional provider is explained.
4. A signed-ready `.app` bundle and a Desktop alias/shortcut can be produced locally without compiling native packages.
