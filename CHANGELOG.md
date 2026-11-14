# CAELIX changelog

## 0.1.0 — first version

- CAELIX Electron window with the official four-point-star icon (SVG, PNG sizes, `.icns`) used in the window, Dock and About panel.
- Three-column Code workspace: sidebar with chats, central transcript and composer, right Changes/Terminal panel.
- Keys screen for Gemini, OpenRouter and NVIDIA; keys encrypted with the macOS keychain outside the project and returned to the UI only as a mask.
- Model picker with curated lists and any custom model ID; mode picker with Ask, Accept edits, Plan and Bypass.
- Streaming engine with local tools (read, write, edit, list, glob, grep, shell, tasks, fetch), permission cards and a visible change history.
- Optional bridge that runs the installed `claude` command and streams its events into the same transcript.
- Saved chats, rename, reload persistence, terminal panel and project folder picker.
- Self-check: a keyless pretend model drives the real window through keys, streaming, permission, file write, terminal, rename, mode switch, panel and restart; writes `checks/selfcheck.png` and `checks/selfcheck.json`.
