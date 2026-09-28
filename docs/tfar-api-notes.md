# TFAR API notes

Source of truth: `reference/tfar/` — text files extracted from the installed Workshop PBOs
(`@Task Force Arrowhead Radio (BETA!!!)/addons/*.pbo`, Workshop id 894678801).
All paths below are relative to `reference/tfar/z/tfar/addons/`.

Status legend: **verified (source)** = read in code, **verified (in-game)** = confirmed in the
debug console, **pending** = waiting for in-game test.

## Version

- TFAR **1.-1.0.341** (1.0 beta line). `core/script_version.hpp`: `MAJOR 1`, `MINOR -1`,
  `PATCHLVL 0`, `BUILD 341`. PBO version stamp `d76d8b32`. — verified (source)
- The 1.0 API applies (not 0.9.12).

## CfgPatches (for `requiredAddons[]`)

From `*/config.bin` (binarized): `tfar_core`, `tfar_handhelds`, `tfar_backpacks`,
`tfar_static_radios`, `tfar_antennas`, `tfar_ai_hearing`, `tfar_external_intercom`.
Our addon needs only **`tfar_core`** (all API functions live there) plus `cba_main`. — verified (source)

## Channel index base — verified (source + in-game P1-A, P1-B)

TFAR stores the active channel **0-based** in the radio settings array
(`core/defines.hpp`: `ACTIVE_CHANNEL_OFFSET 0`, `TFAR_FREQ_OFFSET 2`,
`TFAR_ADDITIONAL_CHANNEL_OFFSET 5`).

| Function | Channel base | Evidence |
|---|---|---|
| `TFAR_fnc_getSwChannel` | **0-based** | `core/functions/fnc_getSwChannel.sqf` returns settings[0] raw |
| `TFAR_fnc_setSwChannel` | **0-based** | `core/functions/fnc_setSwChannel.sqf` stores raw; keybind NUM1 calls it with `0` (`core/functions/fnc_initKeybinds.sqf`, `SWChannel1` → `[0] call TFAR_fnc_processSWChannelKeys`) |
| `TFAR_fnc_getLrChannel` | **0-based** | `core/functions/fnc_getLrChannel.sqf` |
| `TFAR_fnc_setLrChannel` | **0-based**, "Range (0,8)" | `core/functions/fnc_setLrChannel.sqf` |
| `TFAR_fnc_getChannelFrequency` | **1-based** (does `_channel - 1`) | `core/functions/fnc_getChannelFrequency.sqf` |
| `TFAR_fnc_setChannelFrequency` | **1-based** | `core/functions/fnc_setChannelFrequency.sqf` |
| `TFAR_fnc_getAdditionalSwChannel` / `...Lr...` | 0-based; `-1` = none | `core/functions/fnc_getAdditional*Channel.sqf` |

Conversion rule for our addon (in one helper only): `protocolChannel = tfarChannel + 1`.

## Channel counts — verified (source)

- SW: **8** channels (`TFAR_MAX_CHANNELS 8`, `core/defines.hpp`).
- LR: **9** channels (`TFAR_MAX_LR_CHANNELS 9`; keybind `LRChannel9` exists).
  → Protocol must allow `channel` 1..9 for `lr`, 1..8 for `sw`.
- **Gotcha — frequency arrays have one extra entry** (9 for SW, 10 for LR; seen in-game P1-A).
  Cause: `for "_i" from 0 to TFAR_MAX_CHANNELS` (inclusive) in
  `core/functions/fnc_generateSrSettings.sqf` / `fnc_generateLrSettings.sqf` /
  `fnc_generateFrequencies.sqf`. The UI caps channels at `TFAR_MAX_CHANNELS` / `TFAR_MAX_LR_CHANNELS`
  (`core/functions/events/ui/fnc_setChannelViaDialog.sqf`).
  → `fnc_buildState` must **truncate** to 8 (SW) / 9 (LR).

## Radios

- `TFAR_fnc_activeSwRadio` → STRING classname, or **nil** when no SW radio (loops over
  `assignedItems TFAR_currentUnit`). `core/functions/fnc_activeSwRadio.sqf`
- `TFAR_fnc_activeLrRadio` → ARRAY `[radioObject, radioQualifier]`, or **nil**.
  Candidates come from `TFAR_fnc_lrRadiosList`: override / active / **backpack** / **vehicle LR**.
  `core/functions/fnc_activeLrRadio.sqf`, `core/functions/fnc_lrRadiosList.sqf`
