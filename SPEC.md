# SPEC — Claude Code, observed

This document records how the two reference surfaces behave: the `claude` command-line harness, and the **Code** tab of the Claude desktop app. It exists so CAELIX can reproduce the behaviour with its own code. Claude and Anthropic names appear only to identify the reference.

## How this was observed

| Evidence | What it gives | Where it is saved |
| :- | :- | :- |
| Official documentation, fetched from `code.claude.com/docs` | Layout, modes, permissions, tools, memory, sessions, checkpoints, context, CLI flags | `study/docs/` |
| Full CLI help and auth status | Real flags, subcommands, auth state, version | `study/claude-help.txt`, `study/claude-doctor.txt` |
| Print-mode start-up record | Exact tool list, model id, permission mode, slash commands, agents, skills, plugins for this machine | `study/print-mode-test.txt` |
| Shipped strings and the unpacked app copy | Exact UI labels, permission choices, mode names, IPC families, stylesheet tokens | `study/claude-strings.txt`, `study/rea/claude-app-unpacked/` |
| REA 6.9.0 static analysis of the unpacked copy | Verified entrypoints, renderer pages, IPC graph counts, bridge API names, and explicit coverage limits | `study/rea/claude-app-analysis.json`, `study/rea/claude-app-evidence.zip` |
| CAELIX self-check | Our own window timing, streaming latency, memory, screenshot | `checks/selfcheck.json`, `checks/selfcheck.png` |

**Marks used on every item**

- **seen** — confirmed in official docs, help output, a real print-mode run, or the shipped bundle.
- **guessed** — inferred from adjacent evidence; not directly confirmed.
- **unknown** — could not be observed here.

**Two blockers, stated plainly**

1. The installed CLI reports `loggedIn: false`, `authMethod: none`. A print-mode run reaches the harness and returns an authentication failure, so model reasoning, live token streaming, permission dialogs, and real file edits through the reference harness are **unknown** here. Their shapes are documented and shipped, so the structure is **seen**; the live behaviour is marked unknown.
2. Launching the installed desktop app would restore the user's existing session store, which is forbidden. The Code tab is therefore specified from the official desktop page, the app's shipped strings, and its stylesheet, not from opening the user's chats. Pixel comparison is deferred to phase 3 with an isolated profile.

**What the static analysis added.** REA examined 1,002 relevant files, parsed 770 JavaScript files (14 skipped, 0 parse failures, 9.75 million AST nodes), and confirmed the shell's shape without running it:

- The Electron main entry is `.vite/build/index.pre.js`.
- The renderer pages are `main_window/index.html`, `about_window/about.html`, `quick_window/quick-window.html`, `file_viewer/fileViewer.html`, `find_in_page/find-in-page.html`, `local_exec_consent/localExecConsent.html`, `buddy_window/buddy.html`, `config_template_window/configTemplate.html`, plus the design, slides, and shell frames under `resources/frame/`.
- It found 144 IPC channel nodes, 42 IPC handler/listener nodes, 24 context-bridge APIs, and 11 renderer entrypoints.
- Named bridge APIs include `buddy.getPathForFile`, `cowork` with `askClaude`, `callMcpTool`, and `runScheduledTask`, `claudeDesktopArtifactPane` with `chrome`, `embedded`, and `platform`, and `omeletteDesktopPdf.printFrameToPdf`.
- The limits matter: 143 of the 144 channel expressions are dynamic, 1,510 application and 40,934 semantic relationships remain unknown, and 174 sources that load Electron were not fully examined. Exact channel names and the handler wiring therefore remain **unknown**; the Code view's behaviour is still specified from the UI strings, the documentation, and the stylesheet, not from resolved IPC.

---

## 1. The agentic loop

The core is a loop: gather context, act with tools, verify, repeat until the task is done. The model decides the next step; the harness supplies tools, permissions, context, and persistence.

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 1 | Prompt turn | Typing a request and pressing Enter starts a turn; the reply and tool cards appear in order | The harness appends the user message, builds the model context, and streams the response | In a temp folder, ask for a file to be created; confirm a user bubble, assistant text, one tool card, and the file on disk | seen |
| 2 | Context gathering | Claude reads files, searches, and runs read-only commands before answering | Tool results are appended to the conversation as data and fed back to the model | Ask "what does this project do?"; observe at least one read/list/search tool and a grounded answer | seen |
| 3 | Action | File edits and shell commands are proposed as tool calls with a visible target | Each tool call is validated against the permission mode before execution | Ask to add a line to a file; confirm the exact target is named before it is written | seen |
| 4 | Verification | Claude runs the tests or the command again and reports the result | The loop continues until the model returns text without new tool calls | Ask to fix a failing test; confirm a test command runs after the edit and its exit code is reported | seen |
| 5 | Multi-step chaining | Dozens of actions can run in one turn, each updating in place | A bounded loop with a maximum number of rounds and a per-tool timeout | Ask for a two-file refactor; confirm both files change in one turn | seen |
| 6 | Interruption | A stop control halts the reply immediately | The in-flight request is aborted; a running child process is terminated | Start a long reply, press stop, confirm the transcript is marked interrupted and no further text arrives | seen |
| 7 | Steering | Typing a correction while Claude works is queued without stopping it | The correction is delivered after the current action and before the next one | Ask for a large task, type "use a different file name" mid-run, confirm the next action follows the correction | seen |
| 8 | Streaming text | Words appear as they arrive, not after the turn ends | Partial deltas are forwarded to the renderer and painted on the next frame | Send a prompt, measure the first visible word at under two seconds and before the turn ends | seen (docs) / guessed (live latency) |
| 9 | Tool cards | Each call has a compact card with name, target, status, duration, expandable output | The harness emits start and result events keyed by call id | Ask for a read; expand the card and see the file excerpt; confirm the status changes from running to done | seen |
| 10 | Suggested prompt | After a reply, grey suggestion text can appear in an empty prompt box | A small background request predicts the next prompt and counts toward usage | Finish a turn, press Tab, confirm the suggestion enters the box and Enter sends it | seen |
| 11 | Retry and fallback | A retry or a fallback model can take over on overload | Transport errors retry with backoff; `--fallback-model` accepts a chain | Force a 429 with a mock endpoint, confirm a bounded retry and a visible attempt | guessed |
| 12 | Usage and cost | Token counts, elapsed time, and cost are available per turn and session | Provider usage is recorded; `/cost` and `/usage` summarize it | Run two turns, open `/usage` and `/cost`, confirm non-zero counts and a currency estimate | seen (docs) / unknown (live values) |
| 13 | Context meter | A percentage or ring shows how full the window is | The harness estimates tokens per category and re-renders after each turn | Fill a session with large reads, confirm the meter rises and `/context` lists categories | seen |
| 14 | Permissions | A prompt names the tool, the target, and the reason, with allow/deny choices | The permission engine resolves rules, mode, and session grants before execution | Ask for a write in Manual mode, deny it, confirm the model receives the refusal and continues | seen |
| 15 | Persistence | Closing and reopening restores the conversation and its mode | Every message and tool result is appended to a local transcript as work proceeds | Create a chat, quit, reopen, confirm the same messages, model, and mode | seen |
| 16 | Session isolation | Each chat has its own context and changes | A session id scopes the transcript, tool state, and permission grants | Run two chats in parallel on different files; confirm neither sees the other's history | seen |

