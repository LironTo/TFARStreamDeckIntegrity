# CLAUDE.md — Stream Deck ↔ Arma 3 TFAR integration

## Communication

- The user speaks **Hebrew**. Always reply to the user in Hebrew.
- Code, identifiers, commit messages, and code comments are in **English**.
- The user plays Arma 3 on Windows. You cannot run Arma 3 or press Stream Deck keys yourself.
  Whenever something must be verified in-game or on the device, stop and give the user a short,
  numbered test procedure (in Hebrew), then wait for their result before continuing.

## Project goal

A Stream Deck plugin where each key represents a TFAR radio channel:

1. The key **shows the frequency** of its channel (e.g. `CH3` / `45.5`), and highlights the channel
   the player is currently on.
2. **Pressing the key switches** the player's radio to that channel in-game.

TFAR = Task Force Arrowhead Radio (Arma 3 mod, requires CBA_A3).

## Architecture

```
┌──────────────┐  callExtension   ┌──────────────┐  WebSocket   ┌──────────────┐  SDK   ┌────────────┐
│ Arma 3 +TFAR │ ───────────────► │ Extension    │ ───────────► │ Stream Deck  │ ─────► │ Keys       │
│ SQF addon    │ ◄─────────────── │ DLL (Rust)   │ ◄─────────── │ plugin (TS)  │ ◄───── │ (display + │
│ (client mod) │ ExtensionCallback│ WS server    │ 127.0.0.1    │ WS client    │        │  press)    │
└──────────────┘                  └──────────────┘              └──────────────┘        └────────────┘
```

