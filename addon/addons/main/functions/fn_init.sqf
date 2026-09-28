/*
    tfar_sd_fnc_init — CBA postInit (every mission). Client only.
    Starts the extension, wires the ExtensionCallback, TFAR events and a 0.5 s change detector.
    Does nothing if the extension is missing or blocked (e.g. by BattlEye).
*/
#define PORT 9800

if (!hasInterface) exitWith {};

private _version = ("tfar_sd" callExtension ["version", []]) select 0;
if (_version isEqualTo "") exitWith {
    diag_log "[tfar_sd] extension not available (missing or blocked by BattlEye) - disabled";
};

private _start = "tfar_sd" callExtension ["start", [PORT]];
diag_log format ["[tfar_sd] extension %1, start: %2", _version, _start];
if ((_start select 1) != 0) exitWith {
    diag_log "[tfar_sd] extension failed to start - disabled";
};

tfar_sd_lastSent = "";
tfar_sd_sendQueued = false;

addMissionEventHandler ["ExtensionCallback", {
    _this call tfar_sd_fnc_onCallback;
}];

// Instant updates: any of these TFAR events queues one send for the next frame.
// Events: reference/tfar/z/tfar/addons/core/functions (see docs/tfar-api-notes.md).
{
    ["tfar_sd", _x, { call tfar_sd_fnc_requestSend; }] call TFAR_fnc_addEventHandler;
} forEach [
    "OnSWchannelSet", "OnLRchannelSet", "OnFrequencyChanged", "OnFrequencyChangedFromUI",
    "OnSWChange", "OnLRChange", "OnRadiosReceived", "OnIntercomChannelSet"
];

// Safety net for changes without events (death, vehicles, loadout, remote settings):
// rebuild the state every 0.5 s and send only if it changed.
[{ false call tfar_sd_fnc_sendState; }, 0.5] call CBA_fnc_addPerFrameHandler;

// Mission display closing (mission end, abort, back to editor) → tell the plugin.
[{ !isNull findDisplay 46 }, {
    (findDisplay 46) displayAddEventHandler ["Unload", {
        "tfar_sd" callExtension ["state", [false call tfar_sd_fnc_buildState]];
        tfar_sd_lastSent = "";
    }];
}] call CBA_fnc_waitUntilAndExecute;

true call tfar_sd_fnc_sendState;