- `TFAR_fnc_haveSWRadio`, `TFAR_fnc_haveLRRadio` → BOOL, false if `TFAR_currentUnit` is nil/null.
- **Gotcha — `TFAR_fnc_haveSWRadio` is cached** until `TFAR_lastLoadoutChange` moves
  (`core/functions/fnc_haveSWRadio.sqf`). A scripted `unlinkItem` does not bump it, so it returned
  `true` while `activeSwRadio` was already nil (in-game P1-C). → Our addon decides "SW present"
  by `!isNil {call TFAR_fnc_activeSwRadio}`, never by `haveSWRadio`.
- LR getters take the array spread as `_this`: `(call TFAR_fnc_activeLrRadio) call TFAR_fnc_getLrChannel`.
- Frequencies are STRINGS in settings (e.g. `"45.5"`). `getChannelFrequency` returns `""` for
  a missing channel.
- `TFAR_currentUnit` (not `player`) is the unit TFAR works with — differs under Zeus remote
  control. Updated on respawn (`core/functions/fnc_processRespawn.sqf`) and on the CBA `"unit"`
  player event (`core/functions/fnc_ClientInit.sqf` ~line 155).

## Event handlers — verified (source)

`TFAR_fnc_addEventHandler` (`core/functions/events/handler/fnc_addEventHandler.sqf`):

```sqf
[_customID <STRING>, _eventName <STRING>, _code <CODE>, _filterUnit <OBJECT, optional>] call TFAR_fnc_addEventHandler
// remove:
[_customID, _eventName] call TFAR_fnc_removeEventHandler
```

Internally a CBA local event named `"TFAR_event_<name>"`. Fired via `TFAR_fnc_fireEventHandlers`
→ `CBA_fnc_localEvent` (synchronous, local).

Events relevant to us (all fired locally on the client):

| Event | Params | Fired from |
|---|---|---|
| `OnSWchannelSet` | `[unit, radio, channel(0-based), additional(bool), oldChannel]` | `core/functions/fnc_setSwChannel.sqf`, `fnc_setAdditionalSwChannel.sqf` |
| `OnLRchannelSet` | `[unit, radioObject, radioQualifier, channel(0-based), additional, oldChannel]` | `core/functions/fnc_setLrChannel.sqf`, `fnc_setAdditionalLrChannel.sqf` |
| `OnFrequencyChanged` | `[unit, radio, channel(0-based!), oldFreq, newFreq]` | `core/functions/fnc_setChannelFrequency.sqf` |
| `OnFrequencyChangedFromUI` | `[unit, radio, freq]` | `handhelds/…/fnc_onButtonClick_Enter.sqf`, `backpacks/…/fnc_onButtonClick_Enter.sqf` |
| `OnSWChange` | `[unit, newRadio, oldRadio]` | `core/functions/fnc_setActiveSwRadio.sqf` |
| `OnLRChange` | `[unit, newRadio, oldRadio]` | `core/functions/fnc_setActiveLrRadio.sqf` |
| `OnRadiosReceived` | `[unit, newRadios]` | `core/functions/fnc_requestRadios.sqf` |

→ **A plain channel switch does fire an event** (`OnSWchannelSet` / `OnLRchannelSet`).

Not covered by events: picking up/dropping radios without the active radio changing, entering a
vehicle with an LR, settings synced from another player (vehicle radio shared by crew), death.

### Cheap change marker (internal, not public API)

Every `TFAR_fnc_setSwSettings` / `setLrSettings`, unit switch, and loadout change updates
`tfar_core_VehicleConfigCacheNamespace getVariable "lastRadioSettingUpdate"` (a `diag_tickTime`),
and loadout changes update `TFAR_lastLoadoutChange`.
(`core/functions/fnc_setSwSettings.sqf`, `fnc_setLrSettings.sqf`, `fnc_ClientInit.sqf`)
Plan: events for instant updates + a 0.5 s `CBA_fnc_addPerFrameHandler` safety net that compares
a cheap state fingerprint and sends only when it changed. The internal marker may be used as an
optimization but must fall back gracefully if it's nil (TFAR update).

## Switching channel from our addon

TFAR's own keybind path is `TFAR_fnc_processSWChannelKeys` / `processLRChannelKeys`
(`core/functions/events/keys/`), marked **Public: No**. It does:
`haveXRadio && alive TFAR_currentUnit` → `setXChannel` → `playSound "TFAR_rotatorPush"` →
optional hint (`TFAR_showChannelChangedHint`) → refresh the open radio dialog.
Our `fnc_handleCommand` will do the same steps using public functions only.

## Keybinds (fallback mode) — verified (source)