- **addon/** – client-side SQF mod. Reads TFAR state via the TFAR API, pushes it to the extension,
  receives commands via the `ExtensionCallback` mission event handler and calls TFAR setters.
- **extension/** – Arma 3 extension DLL (Rust + `arma-rs`). Runs a local WebSocket server on a
  background thread. Bridges SQF ⇄ plugin. Must never block the game thread.
- **streamdeck-plugin/** – Elgato Stream Deck SDK plugin (Node.js + TypeScript). WebSocket client.
- **mock-server/** – standalone Node WebSocket server that speaks the same protocol as the
  extension, so the plugin can be developed and tested without launching Arma.

### Fallback mode (no DLL)

TFAR has built-in keybinds NUM1–NUM8 for quick short-range channel switching. This works on any
server, including BattlEye-protected ones, but gives no frequency feedback. It is the MVP
(Phase 2, done manually with the BarRaider "Super Macro" plugin, no code).

## Repository layout (target)

```
/
├── CLAUDE.md
├── docs/
│   ├── protocol.md            # single source of truth for the WS protocol
│   ├── tfar-api-notes.md      # results of in-game API verification (Phase 1)
│   └── testing.md             # manual in-game test procedures
├── reference/                 # READ-ONLY third-party sources (see "TFAR reference source")
│   └── tfar/                  # TFAR mod (unpacked PBOs and/or GitHub source)
├── mock-server/
│   ├── package.json
│   └── src/index.ts
├── streamdeck-plugin/         # scaffolded by `streamdeck create`
│   ├── com.liron.tfar.sdPlugin/
│   │   ├── manifest.json
│   │   ├── imgs/
│   │   └── ui/channel.html    # property inspector
│   ├── src/
│   │   ├── plugin.ts
│   │   ├── actions/tfar-channel.ts
│   │   ├── connection.ts      # WS client with auto-reconnect
│   │   └── state.ts           # typed game state store + event emitter
│   └── package.json
├── extension/                 # Rust crate, cdylib → tfar_sd_x64.dll
│   ├── Cargo.toml
│   └── src/lib.rs
└── addon/                     # HEMTT project
    ├── .hemtt/project.toml
    └── addons/main/
        ├── config.cpp
        ├── XEH_postInit.sqf
        └── functions/
```

## Tech stack & requirements

| Component | Stack | Notes |
|---|---|---|
| Stream Deck plugin | Node.js ≥ 24, TypeScript, `@elgato/streamdeck` (SDK v2+/v3), Stream Deck app ≥ 7.1 | Scaffold with `@elgato/cli` |
| Mock server | Node.js + `ws` | Same protocol as the extension |
| Extension | Rust, `arma-rs`, x64 only, target `x86_64-pc-windows-msvc` | 64-bit Arma cannot load 32-bit DLLs |
| Addon | SQF, CBA_A3 (XEH + keybinds), HEMTT for building | Signed with our own key |

## Commands

```bash
# Stream Deck CLI (once)
npm install -g @elgato/cli@latest

# Plugin
cd streamdeck-plugin
npm install
npm run build
npm run watch                          # rebuild + restart plugin on change
streamdeck restart com.liron.tfar
streamdeck validate com.liron.tfar.sdPlugin
streamdeck pack com.liron.tfar.sdPlugin   # → .streamDeckPlugin

# Mock server
cd mock-server && npm install && npm start

# Extension
cd extension
cargo test

# Full build (DLL + HEMTT addon) → local mod in C:\Arma3Dev\@tfar_sd (ASCII path; load it in the launcher)
powershell -File build.ps1          # from repo root

# Addon
cd addon
hemtt dev      # dev build
hemtt build
hemtt release  # signed release
```

Plugin logs: `%APPDATA%\Elgato\StreamDeck\Plugins\com.liron.tfar.sdPlugin\logs\`
Arma logs: `%LOCALAPPDATA%\Arma 3\*.rpt`

## WebSocket protocol (v1)

Full spec lives in `docs/protocol.md` — keep it in sync with code. Summary:

- Endpoint: `ws://127.0.0.1:9800` (port configurable; bind to localhost only, never 0.0.0.0).
- All messages are JSON objects with `type` and `v` (protocol version, currently `1`).
- **Channel numbers in the protocol are 1-based** (as shown to humans). All 0/1-based conversion
  happens in SQF only, in one helper function.

Game → plugin:

```json
{
  "type": "state",
  "v": 1,
  "inGame": true,
  "sw": {
    "present": true,
    "radio": "TFAR_anprc152_3",
    "channel": 2,
    "additionalChannel": null,
    "frequencies": ["30", "31.2", "45.5", "50", "60", "70", "80", "90"]
  },
  "lr": {
    "present": false
  }
}
```

Radio kinds (per key, chosen in the property inspector): `sw`, `lr` (active LR), `lrBackpack`,
`lrVehicle`, `intercom` (0=Disabled, 1=Cargo, 2=Crew). The state message carries one object per
kind — see `docs/protocol.md` for the full example.

Plugin → game:

```json
{ "type": "hello", "v": 1, "client": "streamdeck" }
{ "type": "requestState", "v": 1 }
{ "type": "setChannel", "v": 1, "radio": "sw", "channel": 3 }
```

Rules:
- The game sends a full `state` on connect, on every TFAR change event, on radio add/remove,
  on death/respawn, and on `requestState`. No diffs — always full state.
- Unknown `type` → ignore and log. Malformed JSON → ignore and log. Never crash.
- `inGame: false` when no mission is running (extension up, but no player).

## TFAR reference source (`reference/tfar/`)

The user adds the TFAR mod itself to the repo so Claude Code can read the real implementation
instead of guessing. This is the **primary source of truth** for TFAR behavior, above wiki pages
and forum posts.

Rules:
- `reference/` is **read-only**. Never edit, build, or reformat anything in it.
- Do not copy TFAR code into our addon. Read it, understand it, call its public functions.
  Respect TFAR's license.
- Keep `reference/` out of git history if it contains unpacked Workshop files
  (add `reference/` to `.gitignore`), or add the GitHub source as a git submodule.
- When a fact comes from the source, record it in `docs/tfar-api-notes.md` **with the file path**
  (e.g. `reference/tfar/addons/core/functions/fnc_setSwChannel.sqf`), so it can be re-checked
  after TFAR updates.

How the user populates it (Claude Code: if `reference/tfar/` is empty or missing, walk the user
through one of these, in Hebrew):
1. **Preferred — GitHub source (plain text, easy to search):**
   `git clone https://github.com/michail-nikolaev/task-force-arma-3-radio reference/tfar-src`
   then check out the tag/branch that matches the installed Workshop version.
2. **Installed Workshop mod (exactly what runs in-game):** the mod lives under
   `...\steamapps\common\Arma 3\!Workshop\@Task Force Arrowhead Radio (BETA!!!)\`
   (folder name may differ). Its `addons\*.pbo` files are binary archives — unpack them into
   `reference/tfar/` with BankRev (Arma 3 Tools) or HEMTT's PBO utilities. Do not try to read
   `.pbo` files directly.
   The `teamspeak\` subfolder holds the TS3 plugin installer — not needed for this project.

First thing to do after the reference is added (before Phase 1 in-game tests):
- Record the TFAR version (from `mod.cpp` / `meta.cpp` / release notes in the reference).
- Find the `CfgPatches` class names (needed for our addon's `requiredAddons[]`; expected something
  like `tfar_core` for TFAR 1.0 — verify in `config.cpp`).
- Locate and read these, then resolve as many UNVERIFIED items below as possible from the code:
  - `fnc_setSwChannel`, `fnc_getSwChannel`, `fnc_getChannelFrequency`, `fnc_getSwFrequency`
  - LR equivalents (`fnc_setLrChannel`, `fnc_getLrChannel`, `fnc_activeLrRadio`)
  - `fnc_addEventHandler` and where events are fired (search for `fireEventHandlers` or similar)
  - Whether a channel switch (not a frequency change) fires any event
  - The keybind definitions for NUM1–NUM8 (search for `CBA_fnc_addKeybind`) — useful for the fallback mode
- Items resolved from source are marked "verified (source)"; they still get one in-game
  confirmation in Phase 1, but the in-game test list becomes much shorter.

Useful searches (run from repo root):

```bash
grep -rn "fnc_setSwChannel\|fnc_getSwChannel" reference/tfar --include=*.sqf --include=*.hpp --include=*.cpp
grep -rn "addEventHandler\|fireEventHandlers" reference/tfar --include=*.sqf
grep -rn "OnFrequencyChanged\|OnSWchannelSet\|OnLRchannelSet" reference/tfar
grep -rn "CBA_fnc_addKeybind\|addKeybind" reference/tfar
grep -rn "class CfgPatches" -A 5 reference/tfar --include=config.cpp
```

## TFAR API — what we know

Verified from TFAR wiki (API: Functions):

- `call TFAR_fnc_activeSwRadio` → active short-range radio (STRING classname).
- `call TFAR_fnc_activeLrRadio` → active long-range radio (ARRAY, not a string).
- `(call TFAR_fnc_activeSwRadio) call TFAR_fnc_getSwChannel` → current channel.
- `(call TFAR_fnc_activeSwRadio) call TFAR_fnc_getSwFrequency` → frequency of active channel.
- `[(call TFAR_fnc_activeSwRadio), 2] call TFAR_fnc_setSwChannel` → switch channel.
- `[(call TFAR_fnc_activeSwRadio), 1] call TFAR_fnc_getChannelFrequency` → frequency of a channel.
- `call TFAR_fnc_haveSWRadio` → BOOL.
- Event handlers exist: `OnFrequencyChanged` `[unit, radio, channel, oldFreq, newFreq]` and
  `OnFrequencyChangedFromUI` `[unit, radio, freq]`.

**UNVERIFIED — resolve first from `reference/tfar/`, then confirm in-game (Phase 1), and record
in `docs/tfar-api-notes.md` before writing addon code. Do not guess:**

- [x] TFAR version and `CfgPatches` names — 1.-1.0.341, `tfar_core` (verified, source).

- [x] (verified source + in-game) Channel index base for each of `getSwChannel`, `setSwChannel`, `getChannelFrequency`
      (community code suggests `getSwChannel` is 0-based while `getChannelFrequency` is 1-based).
- [x] (source) Exact signature of `TFAR_fnc_addEventHandler` in the installed TFAR version.
- [x] (verified source + in-game: `OnSWchannelSet`/`OnLRchannelSet`) Which event fires on plain channel switch (not frequency change). If none, detect by
      comparing state in a low-frequency `CBA_fnc_addPerFrameHandler` (e.g. every 0.5 s).
- [x] (source) LR equivalents (`setLrChannel`, `getLrChannel`, how the array is passed).
- [x] Behavior with no radio, in vehicles (vehicle LR) — verified in-game. Death/respawn deferred to Phase 6 test matrix.
- [x] TFAR version in use (1.0 beta vs 0.9.12) — 1.0 beta — API differs between them.

## Constraints & gotchas

- **BattlEye**: non-whitelisted extensions are blocked on clients with BattlEye enabled
  (`callExtension` fails; RPT shows "Insufficient system resources..."). Develop with BattlEye off.
  Whitelisting is requested via the BattlEye contact page ("Other requests"). The SQF addon must
  detect a missing/blocked extension gracefully and simply do nothing.
- **Server signatures**: community servers may reject unsigned/unknown client mods; the server
  needs our `.bikey`.
- **Never block the game thread** in the extension. `callExtension` is synchronous: return
  immediately, do all network I/O on a background thread, pass data through channels/queues.
- Use the extension callback mechanism (`ExtensionCallback` mission event handler) to push
  commands into SQF. No SQF polling loops for commands.
- SQF runs on the client only (`hasInterface` guard). Do nothing on dedicated servers / HCs.
- Stream Deck `setTitle` is plain text; use `\n` for two lines. Keys are single-state; the
  highlight is a dynamic SVG via `setImage` (active / additional / both), colored per radio kind
  (`DEFAULT_COLORS` in `streamdeck-plugin/src/render.ts`) or per key with "Custom colors".
- Plugin must handle: extension not running, game closed mid-session, reconnect loop with backoff
  (1s → 2s → 5s, max 5s), and show `—` / `NO RADIO` / `OFFLINE` on keys accordingly.

## Roadmap

Work strictly phase by phase. Do not start a phase until the previous phase's acceptance criteria
are met and the user confirms. Update the checkboxes here as work completes.

### Phase 0 — Environment (user, manual)
- [x] Node 24, Stream Deck ≥ 7.1, VS Code, `@elgato/cli` installed
- [x] Rust toolchain + `x86_64-pc-windows-msvc` target, HEMTT installed
- [x] Eden test mission with CBA + TFAR, one soldier with SW + LR radio
- [x] TFAR reference added under `reference/tfar/` (and `reference/` in `.gitignore` if unpacked PBOs)
**Done when:** `node -v` ≥ 24, `streamdeck -v`, `cargo -V`, `hemtt --version` all work,
and `reference/tfar/` contains readable `.sqf` files.

### Phase 1 — API verification (source first, then in-game)
- [x] Claude reads `reference/tfar/` and drafts `docs/tfar-api-notes.md` with file-path citations
- [x] Claude writes a short list of debug-console snippets only for what the source can't settle
- [x] User runs them and pastes results
- [x] Claude writes `docs/tfar-api-notes.md` and resolves every UNVERIFIED item above
**Done when:** every UNVERIFIED checkbox above is resolved.

### Phase 2 — No-code MVP (user, manual)
- [ ] BarRaider Super Macro keys sending NUM1–NUM8, static labels
**Done when:** pressing a key switches SW channel in-game.

### Phase 3 — Plugin skeleton + mock server
- [x] `docs/protocol.md` written
- [x] Mock server: sends `state`, cycles/changes values, logs received `setChannel`, applies it
- [x] Plugin: action `com.liron.tfar.channel` with settings `{ radio: "sw"|"lr"|"lrBackpack"|"lrVehicle"|"intercom", channel, label?: string }`
- [x] Property inspector for those settings
- [x] Connection manager with auto-reconnect; state store; all visible keys re-render on state change
- [x] Key press sends `setChannel`
- [x] Unit tests for state → title/state mapping
**Done when:** with mock server running, keys show frequencies, highlight the active channel, and
pressing a key changes the active channel in the mock.
✅ Phase 3 confirmed by user 2026-09-28.

### Phase 4 — Extension DLL
- [x] Rust crate with `arma-rs`, exports: `version`, `start`, `stop`, `state(json)`, `status`
- [x] WS server on background thread; forwards `state` to all clients; forwards commands via callback
- [x] Loads/unloads cleanly; no panics across FFI boundary
**Done when:** plugin connects to the DLL loaded in Arma (BattlEye off) and receives a hand-sent state.
✅ Phase 4 confirmed in-game by user 2026-09-28 (one reader + one writer thread per client; diagnostics in `%LOCALAPPDATA%\Arma 3\tfar_sd.log`).

### Phase 5 — SQF addon
- [x] CBA postInit (client only), start extension, register TFAR handlers
- [x] `tfar_sd_fnc_buildState`, `fnc_sendState`, `fnc_handleCommand`; index conversion only in `tfar_sd_fnc_convertChannel` (files `addon/addons/main/functions/fn_*.sqf`, CfgFunctions)
- [x] Handle no radio / vehicle radios / intercom (death & respawn → Phase 6 matrix)
**Done when:** real in-game frequencies appear on keys and pressing a key switches the channel.
✅ Phase 5 confirmed in-game by user 2026-09-28 (SW, LR backpack/vehicle, intercom; `DisableAutomaticStates` in manifest;
gotcha: bare `call` inherits `_this` — always pass `[]` explicitly).

### Phase 6 — Integration & polish
- [ ] Test matrix in `docs/testing.md` (restart plugin mid-game, rejoin server, change freq in radio UI, respawn)
- [~] Optional: fallback to keypress (NUM1–8) when offline — skipped by user decision (their server has no BattlEye)
**Done when:** all test matrix rows pass.

### Phase 7 — Distribution
- [ ] `streamdeck pack`, versioned release
- [ ] Signed addon + `.bikey`, Workshop upload (unlisted)
- [~] BattlEye whitelist request — not needed for now (user's server has no BattlEye)

## Working rules for Claude Code

1. Before writing addon code, read `docs/tfar-api-notes.md`. Never invent TFAR/CBA function
   signatures: look them up in `reference/tfar/` first; if the source is unclear, ask the user
   to verify in the debug console. Never modify anything under `reference/`.
2. Any protocol change → update `docs/protocol.md`, mock server, plugin, and extension together,
   and bump `v` if breaking.
3. Keep each change small and testable. After each phase, summarize in Hebrew what was done and
   what the user needs to test.
4. Prefer the mock server for all plugin work; ask for in-game testing only when necessary.
5. Do not commit build outputs (`bin/`, `target/`, `.hemttout/`, `*.dll`) or unpacked
   third-party files (`reference/`) — keep `.gitignore` updated.
6. Plugin UUID is `com.liron.tfar` (Node 24.19, Stream Deck 7.5.1, cargo 1.98, HEMTT 1.22 installed 2026-09-28).