---

## 2. Tool catalogue

The documentation lists the built-ins that exist across surfaces; this machine's session started with the 23 tools marked **session**. A tool absent from a session is still part of the product when the platform or settings enable it. MCP servers can add arbitrary `mcp__<server>__<tool>` entries.

| # | Tool | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 17 | `Agent` | A subagent card with its own task and summary | A child loop with its own context and tool budget; only the summary returns | Ask for parallel research; confirm a child card runs and returns a summary without polluting the main transcript | seen |
| 18 | `Artifact` | A published interactive page with a share link | Uploads HTML or Markdown to the hosted artifact service | Ask for an HTML report as an artifact; confirm a URL opens and the page renders | seen (docs) |
| 19 | `AskUserQuestion` | A multiple-choice question card with an optional free-form answer | Blocks the turn until answered; non-interactive runs use defaults or deny | Ask Claude to clarify a requirement; pick an option and confirm the next action follows it | seen |
| 20 | `Bash` **session** | A terminal card with the command, live output, and exit code | Spawns a shell in the project with a timeout, captured streams, and process-group kill | Ask to run `pwd`; confirm output equals the project folder and exit code 0 | seen |
| 21 | `CronCreate` **session** | A scheduled task appears in the session's task list | A session-scoped timer re-prompts at the chosen time and is restored on resume | Create a one-minute task, confirm it fires once and appears after resume | seen (docs) |
| 22 | `CronDelete` **session** | The task disappears from the list | Cancels the timer by id | Delete the task and confirm no further prompt | seen (docs) |
| 23 | `CronList` **session** | A list of pending tasks with times | Reads the session's timer table | Create two tasks, list them, confirm both ids and times | seen (docs) |
| 24 | `Edit` **session** | A diff card replacing an exact string in a file | Reads the file, enforces uniqueness, writes atomically, snapshots for rewind | Ask for a one-line change; confirm the diff shows one removal and one addition | seen |
| 25 | `EndConversation` | The session closes with a short explanation | Refuses only in rare abuse or on explicit request; cannot be removed while other tools remain | Ask Claude to end the session and confirm; verify the next prompt starts a new session | seen (docs) |
| 26 | `EnterPlanMode` | The mode chip changes to Plan | Switches the session's permission mode after the model decides to plan | Ask for a complex feature; confirm the mode chip becomes Plan before edits | seen (docs) |
| 27 | `EnterWorktree` **session** | The session header shows an isolated worktree path | Creates or switches to a Git worktree under the repository | Ask to work in an isolated worktree; confirm a new directory and branch, and that the original tree is untouched | seen (docs) |
| 28 | `ExitPlanMode` | A plan card with an approve action | Presents the written plan and leaves Plan mode only on approval | In Plan mode, approve the plan and confirm editing becomes possible | seen (docs) |
| 29 | `ExitWorktree` **session** | The header returns to the original folder | Switches back and optionally removes the worktree | Exit the worktree and confirm the original folder is active and clean | seen (docs) |
| 30 | `Glob` | A file list sorted by modification time | Pattern match over the tree with a result cap; absent by default on macOS, Linux, and WSL | Name a pattern; confirm matches and ordering | seen (docs) |
| 31 | `Grep` | Matching lines with file and line numbers | Regex or literal scan with include filters and a result cap; absent by default on macOS, Linux, and WSL | Search a known string; confirm every hit and its line number | seen (docs) |
| 32 | `ListAgents` **session** | A list of subagents, teammates, and other sessions | Reads the session's agent registry and cross-session directory | Open `/list-agents`; confirm this session and any children are listed | seen (docs) |
| 33 | `ListMcpResourcesTool` | A list of resources exposed by connected servers | Queries each MCP server, excluding app UI resources | Connect a resource server, list resources, confirm names and URIs | seen (docs) |
| 34 | `LSP` | Definition, reference, or diagnostic results | Calls the configured language server for the file type | Ask for a definition; confirm the target file and line | seen (docs) |
| 35 | `Monitor` **session** | A live output card that updates as lines arrive | Runs a background command or WebSocket and feeds each line back into the turn | Ask to watch a log; append a line from outside and confirm the model reacts without a new prompt | seen (docs) |
| 36 | `NotebookEdit` **session** | A cell-level diff in a `.ipynb` file | Edits JSON cells while preserving metadata and outputs | Ask to change one notebook cell; confirm the JSON stays valid and other cells are untouched | seen (docs) |
| 37 | `PowerShell` | A PowerShell command card with output | Native PowerShell execution on Windows | On Windows, run `Get-Location`; confirm output and exit code | seen (docs) |
| 38 | `PushNotification` **session** | A desktop or phone notification | Sends through local or hosted infrastructure | Ask to notify when a long task finishes; confirm the banner and the transcript note | seen (docs) |
| 39 | `Read` **session** | A file card with numbered lines or an image | Reads text or images with offset/limit, detects binary, and returns image blocks to vision models | Ask to read a specific file; confirm the shown excerpt matches it | seen |
| 40 | `ReadMcpResourceTool` | The contents of one MCP resource | Resolves the URI through the owning server | Read a known resource; confirm its body | seen (docs) |
| 41 | `RemoteTrigger` | A cloud scheduled task appears in the list | Creates or runs hosted routines through the cloud service | Create a routine and confirm it appears on the account | seen (docs) |
| 42 | `ReportFindings` **session** | A grouped code-review card with file, summary, and failure scenario | Emits a structured finding list instead of prose | Run a review; confirm findings group by file and each has a scenario | seen (docs) |
| 43 | `ScheduleWakeup` **session** | The next loop time is shown | Reschedules the next self-paced iteration between one minute and one hour | Start a loop, let it choose the next time, confirm the pending wakeup | seen (docs) |
| 44 | `SendFeedback` | A draft feedback report appears for review | Queues a local draft; sends nothing without confirmation | Draft feedback, edit it, confirm nothing leaves the machine before approval | seen (docs) |
| 45 | `SendMessage` **session** | A message arrives in another agent or session | Routes to a teammate, subagent, or another local session | Send a message to a child agent and confirm its reply | seen (docs) |
| 46 | `SendUserFile` | A file card with a download or inline preview | Delivers a local file to a remote client | Send a generated image and confirm the preview opens | seen (docs) |
| 47 | `ShareOnboardingGuide` | A share link for `ONBOARDING.md` | Uploads the guide and returns a URL | Generate the guide and open the link | seen (docs) |
| 48 | `Skill` **session** | A skill card naming the loaded bundle | Loads a `SKILL.md` and its resources into the conversation on demand | Invoke a skill; confirm its instructions load and its steps run | seen |
| 49 | `SubagentHandback` | A subagent report is delivered to the parent | Auto-mode delivery gate for local subagents | Run an auto-mode subagent and confirm the report appears once | seen (docs) |
| 50 | `TaskCreate` | A new item in the task list | Creates a task with status and dependencies | Add two tasks and confirm their order and status | seen (docs) |
| 51 | `TaskGet` | Full details for one task | Reads the task store | Open a task and confirm its details | seen (docs) |
| 52 | `TaskList` | The whole task list | Reads the session's task store | List tasks and confirm every open item | seen (docs) |
| 53 | `TaskStop` **session** | A background task ends and is marked stopped | Terminates the task by id; can also stop a teammate | Start a long background command and stop it; confirm the process is gone | seen (docs) |
| 54 | `TaskUpdate` | Status, dependency, or deletion changes | Mutates the task store | Mark a task complete and confirm the list updates | seen (docs) |
| 55 | `TodoWrite` | A checklist that updates during multi-step work | Replaces the visible task list and keeps it in context | Ask for a three-step task; confirm the checklist progresses | seen |
| 56 | `ToolSearch` **session** | Deferred tools become available | Searches and loads deferred MCP tool definitions | Enable tool search, ask for a deferred tool, confirm it loads and runs | seen (docs) |
| 57 | `WaitForMcpServers` | A waiting note until servers connect | Blocks the request until named servers are ready | Start with a slow server, confirm the wait and then the tool call | seen (docs) |
| 58 | `WebFetch` | A page card with final URL, status, and extracted text | Fetches, follows redirects, converts HTML to text, caps the body, requires permission | Fetch a known page; confirm status 200 and a text excerpt | seen |
| 59 | `WebSearch` **session** | Result cards with titles, URLs, and snippets | Queries the search backend and returns a bounded list | Search for a current fact; confirm at least three results with links | seen |
| 60 | `Workflow` **session** | A workflow card with child agents and one result | Runs a script that orchestrates background subagents | Run a two-agent workflow and confirm one consolidated result | seen (docs) |
| 61 | `Write` **session** | A new-file card with a diff | Creates or overwrites a file, snapshots it, requires permission | Ask for a new file; confirm the diff and the bytes on disk | seen |
| 62 | `DesignSync` **session** | A design workspace card | Synchronizes design artifacts with the desktop design surface | Ask for a design change and confirm the artifact updates | seen (docs) / guessed (semantics) |
| 63 | `Task` **session** | Legacy subagent card | The older name for spawning a child agent | Ask for a child agent and confirm a child transcript | seen |
| 64 | MCP tools | Tools grouped by server name | Each server exposes JSON-schema tools; permission rules can scope them | Connect a test server; confirm its tool appears and runs | seen (docs) |

