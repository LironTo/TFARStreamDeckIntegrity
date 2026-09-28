# Manual test procedures

## Phase 1 — TFAR API confirmation (debug console)

Setup: Eden test mission, CBA + TFAR loaded (BattlEye setting doesn't matter here — it only
matters from Phase 4, when our own DLL is loaded), one playable soldier with an
AN/PRC-152 (SW) in the radio slot and an LR backpack (e.g. RT-1523G). Play in singleplayer
(Eden → Play Scenario), press Esc → Debug Console, paste a snippet, click **LOCAL EXEC**.
Each snippet copies its result to the clipboard — paste it back to Claude.

### P1-A: index base, frequencies, LR shape, change marker

```sqf
private _sw = call TFAR_fnc_activeSwRadio;
private _lr = call TFAR_fnc_activeLrRadio;
[_sw, 2] call TFAR_fnc_setSwChannel;
private _out = [
    "sw=" + str _sw,
    "swCh=" + str (_sw call TFAR_fnc_getSwChannel),
    "swFreqActive=" + str (_sw call TFAR_fnc_getSwFrequency),
    "swFreqCh3=" + str ([_sw, 3] call TFAR_fnc_getChannelFrequency),
    "swFreqs=" + str ((_sw call TFAR_fnc_getSwSettings) select 2),
    "lr=" + str _lr,
    "lrCh=" + (if (isNil "_lr") then {"nil"} else {str (_lr call TFAR_fnc_getLrChannel)}),
    "lrFreqs=" + (if (isNil "_lr") then {"nil"} else {str ((_lr call TFAR_fnc_getLrSettings) select 2)}),
    "marker=" + str (tfar_core_VehicleConfigCacheNamespace getVariable "lastRadioSettingUpdate")
] joinString " | ";
copyToClipboard _out; _out
```

Expected: `swCh=2`, and the SW radio (open with Ctrl+P) shows **channel 3**.
`swFreqActive` equals `swFreqCh3`. `marker` is a number.

### P1-B: channel-switch event fires

```sqf
["sdTest", "OnSWchannelSet", { systemChat format ["OnSWchannelSet %1", _this]; }] call TFAR_fnc_addEventHandler;
["sdTest", "OnLRchannelSet", { systemChat format ["OnLRchannelSet %1", _this]; }] call TFAR_fnc_addEventHandler;
"registered"
```

Close the console, press **NUM5**, then **Ctrl+NUM2**. Expected: two chat lines, the first with
channel `4`, the second with channel `1`. Clean up:
`["sdTest","OnSWchannelSet"] call TFAR_fnc_removeEventHandler; ["sdTest","OnLRchannelSet"] call TFAR_fnc_removeEventHandler;`

### P1-C: no radio / vehicle LR

```sqf
private _f = { private _sw = call TFAR_fnc_activeSwRadio; private _lr = call TFAR_fnc_activeLrRadio;
  format ["haveSW=%1 sw=%2 haveLR=%3 lr=%4 list=%5", call TFAR_fnc_haveSWRadio,
  if (isNil "_sw") then {"nil"} else {_sw}, call TFAR_fnc_haveLRRadio,
  if (isNil "_lr") then {"nil"} else {str _lr}, TFAR_currentUnit call TFAR_fnc_lrRadiosList] };
private _a = call _f;
player unlinkItem (call TFAR_fnc_activeSwRadio);
removeBackpack player;
private _b = call _f;
private _out = "before: " + _a + " || after: " + _b;
copyToClipboard _out; _out
```

Expected "after": `haveSW=false sw=nil haveLR=false lr=nil list=[]`.

Then (same mission, restart it) place a vehicle with LR (e.g. a Hunter/MRAP), get in as
driver, and run:

```sqf
private _lr = call TFAR_fnc_activeLrRadio;
private _out = format ["lr=%1 list=%2", if (isNil "_lr") then {"nil"} else {str _lr}, TFAR_currentUnit call TFAR_fnc_lrRadiosList];
copyToClipboard _out; _out
```

Expected: the vehicle appears in the list as `[vehicle, "driver_radio_settings"]` or similar.

Death/respawn is tested in Phase 6 (needs a respawn-enabled MP mission).

## Phase 4 — extension DLL loaded in Arma (BattlEye OFF)

Setup: from repo root `powershell -File build.ps1` → local mod `C:\Arma3Dev\@tfar_sd`
(DLL + `addons/tfar_sd_main.pbo`; the launcher rejects mods without at least one PBO).
Arma launcher → Mods → "..." → Add local mod → `C:\Arma3Dev\@tfar_sd`; enable it with CBA + TFAR.
Launcher → Parameters → **disable BattlEye**. Stop the mock server (it uses the same port 9800).
Stream Deck app running with the TFAR Radio keys.

### P4-A: load + start (debug console, LOCAL EXEC)

