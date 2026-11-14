# CAELIX changelog

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