**Tool behaviour details that matter for reproduction**

- `Bash` keeps shell state such as the working directory and exported variables between calls within a session; background commands write to an output file that `Read` can inspect. Timeouts and output caps apply. **seen (docs)**
- `Edit` requires exact, unique old text unless replace-all is requested; it protects read-only files and handles non-UTF-8 files. **seen (docs)**
- `Read` returns numbered lines, supports offset and limit, and returns images as image blocks. Large files are capped. **seen (docs)**
- `WebFetch` converts HTML to text, reports the final URL and status, and is permission-gated. **seen (docs)**
- `Agent` subagents have their own context and tool list; background agents return a summary and can be messaged. **seen (docs)**
- Task-tracking tools replace `TodoWrite` by default on supporting models; `CLAUDE_CODE_ENABLE_TASKS=0` restores the checklist. **seen (docs)**

---

## 3. Permissions and modes

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 65 | Manual mode | The mode selector reads **Manual**; each new tool use prompts | `default` mode resolves allow/ask/deny rules, then asks | In Manual, ask for a write; confirm the prompt appears exactly once per new tool | seen |
| 66 | Accept edits | File edits and common filesystem commands proceed; other shell commands still ask | `acceptEdits` auto-approves in-folder file tools and safe filesystem commands | Ask for two edits and a test run; confirm edits proceed and the shell prompts | seen |
| 67 | Plan mode | The chip reads **Plan**; Claude researches and writes a plan without editing | `plan` denies mutating tools until the plan is approved; `ExitPlanMode` presents it | Ask for a feature in Plan; confirm reads run, writes are refused, and a plan card appears | seen |
| 68 | Auto mode | The chip reads **Auto**; routine prompts disappear | A background classifier checks shell and network actions against the request | Ask for a routine command; confirm it runs and an unrelated command is blocked | seen (docs) |
| 69 | Bypass permissions | The chip reads **Bypass permissions** with a persistent warning | `bypassPermissions` skips prompts except protected paths and a few actions no mode auto-approves | In a disposable folder, ask for a write and a command; confirm no prompts and the warning stays visible | seen |
| 70 | Don't ask | CLI-only mode that denies anything that would prompt | `dontAsk` denies unapproved calls but still allows reads and pre-approved tools | Run `claude -p --permission-mode dontAsk` with a write request; confirm a denial result, not a hang | seen (docs) |
| 71 | Prompt choices | **Allow once**, **Always allow**, **Cancel**; policy rows offer **Always allow**, **Ask each time**, **Ask once per session**, **Blocked** | The choice becomes a one-off approval, a session grant, or a persistent rule | Approve once, trigger the same tool again, confirm the prompt returns; then allow for session and confirm it does not | seen |
| 72 | Prompt comment | A comment can be attached when answering a prompt | The comment is returned to the model with the decision | Deny with "use the other file"; confirm the next attempt follows the comment | seen (docs) |
| 73 | Rule syntax | Rules like `Bash(npm run build)`, `Read(./.env)`, `WebFetch(domain:example.com)` | Exact, prefix, wildcard, and parameter matching with deny taking priority | Add an allow rule for one command; confirm only that command skips the prompt | seen |
| 74 | Working directories | The chat names the folder; out-of-folder access prompts | File tools are confined to the working directory and additional directories | Ask to read a file outside the folder; confirm a prompt or a refusal | seen |
| 75 | Additional directories | A folder can be added to the session | `--add-dir` or `/add-dir` grants file access, not configuration | Add a second folder, read a file there, confirm it works and its `.claude` settings do not load | seen |
| 76 | Workspace trust | First use of a project may ask to trust it | Project allow rules and hooks run only after trust | Open a new folder with project rules; confirm the trust question and that rules apply afterwards | seen (docs) |
| 77 | Protected paths | Writes to `.git` and `.claude` are called out | Certain paths stay protected even in bypass mode | In bypass, ask to edit `.git/config`; confirm the refusal or explicit warning | seen (docs) |
| 78 | Sandbox and managed policy | Some actions are blocked with an explanation | Sandboxing and managed settings override user rules | With a managed deny rule, confirm the action is blocked and the reason names policy | seen (docs) |
| 79 | Hooks as gates | A hook can approve or deny a call | `PreToolUse` hooks run before the permission decision and can override it | Add a deny hook for one command; confirm it blocks even when mode would allow | seen (docs) |
| 80 | Session grants | "Allow for session" stops repeat prompts | Grants live in the session and are not written to settings | Grant a command for the session, restart, confirm the prompt returns | seen |

