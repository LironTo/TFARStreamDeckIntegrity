# WebSocket protocol (v1)

Single source of truth for the messages between the game side (extension DLL, or the mock
server) and the Stream Deck plugin. Any change here must be mirrored in `mock-server/`,
`streamdeck-plugin/`, `extension/` and `addon/` in the same change; bump `v` if breaking.

## Transport

- Server: the extension DLL (or `mock-server/`). Client: the Stream Deck plugin.
- Endpoint: `ws://127.0.0.1:9800` (port configurable). Bind to `127.0.0.1` only, never `0.0.0.0`.
- Text frames, one JSON object per frame. Every message has `type` (string) and `v` (number, `1`).
- Unknown `type`, wrong `v`, or malformed JSON → ignore and log. Never crash, never disconnect
  for it.

## Radio kinds

A key targets one **radio kind**. The same identifiers are used in plugin key settings, in
`state`, and in `setChannel`.

| Kind | Meaning | Channels | Press behavior (game side) |
|---|---|---|---|
| `sw` | Active short-range (handheld) radio | 1–8 | Set channel on active SW radio |
| `lr` | Active long-range radio — whichever TFAR currently uses (vehicle seat radio when seated in a vehicle with LR, else backpack) | 1–9 | Set channel on active LR |
| `lrBackpack` | The LR radio in the player's backpack | 1–9 | Set channel on it **and make it the active LR** |
| `lrVehicle` | The vehicle LR for the player's current seat | 1–9 | Set channel on it **and make it the active LR** |
| `intercom` | Vehicle intercom | 0 = Disabled, 1 = Cargo, 2 = Crew | Set intercom channel for the player in the current vehicle |

**Channel numbers are 1-based for radios** (as shown on the radio). For `intercom`, the protocol
value is TFAR's value + 1 (TFAR: −1 / 0 / 1). The +1 conversion happens only in SQF
(`fnc_buildState` / `fnc_handleCommand`), nowhere else.

## Game → plugin

### `state`

Sent on connect, on every relevant TFAR event, on loadout / vehicle / unit changes, on
`requestState`, and by a 0.5 s change-detector safety net. Always the full state, never a diff.

```json
{
  "type": "state",
  "v": 1,
  "inGame": true,
  "sw": {
    "present": true,
    "radio": "TFAR_anprc152_1",
    "channel": 3,
    "additionalChannel": null,
    "frequencies": ["115.9", "255.9", "204.2", "506.6", "477.4", "291.1", "402.7", "260"]
  },
  "lr": {
    "present": true,
    "source": "vehicle",
    "radio": "B_MRAP_01_F",
    "channel": 1,
    "additionalChannel": null,
    "frequencies": ["42.9", "52.3", "82.9", "37.5", "77", "50.8", "65.9", "59", "31.7"]
  },
  "lrBackpack": {
    "present": true,
    "radio": "TFAR_rt1523g",
    "channel": 2,
    "additionalChannel": null,
    "frequencies": ["42.9", "52.3", "82.9", "37.5", "77", "50.8", "65.9", "59", "31.7"]
  },
  "lrVehicle": {
    "present": true,
    "radio": "B_MRAP_01_F",
    "channel": 1,
    "additionalChannel": null,
    "frequencies": ["42.9", "52.3", "82.9", "37.5", "77", "50.8", "65.9", "59", "31.7"]
  },
  "intercom": {
    "present": true,
    "channel": 2
  }
}
```

Field rules:

- `inGame: false` → no mission / no player. All radio objects then are `{ "present": false }`.
- A radio object with `present: false` has no other fields.
- `radio`: SW → radio instance classname; LR → `typeOf` the backpack or vehicle.
- `lr.source`: `"backpack"` or `"vehicle"` — which physical radio is the active LR.
- `frequencies`: exactly 8 strings for `sw`, exactly 9 for LR kinds (TFAR's arrays carry one extra
  trailing entry; the game side truncates). Frequency strings are passed through as TFAR stores
  them (e.g. `"260"`, `"45.5"`).
- `channel`: 1-based active channel. `additionalChannel`: 1-based, or `null` when none.
- `intercom.present`: player is in a vehicle that has an intercom.

## Plugin → game

```json
{ "type": "hello", "v": 1, "client": "streamdeck" }
{ "type": "requestState", "v": 1 }
{ "type": "setChannel", "v": 1, "radio": "sw", "channel": 3 }
```

- `hello`: sent once right after connecting. The server answers with a `state`.
- `requestState`: server answers with a `state`.
- `setChannel`: `radio` is a radio kind from the table above; `channel` in the kind's range.
  Out-of-range channel or a kind that is not `present` → ignore and log. After applying, the game
  sends a fresh `state` (the plugin does not update keys optimistically).

## Plugin display rules (reference)

| Situation | Key title | Key background |
|---|---|---|
| Not connected | `OFFLINE` | idle (dark gray) |
| Connected, `inGame: false` | `—` | idle |
| Kind not present | `<TAG> <n>` + `NO RADIO` (intercom: `NO IC`) | idle |
| Radio present | `<TAG> CH<n>` (or custom label) + newline + frequency | active color if `channel == n`; additional color if `additionalChannel == n`; both → active fill with additional-colored frame; else idle |
| Intercom present | `IC` + newline + `OFF` / `CARGO` / `CREW` | active color if selected, else idle |

Default colors: short range green / orange, long range (all LR kinds) blue / purple, intercom
teal. Per-key override with the "Custom colors" setting.