```sqf
addMissionEventHandler ["ExtensionCallback", {
    params ["_name", "_function", "_data"];
    if (_name == "tfar_sd") then { systemChat format ["tfar_sd %1 %2", _function, _data]; };
}];
private _out = str ["tfar_sd" callExtension ["version", []], "tfar_sd" callExtension ["start", [9800]]];
copyToClipboard _out; _out
```

Expected: `[["0.1.0",0,0],["started on 9800",0,0]]`, and within ~5 s a chat line
`tfar_sd log client connected from 127.0.0.1:...`. Keys switch from `OFFLINE` to `—`.

### P4-B: hand-sent state

```sqf
"tfar_sd" callExtension ["state", ['{"type":"state","v":1,"inGame":true,"sw":{"present":true,"radio":"TFAR_anprc152_1","channel":2,"additionalChannel":null,"frequencies":["30","31.2","45.5","50","60","70","80","90"]}}']]
```

Expected: returns `["ok",0,0]`; SR keys show `SR CH1 / 30`, `SR CH2 / 31.2`, CH2 highlighted.
Press the SR CH1 key → chat line `tfar_sd setChannel ["sw",1]` (the channel is not changed in the
game yet — that is Phase 5).

### P4-C: stop

```sqf
"tfar_sd" callExtension ["stop", []]
```

Expected: `["stopped",0,0]`, keys go to `OFFLINE` within a few seconds.

## Phase 5 — real game (no debug console needed)

Setup: `powershell -File build.ps1` (Arma closed). Launch with CBA + TFAR + `@tfar_sd`, BattlEye
off. Eden mission: soldier with AN/PRC-152 + RT-1523G backpack, plus a Hunter (has LR + intercom)
nearby. Stream Deck keys: SR 1, SR 2, SR 3, LR (auto) 1, LR backpack 2, LR vehicle 1,
Intercom Crew, Intercom Cargo.

| # | Action | Expected |
|---|---|---|
| P5-1 | Start the mission | Keys leave `OFFLINE`, SR keys show the real SW frequencies, active SR channel green |
| P5-2 | Press SR 3 key | Radio switches to CH3 (rotator sound + TFAR hint), SR 3 key green |
| P5-3 | Press NUM1 in game | SR 1 key turns green within ~0.5 s |
| P5-4 | Change a frequency in the radio UI (Ctrl+P) | That key shows the new frequency |
| P5-5 | Press LR backpack 2 | Backpack LR goes to CH2; `LR (auto)` keys follow |
| P5-6 | Get into the Hunter as driver | `LR vehicle` + intercom keys come alive; `LR (auto)` shows the vehicle radio |
| P5-7 | Press Intercom Cargo, then Crew | Highlight follows; ACE self-interaction intercom menu (if ACE) agrees |
| P5-8 | Press LR backpack while seated | Backpack becomes active LR; `LR (auto)` follows it |
| P5-9 | Drop the backpack / unlink the SW | Keys show `NO RADIO` |
| P5-10 | Back to Eden (end preview) | Keys show `—` |

Diagnostics: `%LOCALAPPDATA%\Arma 3\tfar_sd.log` (extension) and the `.rpt` (`[tfar_sd]` lines).

## Phase 6 — integration test matrix

Setup as Phase 5. For MP rows: Eden → Attributes → Multiplayer → Respawn = "Respawn on Custom
Position" (or "Base") + a `respawn_west` marker; then **Play → Play in Multiplayer** (local host).
Kill yourself with the debug console: `player setDamage 1`.

| # | Scenario | Expected | Result |
|---|---|---|---|
| M1 | Restart Stream Deck app mid-mission | Keys come back with correct frequencies/highlight within ~5 s | ✅ 2026-09-28 |
| M2 | Kill the plugin process (Task Manager → node.exe of com.liron.tfar) | Stream Deck relaunches it; keys recover | ✅ 2026-09-28 (Stream Deck relaunched it and it reconnected) |
| M3 | Change a frequency in the radio UI (Ctrl+P → type → ENT) | Key shows the new frequency | ✅ (Phase 5) |
| M4 | Die (`player setDamage 1`) | Keys show `NO RADIO` | ✅ 2026-09-28 (SP) |
| M5 | Respawn | Keys show the new unit's radios | |
| M6 | End mission → start another (or rejoin a local MP session) | Keys recover, no duplicate updates (tfar_sd.log: one "queued" per change) | ✅ 2026-09-28 |
| M7 | Close Arma | `OFFLINE` within ~5 s | ✅ (Phase 5) |
| M8 | Start Arma **without** `@tfar_sd` | Keys stay `OFFLINE`, no errors in game | ✅ 2026-09-28 |
| M9 | Start Arma with `@tfar_sd` but **BattlEye ON** (SP is enough) | Game runs normally; RPT has `[tfar_sd] extension not available`; keys `OFFLINE` | skipped — not critical (server has no BattlEye) |
| M10 | Zeus remote control a unit with a different radio (if Zeus available) | Keys follow the controlled unit (`TFAR_currentUnit`) | optional |