---

## 4. Sessions, checkpoints, and history

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 81 | Saved sessions | Chats appear in a list and reopen with full history | Each message, tool call, and result is appended to a local transcript | Create three chats, restart, confirm all three and their order | seen |
| 82 | Resume | `--continue` reopens the latest chat; `--resume` opens a picker or a named chat | The harness loads the transcript and continues under the same id | Quit and run `--continue`; confirm the last message is present and a new turn appends | seen |
| 83 | Fork or branch | A copy of the chat starts with a new id | `--fork-session` or `/branch` copies history without changing the original | Fork a chat, send a different prompt, confirm the original is unchanged | seen |
| 84 | Session picker | A searchable list with project and time | Reads local transcripts and filters by folder, name, or PR | Open the picker, search a title, confirm the right chat opens | seen |
| 85 | Naming | The title bar shows an editable name | `/rename` or `--name` writes the display name into the transcript | Rename a chat, restart, confirm the new name persists | seen |
| 86 | Archive | An archived chat leaves the main list | The transcript stays on disk but is hidden | Archive a chat, confirm it leaves the list and can be restored | seen (docs) |
| 87 | Parallel sessions | Two chats run at once in separate panes | Each has its own process, context, and permission state | Run two chats, confirm both stream independently | seen |
| 88 | Worktrees | A chat can run in its own Git worktree | `--worktree` creates a branch directory and switches the session into it | Start a worktree session, edit a file, confirm the main tree is clean | seen (docs) |
| 89 | Side chat | A small secondary chat opens without derailing the main one | A child conversation with its own context and a link back | Ask a side question, confirm the main transcript is unchanged | seen (docs) |
| 90 | Background tasks | Running shells and agents appear in a tasks pane | The harness tracks child processes and agents with ids and output files | Start a long command, confirm it appears in the pane and can be stopped | seen (docs) |
| 91 | Checkpoints | `/rewind` or double Esc opens a list of prompts | File snapshots are captured before each turn, up to 100 per session | Edit a file, rewind to before the edit, confirm the file and chat both revert | seen |
| 92 | Rewind choices | Restore code and conversation, conversation only, code only, summarize from/up to here, never mind | Each choice restores snapshots and/or replaces a message span with a summary | Try each choice on a disposable chat and confirm the stated effect | seen |
| 93 | Checkpoint limits | Bash-only changes and some subagent edits are not restored | Only files touched by the editing tools are snapshotted | Change a file only through a shell command, rewind, confirm it stays changed | seen (docs) |
| 94 | Transcript location | The docs name a JSONL file per session | Sessions are plaintext under the config directory, kept for a retention period | Locate the transcript for a test chat and confirm it contains the messages | seen |
| 95 | Export and delete | A chat can be exported or deleted with its data | Export serializes the transcript; delete removes the session and its snapshots | Export a chat, delete it, confirm the file exists and the chat is gone | seen (docs) |
| 96 | Session details | A rail of cards shows folder, changes, running work, and context | The UI reads session state and Git status | Open the rail, confirm each card matches the chat | seen |

