# CAELIX

A free, local AI coding agent for macOS. Electron + plain HTML/CSS/JS — no React, no build tools, no telemetry. Your keys, your files, your machine.

CAELIX gives you a full coding-agent harness — planning modes, tool permissions, checkpoints, diffs, terminal tabs, an embedded browser, and a **multi-model "Team Mode"** where one AI builds and an independent AI from a different provider reviews and proves the work — running entirely on **free API tiers at $0**.

## Install

1. Download `CAELIX-<version>.dmg` from the [latest release](../../releases/latest).
2. Open the DMG and drag **CAELIX** into **Applications**.
3. First launch — macOS will warn because CAELIX is signed locally, not with a paid Apple certificate. **The app is not damaged.** Do one of these, once:
   - Terminal: `xattr -cr /Applications/CAELIX.app` then open CAELIX normally, or
   - right-click **CAELIX.app → Open → Open**.

If macOS says the app "is damaged and can't be opened", that is Gatekeeper quarantine, not a corrupted download — use the `xattr` command above. You can confirm the download itself is intact by comparing SHA-256 with the value in the release notes:

```bash
shasum -a 256 ~/Downloads/CAELIX-<version>.dmg
```

Requires macOS 12+. No other dependencies — everything runs locally.

## Updates

CAELIX checks its own GitHub releases on startup. When a newer version exists, an **Update** button appears in the top bar — click it once and the app downloads, verifies and installs the new version, then restarts itself. No manual downloads after the first install. (Versions older than 0.1.39 do not have the button, so they need one manual update.)

## Add your free keys (2 minutes)

Open **Keys** in the app and paste free API keys from any of these — all have $0 tiers:

| Provider | Get a key |
|---|---|
| Groq | console.groq.com/keys |
| Google Gemini | aistudio.google.com/apikey |
| NVIDIA NIM | build.nvidia.com |
| OpenRouter | openrouter.ai/keys |
| Coarena | coarena.ai/account/api |
| Numes | numes.ai/dashboard/keys |

**Kilo Gateway needs no key at all** — it works the moment you install the app (anonymous free tier, 200 requests/hour).

Keys are encrypted with the macOS keychain (via Electron's Safe Storage) and stored **outside** this project folder. They are never written to logs, chats, or Git. The UI shows masks only. No key yet? CAELIX also ships with a built-in **Simulator** provider so you can try the whole interface with no account.

## What it does

- **Chat and Code workspaces** — chat for conversation, a full workspace for real projects with folder picker, changes panel, and terminal tabs
- **Permission modes** — Manual (approve every edit), Accept Edits, Plan (read-only), Bypass, per chat
- **23 built-in tools** — files, grep/glob, bash, notebooks, web fetch/search, an embedded Playwright-style browser pane, tasks, skills, subagents, and MCP servers
- **Tiered model routing** — cheap fast models handle research and chat titles; your strongest model is saved for planning and edits
- **Instant diagnostics after every edit** — `node --check`, TypeScript `tsc --noEmit` (touched files *and* cross-file callers), ESLint, Python compile/ruff/pyright, `go vet`, `cargo check` results go straight back to the model
- **Mid-turn steering** — type corrections while the agent is still working; they're injected at the next step instead of being rejected
- **Team Mode (toggle the Team chip)** — after edits, a second brain from a different provider family reviews the diff, fixes bugs, and runs the code to prove it. You can pick both models (Builder + Reviewer) yourself or leave it on Auto
- **Checkpoints** — every edit run is captured; restore any earlier state
- **Context compaction** — long sessions are summarized instead of dropped, and a live repo symbol map keeps multi-file work on track

## CLI

The same engine, headless:

```bash
node src/cli.js run "fix the failing test in test/app.js" --cwd . --provider groq --mode accept --yes
node src/cli.js run "refactor lib/ to async" --cwd . --provider kilo --mode bypass --yes --review
node src/cli.js --help
```

## Build from source

```bash
npm install          # installs Electron only
npm run doctor       # environment check
npm run package      # builds dist/CAELIX.app (signed locally, no prompts)
node scripts/make-dmg.js   # builds dist/CAELIX-<version>.dmg
npm run selfcheck    # end-to-end self-test (28 checks, headless)
```

No native compilation, no bundled runtimes beyond Electron itself. Requires Node.js 22+ to build.

## Honest limits

- **Free models are not frontier models.** On small/medium tasks (debugging, scripts, multi-file features) CAELIX matches paid agents on correctness in our benchmarks; on very large 20+ file refactors, flagship models still hold instructions better. Team Mode closes most of that gap.
- **Free tiers rate-limit.** The engine auto-fails-over across providers and models, but heavy all-day use benefits from keys on 2–3 providers.
- **Speed:** Team Mode double-checks your work, so runs take longer than a single unreviewed pass.
- **Privacy:** free model routes may log or train on prompts depending on the provider (each provider's terms are linked in Keys). Nothing ever leaves your machine except the model API calls you choose to make.

## Benchmarks (this repo, `checks/bench-hard.js`)

Every task is verified by an independent checker recomputing ground truth — never by trusting the agent's own report.

| Setup | Hard-task suite | Multi-file refactor (10 files) |
|---|---|---|
| Solo free model | 7/8 | 1 of 2 models solved it (81 s) |
| **CAELIX Team Mode** (build + independent review, 3 provider families) | **12/12** | **3/3** (reviewer rescued the task the solo brain timed out on) |

## Repository layout

```
src/main.js          Electron main process (windows, IPC, keychain)
src/engine/          The agent: provider calls, tools, routing, steering,
                     diagnostics, checkpoints, team review
src/renderer/        The UI (plain HTML/CSS/JS)
src/cli.js           Headless CLI
scripts/             package.js (app bundle), make-dmg.js (DMG)
```

## License

MIT — see [LICENSE](LICENSE).
