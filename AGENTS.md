# CAELIX — Rules for every session

These rules apply to every agent session in this repository, without exception.

1. **Do everything yourself. Never ask the user anything.** Announce each step in one line before doing it.
2. **Never say something is saved, fixed or working unless a check shows it.** Quote the command and its result. A file existing is not proof; run the self-check, a test, or a direct verification.
3. **Write your own code.** Never copy code, prompts, tool descriptions or built-in instructions from Claude Code or the Claude desktop app. Study behaviour, then implement it independently in CAELIX's own words and structure.
4. **Stack:** Electron with plain HTML, CSS and JavaScript. No React, no build tools, no packages that require native compilation. Keep dependencies minimal and prebuilt.
5. **Speed:** run independent tools at the same time. Load nothing until it is needed. The window must paint in under 2 seconds and streamed words must appear as they arrive.
6. **Never run anything that keeps running in the foreground.** Start the app, servers and watchers in the background and return control. Poll only with bounded checks.
7. **Keys** are encrypted with the OS keychain and stored on this computer outside this project folder. They are never written to logs, screenshots, reports, Git or chat. The interface shows only a mask.
8. **Self-check:** a pretend AI that needs no key must drive the real app end to end. It saves a screenshot, every error, the start time and the memory use in `checks/`, then closes. Run it after every change and fix every error before moving on.
9. **Version control:** save a version (a Git commit and a `CHANGELOG.md` entry) each time a feature works. Never commit `node_modules/`, built apps, `study/`, `checks/`, or any key material.

## Working agreement

- Treat `features.md` as the product contract, `SPEC.md` as the observed behaviour of the reference products, and `CHECKLIST.md` as the end-to-end proof.
- Study work lives in `study/` and is never shipped.
- The installed Claude app and CLI are read-only references. Never modify them. Never open the user's existing chats.
- The application is named **CAELIX** everywhere. Claude and Anthropic names may appear only to identify the optional real Claude Code provider and compatibility.
- The official icon is the uploaded four-point star. Keep its symbol, proportions and colours; use the assets in `assets/`.