---

## 5. Memory and context

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 97 | Project instructions | A `CLAUDE.md` at the project root is followed every session | Files from the working directory and its parents are concatenated into context | Add a rule to `CLAUDE.md`, start a new chat, confirm the rule is followed | seen |
| 98 | Instruction hierarchy | Managed, user, project, and local files all apply | Broadest scope first; `CLAUDE.local.md` comes after `CLAUDE.md` at each level | Put conflicting rules at two levels; confirm the more specific one wins in practice | seen |
| 99 | Nested instructions | Subfolder rules load when Claude touches that folder | Nested files load on first read, write, or edit in the subdirectory | Add `src/CLAUDE.md`, ask about `src`, confirm the rule enters context only then | seen |
| 100 | Imports | A memory file can include another file | `@path` imports are expanded when the memory file loads | Import a shared rules file, confirm its text is followed | seen |
| 101 | AGENTS.md | A repository using `AGENTS.md` gets those instructions instead of or beside `CLAUDE.md` | The harness detects the file and loads it by the documented rules | Use an `AGENTS.md`-only repo and confirm its rule is followed | seen |
| 102 | Path-scoped rules | Rules apply only to matching files | `.claude/rules/*.md` with `paths:` frontmatter loads on demand | Add a rule for `*.ts`, edit a TypeScript file, confirm it applies and a Markdown edit does not | seen (docs) |
| 103 | Auto memory | Claude remembers preferences across chats | Notes are stored per project under the config directory; the first 200 lines or 25 KB of `MEMORY.md` load each session | Correct Claude once, start a new chat, confirm the correction carries over | seen (docs) |
| 104 | Memory editor | `/memory` opens the files; a toggle controls auto memory | The command edits the same files that load at start-up | Open `/memory`, edit a rule, confirm the next turn follows it | seen |
| 105 | Init | `/init` proposes a project memory file | Claude explores the repo and writes build and test facts | Run `/init` in a fresh repo; confirm a reviewable `CLAUDE.md` | seen |
| 106 | Compaction | A "Conversation compacted" row appears; the chat continues | Older history is replaced by a structured summary; startup files and up to five recent files reload | Fill the window, trigger compaction, confirm the row and that the task continues | seen |
| 107 | Manual compact | `/compact` with optional focus instructions | Summarizes now and keeps the chosen focus | Run `/compact focus on the auth bug`, confirm the summary keeps that topic | seen |
| 108 | Auto-compact threshold | A setting controls when compaction runs | `/autocompact 500k` or `--autocompact` changes the trigger | Set a low threshold, fill the window, confirm it compacts earlier | seen (docs) |
| 109 | Context breakdown | `/context` lists categories and loaded memory files | The harness attributes tokens to system prompt, memory, tools, files, and messages | Run `/context`, confirm the categories and the memory file names | seen |
| 110 | Large context | Some models accept a one-million-token window | A model variant selects the larger window | Select a 1M variant, confirm the meter reflects the larger limit | seen (docs) |

---