`core/functions/fnc_initKeybinds.sqf`, CBA category `"TFAR"`:
- SW channel 1..8: `SWChannel1..8` → NUM1, NUM2, NUM3, NUM4, NUM5, NUM6, NUM7, NUM8 (no modifiers).
- LR channel 1..9: `LRChannel1..9` → same numpad keys + **Ctrl** (NUM9 for channel 9).
- SW next/prev channel: Ctrl+PageUp / Ctrl+PageDown. LR: Alt+PageUp / Alt+PageDown.
(Defaults; the player can rebind in CBA settings.)

## In-game results (2026-09-28, singleplayer Eden, Altis)

- P1-A: `setSwChannel 2` → `getSwChannel` = 2, radio UI shows **CH3**. `getSwFrequency` ==
  `getChannelFrequency 3`. SW radio instance classname `TFAR_anprc152_1`. LR =
  `[<backpack object>, "radio_settings"]`. Change marker is a number (`695.99`). ✔
- P1-B: NUM5 → `OnSWchannelSet [unit, "TFAR_anprc152_1", 4, false, 2]`;
  Ctrl+NUM2 → `OnLRchannelSet [unit, <backpack>, "radio_settings", 1, false, 0]`. ✔
- P1-C (no radio): after `unlinkItem` + `removeBackpack`: `activeSwRadio` nil, `activeLrRadio`
  nil, `lrRadiosList` `[]`, `haveLRRadio` false — but `haveSWRadio` still **true** (cache, see above).

- P1-C (vehicle LR, driver of a Hunter, LR backpack still worn):
  `activeLrRadio` = `[<vehicle>, "driver_radio_settings"]` — the **vehicle radio becomes active
  automatically**. `lrRadiosList` = `[[<vehicle>, "driver_radio_settings"], [<backpack>, "radio_settings"]]`.
  (`str` of a crewed vehicle prints the crew/group name, e.g. `B Alpha 1-1:1 (Heffalump)` — it is
  still the vehicle object.) ✔
  → For display, LR source = `"backpack"` if `(_lr select 0) isEqualTo backpackContainer
  TFAR_currentUnit`, else `"vehicle"`; `radio` = `typeOf (_lr select 0)`. We always act on the **active**
  LR only.

## Still pending

- Death / respawn — deferred to Phase 6 (needs respawn-enabled MP mission).

## Selecting a specific radio (for `lrBackpack` / `lrVehicle` / `intercom` keys) — verified (source)

- `unit call TFAR_fnc_backpackLr` → `[unitBackpack unit, "radio_settings"]` or nil
  (`core/functions/fnc_backpackLr.sqf`).
- `unit call TFAR_fnc_vehicleLr` → `[vehicle, "<seat>_radio_settings"]` or nil. Seat ids:
  `driver_radio_settings`, `gunner_radio_settings`, `commander_radio_settings`,
  `copilot_radio_setting` (sic, no "s"), `turretUnit_<i>_radio_setting`, `cargoUnit_<i>_radio_setting`
  (`core/functions/fnc_vehicleLr.sqf`).
- `lrRadioArray call TFAR_fnc_setActiveLrRadio` — `_this` is the `[object, id]` array; fires
  `OnLRChange` (`core/functions/fnc_setActiveLrRadio.sqf`).
- `TFAR_fnc_setActiveSwRadio` swaps inventory items (unassign/assign) — not needed now.
- `TFAR_fnc_radiosList` → all SW radios the unit carries (`core/functions/fnc_radiosList.sqf`).

## Vehicle intercom — verified (source), in-game pending

- `[vehicle, player] call TFAR_fnc_getIntercomChannel` → NUMBER
  (`core/functions/intercom/fnc_getIntercomChannel.sqf`; exits with nil if `!isPlayer _player`).
- `[vehicle, player, channel] call TFAR_fnc_setIntercomChannel` → sets
  `TFAR_IntercomSlot_<netId>` (global), fires `OnIntercomChannelSet [vehicle, player, channel, old]`
  (`core/functions/intercom/fnc_setIntercomChannel.sqf`).
- Values: **−1 = Disabled, 0 = Cargo, 1 = Crew** (ACE self-action in `core/script_macros.hpp`,
  labels `STR_TFAR_Core_Intercom_ACESelfAction_Channel1/2` in `core/stringtable.xml`).
- Vehicle has intercom: config `TFAR_hasIntercom` > 0 (see `core/functions/fnc_vehicleId.sqf`);
  global toggle `TFAR_enableIntercom` (CBA setting).
- `external_intercom` addon (vehicle phone / wireless headset) and `static_radios` (ground radios)
  exist but are out of scope for now.
