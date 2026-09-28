# TFAR Stream Deck

Stream Deck keys for **Task Force Arrowhead Radio** (Arma 3): each key shows a radio channel's
frequency, highlights the active channel, and switches to it on press.

Supported per key: short-range (handheld), long-range (active / backpack / vehicle seat), and
vehicle intercom (Crew / Cargo / Disabled).

```
Arma 3 + TFAR ─ SQF addon ─ callExtension ─ tfar_sd_x64.dll (WebSocket 127.0.0.1:9800) ─ Stream Deck plugin
```

| Folder | What |
|---|---|
| `addon/` | Client-side SQF mod (HEMTT). Reads TFAR state, applies channel changes |
| `extension/` | Rust Arma extension (`arma-rs`), local WebSocket server |
| `streamdeck-plugin/` | Stream Deck plugin (`@elgato/streamdeck`, TypeScript), UUID `com.liron.tfar` |
| `mock-server/` | Fake game side for plugin development without Arma |
| `docs/` | `protocol.md` (WebSocket protocol v1), `tfar-api-notes.md`, `testing.md` |

## Build

Requires Node ≥ 24, Rust (`x86_64-pc-windows-msvc`), HEMTT, Stream Deck ≥ 7.1.

```powershell
# Mod (DLL + PBO) → C:\Arma3Dev\@tfar_sd  (add it as a local mod in the Arma launcher)
powershell -File build.ps1

# Stream Deck plugin
cd streamdeck-plugin; npm install; npm run build; npx streamdeck link com.liron.tfar.sdPlugin
```

**BattlEye:** the extension DLL is not BattlEye-whitelisted, so it only works with BattlEye off
(e.g. servers without BattlEye). With BattlEye on, the mod stays inactive and the game runs normally.

Requires CBA_A3 and TFAR 1.0 (tested with 1.-1.0.341).