## 6. Command line and headless mode

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 111 | Interactive start | `claude` opens the terminal UI in the current folder | Starts a session, loads memory and settings, and waits for a prompt | Run `claude` in a temp folder and confirm the prompt box and folder name | seen (help) |
| 112 | Print mode | `claude -p "..."` prints one answer and exits | Runs the same loop without the interactive UI | Run `-p "say ready"`; confirm text output and exit 0 when authenticated | seen (help) |
| 113 | JSON output | `--output-format json` returns one structured result | The final result, usage, and cost are serialized | Run with JSON output and parse the object | seen (help) |
| 114 | Stream JSON | `--output-format stream-json --verbose` emits one JSON object per line | System, assistant, user, and result events are emitted in order | Run a tool-using prompt and confirm init, assistant, tool result, and result lines | seen (run) |
| 115 | Partial messages | `--include-partial-messages` adds token deltas | Text deltas are emitted as stream events | Run with the flag and confirm multiple delta events before the final message | seen (help) |
| 116 | Stream input | `--input-format stream-json` accepts messages on stdin | The process stays open for multiple turns | Send two user messages on stdin and confirm two replies | seen (help) |
| 117 | Permission flags | `--permission-mode`, `--permission-prompts none`, `--allowedTools`, `--disallowedTools` | The run's permission policy is fixed at launch | Run with `none` and a write request; confirm a denial result and exit | seen (help) |
| 118 | Tool selection | `--tools` restricts the built-in set | Tools not named are removed from the model's context | Run with only `Read`; confirm a write is impossible | seen (help) |
| 119 | Model selection | `--model` and `--fallback-model` | The model id and fallback chain are sent with each request | Run with a small model and confirm the init line names it | seen (run) |
| 120 | Session flags | `--session-id`, `--resume`, `--continue`, `--fork-session` | The transcript id and load mode are chosen at launch | Resume a known id and confirm the same conversation | seen (help) |
| 121 | Limits | `--max-turns`, `--max-budget-usd` | The loop stops at the turn or spend cap | Set one turn; confirm the run stops after one | seen (help) |
| 122 | Structured output | `--json-schema` validates the final answer | The result is checked against the schema | Request a two-field object and confirm it validates | seen (help) |
| 123 | No persistence | `--no-session-persistence` keeps the run out of history | Nothing is written to the transcript store | Run, then confirm no new transcript appears | seen (help) |
| 124 | Extra folders and agents | `--add-dir`, `--agents`, `--agent` | Adds file access or defines subagents for the run | Define a reviewer agent inline and invoke it | seen (help) |
| 125 | Settings control | `--settings`, `--setting-sources`, `--strict-mcp-config` | Overrides settings and MCP sources for one run | Load a settings file with a changed model and confirm it applies | seen (help) |
| 126 | Background and worktree | `--bg`, `--worktree`, `--tmux` | Starts a detached session or an isolated Git worktree | Start a background session, list it, attach, and stop it | seen (help) |
| 127 | Doctor and updates | `claude doctor`, `claude update`, `claude auth status` | Checks installation health, updates the binary, reports auth | Run doctor and confirm it reports the install and any problems | seen (run) |
| 128 | Subcommands | `mcp`, `config`, `agents`, `plugin`, `skills`, `setup-token`, `auth` | Each manages one configuration area | Add and remove a test MCP server through the CLI | seen (help) |

---

## 7. The Code view

The Code tab is a three-part workspace: a session list, the chat with its prompt box, and an arrangeable set of panes. The session details rail sits beside the chat when the window is wide enough.

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 129 | Window shell | Dark window with a title bar, session list, chat, and right rail | A frameless desktop window with an inset traffic-light area | Open the app; confirm all four regions and the inset controls | seen (docs) / guessed (exact pixels) |
| 130 | Session list | Chats with title, folder, and time; new-chat control; search | Reads local sessions and groups them by recency | Create, search, and open chats; confirm grouping and selection | seen (docs) |
| 131 | Session title bar | Editable title, mode and model controls, pane buttons, overflow menu | Title and controls bind to the active session | Rename, switch mode, and open a pane from the title bar | seen (docs) |
| 132 | Prompt box | Multi-line input with a send control and a **+** menu | Enter sends, Shift+Enter adds a line; stop interrupts; a correction queues | Send a multi-line prompt and confirm the line break; stop a run | seen (docs) |
| 133 | Start controls | Environment, project folder, permission mode, and model in the row under the prompt | Choices are stored per session before the first message | Pick a folder and mode, send, reopen, confirm both were kept | seen (docs) |
| 134 | Attachments | **+** opens files, skills, connectors, and plugins; drag and drop works | Attachments become content blocks; @ mentions add files | Attach an image and an @mentioned file; confirm both reach the model | seen (docs) |
| 135 | Transcript | User bubbles, assistant prose, and compact tool summaries | Markdown and tool cards render incrementally | Send a prompt with a list and a code block; confirm formatting and a tool card | seen (docs) |
| 136 | View modes | Normal, Thinking, and Verbose; Ctrl+O cycles | The renderer filters tool detail and thinking blocks | Switch to Verbose, confirm every read and command is listed | seen (docs) |
| 137 | Diff pane | File-by-file diffs with line counts and per-line comments | Reads snapshots and working-tree changes; comments are sent as a turn | Change two files, open Changes, comment on a line, submit with Cmd+Enter | seen (docs) |
| 138 | Changes card | `+12 -1` counts in the session rail; clicking opens the diff | Aggregates edits per file for the session | Make an edit and confirm the counts match the diff | seen (docs) |
| 139 | Terminal pane | A shell in the session folder with tabs and live output | A PTY shares the session's environment and working directory | Run `pwd` and `git status`; confirm the folder and a second tab | seen (docs) |
| 140 | File pane | An editor for files in the session; auto-save by default | Reads and writes the working tree; conflicts offer Override or Discard | Edit a file, confirm it saves; change it on disk, confirm the conflict choices | seen (docs) |
| 141 | Browser pane | An embedded browser with element selection and site approvals | A controlled browser session with per-site permissions | Open a local page, select an element, approve the site | seen (docs) |
| 142 | Preview | A running app preview inside the workspace | Starts the project's preview server and embeds it | Start a static server and confirm the preview loads | seen (docs) |
| 143 | Plan pane | The written plan while Plan mode is active | Displays the plan artifact and the approval action | Produce a plan and approve it from the pane | seen (docs) |
| 144 | Tasks pane | Background shells and agents with status | Reads the session's task registry | Start a background task and confirm its row and stop control | seen (docs) |
| 145 | Subagent pane | A child agent's transcript | Opens the child session linked to the parent | Spawn a subagent and open its pane | seen (docs) |
| 146 | Pane arrangement | Drag headers, resize edges, pop out, dock, minimize, close | A layout engine stores per-session pane geometry | Move the terminal, resize it, pop it out, dock it, close it with Cmd+\ | seen (docs) |
| 147 | Session rail | Cards for folder, changes, running work, and context | Aggregates Git, task, and context state | Hide and show the rail; confirm each card tracks the session | seen (docs) |
| 148 | Usage and context | A context percentage card and a usage ring | Token accounting per category and per plan | Open the context card and `/context`; confirm both agree | seen (docs) |
| 149 | Notifications | A banner when a long session finishes | The app watches completion and raises a native notification | Start a long run, switch away, confirm the notification | seen (docs) |
| 150 | Code review card | Findings grouped by file with a walk-through | Structured findings from `/code-review` | Run `/code-review` and step through one finding | seen (docs) |
| 151 | Pull request card | CI status, Auto-fix, and Merge when ready | Uses the GitHub CLI and the repository's checks | Open a PR from a test repo and confirm the status card | seen (docs) |
| 152 | Computer use | Claude can control apps with a visible cursor and approvals | A separate permissioned automation channel | Enable computer use, ask for a simple app action, approve it | seen (docs) |
| 153 | Shortcuts | Cmd+N, Ctrl+Tab, Esc, Cmd+Shift+D/B/M/I/E, Ctrl+`, Cmd+\, Cmd+;, Ctrl+O | Global key handling scoped to the Code tab | Press each shortcut and confirm its action | seen (docs) |
| 154 | Themes | Dark and light with the same layout | Tokenised colors switch by appearance | Switch appearance and confirm contrast and layout | seen (docs) / guessed (exact palette) |

**Layout numbers used for the CAELIX first pass (to be corrected by phase 3 comparison):** top bar 48 px; session list 260 px; right panel 380 px; transcript max width 800 px; composer radius 16 px; window 1440 × 900 with a 1040 × 680 minimum. **guessed** until the screenshot comparison.

**Observed tokens and labels from the shipped renderer (seen):**

- The reference dark theme is a warm neutral ramp, not blue: `#0b0b0b` at the darkest end, `#20201f`, `#2c2c2a`, `#52514e`, `#898781`, and `#f0efec` at the light end. CAELIX keeps its own navy identity; only the hierarchy is copied.
- Accent roles include a clay `hsl(15 63.1% 59.6%)` and a blue `hsl(210 70.9% 51.6%)`. The UI separates brand, accent, success, warning, and danger roles.
- The interface uses a humanist sans with a display cut and system fallbacks; code uses SF Mono, Menlo, or a monospace fallback.
- Permission mode labels in the desktop app are exactly **Manual**, **Accept edits**, **Plan**, **Auto**, and **Bypass permissions**. The CLI adds **Don't ask**.
- Permission prompt actions are **Always allow**, **Allow once**, and **Cancel**. Tool policy rows offer **Always allow**, **Ask each time**, **Ask once per session**, and **Blocked**.
- Pane menu actions use paired labels such as **Show Changes** / **Hide Changes** and **Show Browser** / **Hide Browser**.
- The session title bar hosts the title, mode, model, effort, pane buttons, and an overflow menu; the session rail is toggled as **Show session rail** / **Hide session rail**.

