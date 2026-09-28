/*
    tfar_sd_fnc_sendState — builds the state and pushes it to the extension.

    Arguments: 0: force send even if unchanged <BOOL>
*/
params [["_force", false]];

// Explicit [] — a bare `call` would pass our own _this (_force) on as buildState's _inGame.
private _json = [] call tfar_sd_fnc_buildState;
if (!_force && { _json isEqualTo tfar_sd_lastSent }) exitWith {};
tfar_sd_lastSent = _json;

private _result = "tfar_sd" callExtension ["state", [_json]];
if ((_result select 1) != 0) then {
    diag_log format ["[tfar_sd] state rejected: %1 json=%2", _result, _json];
};