---

## 8. Providers, keys, and models (CAELIX requirement, not reference behaviour)

The reference uses an Anthropic account or Console key. CAELIX must run on the user's own keys and optionally on the installed Claude Code.

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 155 | Gemini key | A row on the Keys screen with paste, test, replace, delete | An AI Studio key is encrypted and used for streaming chat completions | Paste a key, test it, send a prompt, confirm a streamed reply | seen (CAELIX) |
| 156 | OpenRouter key | The same row shape | An OpenRouter key is used with routing headers and streaming | Paste a key, choose an OpenRouter model, send a prompt | seen (CAELIX) |
| 157 | NVIDIA key | The same row shape | An NVIDIA NIM key is used against the compatible endpoint | Paste a key, choose a NIM model, send a prompt | seen (CAELIX) |
| 158 | Any model id | A search field and a "use any model ID" input | The id is passed through unchanged | Enter a custom id and confirm it is used in the request | seen (CAELIX) |
| 159 | Masked storage | Only `••••••••1234` is shown after saving | The OS keychain encrypts a file outside the project; the renderer never receives the key | Save a key, reload, confirm the mask and that no plaintext appears in logs | seen (CAELIX) |
| 160 | Claude Code option | A provider row that runs the installed CLI | CAELIX spawns `claude` in the folder and maps its stream events and permissions | With a signed-in CLI, run a prompt and confirm text and tool cards arrive | seen (CAELIX code) / unknown (live) |

---

## 9. Speed and identity

| # | Feature | What the user sees | Behind the scenes | One end-to-end test | Mark |
| :-: | :- | :- | :- | :- | :- |
| 161 | Fast window | The window is usable almost immediately | Plain HTML/CSS/JS, no framework or build step; data loads after first paint | Measure process start to first paint; require under 2000 ms | seen (CAELIX: 489–829 ms) |
| 162 | Immediate words | The first token is painted as it arrives | Deltas are batched at most one animation frame | Measure send to first visible word; require under 2000 ms | seen (CAELIX: 334 ms simulated) |
| 163 | Lazy loading | Panels and model lists fill in when opened | No provider SDK, no preloading of heavy lists | Open the app with the network off; confirm the shell paints and only network features wait | seen (CAELIX) |
| 164 | Name | CAELIX in the window, menu, About panel, and bundle | `app.setName`, package metadata, and bundle plist agree | Open About and the menu; confirm CAELIX everywhere | seen (CAELIX) |
| 165 | Icon | The four-point blue-white star on deep navy with rounded corners | SVG, PNG sizes, and `.icns` generated from the official artwork | Check Dock, window, About, and the built `.app` | seen (CAELIX) |
| 166 | Desktop shortcut | An alias on the Desktop opens the app | A built `.app` plus an alias or symlink | Build, create the shortcut, launch it, confirm the icon and window | unknown (phase 3) |
| 167 | No borrowed branding | No Claude or Anthropic logo or wordmark on CAELIX | Identification text appears only for the optional provider | Inspect every screen and the bundle for foreign marks | seen (CAELIX) |

---

## 10. The journey to reproduce

This is the script CAELIX must pass, and the reference journey that could only be partly observed here.

| Step | Action | What should be visible | Evidence | Mark |
| :-: | :- | :- | :- | :- |
| 1 | Open the app | Window, session list, empty chat, prompt box, folder control | CAELIX self-check screenshot | seen (CAELIX) |
| 2 | Pick a folder | Folder name in the title and under the prompt | `checks/selfcheck.json` step "create a chat in the test folder" | seen |
| 3 | Send a prompt | User bubble, streaming assistant text, stop control | first words in 334 ms | seen |
| 4 | Watch a tool run | Tool card with name, target, spinner, then result | write card and Changes entry | seen |
| 5 | Answer a permission | Inline card with allow once / allow for session / deny | permission card accepted in self-check | seen |
| 6 | See the change | `+`/`−` counts and a line diff in Changes | `caelix-note.md` diff | seen |
| 7 | Open the terminal | Shell output and exit code in the terminal pane | `echo caelix-terminal-ok` | seen |
| 8 | Switch modes | Chip changes Manual → Plan → Accept edits | self-check step | seen |
| 9 | Rename the chat | Title updates in the bar and the list | self-check step | seen |
| 10 | Switch chats | The other chat's history loads | list selection | seen |
| 11 | Restart | The chat reopens with its messages | renderer reload step | seen |
| 12 | Compare with the reference | Same regions, spacing, and flow | blocked: desktop app not launched | unknown |

**Screenshots.** CAELIX screens are captured by its self-check. Reference screenshots require launching the desktop app with an isolated profile; doing so against the installed app would expose the user's existing chats, so it is deferred to phase 3. No screenshot data is pasted into the conversation.

---

## 11. What remains unknown

- Live model output, real token streaming, and real tool execution through the reference harness: blocked by `loggedIn: false`.
- The exact visual geometry, colors, and typography of the Code tab: only documentation, shipped strings, and stylesheet tokens were read; no reference window was opened.
- Permission prompt animation, native notification style, and pane drag physics: not observed.
- Provider-specific error text and rate-limit behaviour: not observed.
- PR, computer-use, browser, and cloud surfaces: documented but not executed.

Each of these becomes a measured item during phase 3; none may be claimed as working before a check shows it.

---

## 12. Build plan

### Part 1 — Engine, tools, CLI, and the basic window

1. Finish the harness loop: system prompt from folder + mode + memory, tool schema, streaming, tool-result feedback, retries, cancellation, usage.
2. Complete the local tool set for CAELIX: read, write, edit, multi-edit, list, glob, grep, shell, tasks, fetch, ask, plan, subagent. Each returns structured results and is cancellable.
3. Add the CAELIX command line: `caelix run "<prompt>" --cwd --mode --model --json`, `caelix doctor`, and the same event stream the window consumes.
4. Build the Keys screen and encrypted store for Gemini, OpenRouter, and NVIDIA; validate, mask, replace, delete.
5. Build the model picker with curated lists, refresh, and any model id; store the choice per chat.
6. Ship the basic window: top bar, session list, transcript, composer, empty state, and the CAELIX icon and name.
7. Make the keyless pretend model drive the whole flow in the self-check and keep the window under two seconds.

### Part 2 — Permissions, sessions, memory, changes, terminal

1. Implement Manual, Accept edits, Plan, and Bypass, with a visible chip and a per-chat mode.
2. Implement the permission engine: allow/deny/ask rules, session grants, working-directory confinement, protected paths, and inline cards with allow once / allow for session / deny.
3. Persist chats, titles, messages, tool calls, modes, models, and changes; add create, rename, delete, search, switch, and restart recovery.
4. Add project memory: `CAELIX.md`, `AGENTS.md`, imports, nested files, and an editor with approval for writes.
5. Add checkpoints and rewind: snapshot before each turn, restore code and/or conversation, and summarize a span.
6. Build the Changes panel with per-file diffs and counts, and the Terminal panel with a live shell, tabs, and exit codes.
7. Add context accounting, trimming, compaction, and a context meter.
8. Add the journey self-check steps for permission, change, terminal, rename, mode switch, and restart; save a screenshot per step.

### Part 3 — Everything else, the real Claude Code option, packaging, and the visual match

1. Add the optional Claude Code provider: spawn the installed CLI, stream its JSON events, map its permission requests, and never store an Anthropic key.
2. Add the remaining surfaces: attachments, @mentions, suggested prompts, view modes, file pane, browser pane, preview, plan pane, tasks pane, subagent pane, session rail, notifications, and keyboard shortcuts.
3. Build the macOS `.app` with the CAELIX icon, About panel, Dock icon, and a Desktop shortcut; verify the bundle identity.
4. Compare CAELIX and reference screenshots with REA, correct the largest differences first, and repeat until the similarity is at least 90%.
5. Run every feature end to end, write `CHECKLIST.md` with a tick or a cross per item, and fix every cross.
6. Record the final measurements and update `CHANGELOG.md` and the version tag.
