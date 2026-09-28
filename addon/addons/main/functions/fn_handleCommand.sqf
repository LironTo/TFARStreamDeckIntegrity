/*
    tfar_sd_fnc_handleCommand — applies a `setChannel` from the plugin, then sends a fresh state.
    Mirrors TFAR's own channel keybinds (TFAR_fnc_processSWChannelKeys / processLRChannelKeys)
    using public TFAR functions only.

    Arguments: 0: radio kind "sw"|"lr"|"lrBackpack"|"lrVehicle"|"intercom" <STRING>,
               1: protocol channel <NUMBER>
*/
params [["_kind", "", [""]], ["_channel", -1, [0]]];

private _unit = missionNamespace getVariable ["TFAR_currentUnit", objNull];
if (isNil "_unit" || { isNull _unit } || { !alive _unit }) exitWith {};

private _tfarChannel = [_channel, false] call tfar_sd_fnc_convertChannel;

switch (_kind) do {
    case "sw": {
        private _radio = call TFAR_fnc_activeSwRadio;
        if (isNil "_radio" || { _tfarChannel < 0 } || { _tfarChannel > 7 }) exitWith {};
        [_radio, _tfarChannel] call TFAR_fnc_setSwChannel;
        playSound "TFAR_rotatorPush";
        if (missionNamespace getVariable ["TFAR_showChannelChangedHint", true]) then {
            [_radio, false] call TFAR_fnc_showRadioInfo;
        };
        if (dialog) then {
            // Explicit [] — TFAR's dialog update uses a string in _this as its display format.
            [] call compile getText (configFile >> "CfgWeapons" >> _radio >> "tf_dialogUpdate");
        };
    };
    case "lr";
    case "lrBackpack";
    case "lrVehicle": {
        private _radio = switch (_kind) do {
            case "lr": { call TFAR_fnc_activeLrRadio };
            case "lrBackpack": { _unit call TFAR_fnc_backpackLr };
            default { _unit call TFAR_fnc_vehicleLr };
        };
        if (isNil "_radio" || { _tfarChannel < 0 } || { _tfarChannel > 8 }) exitWith {};
        if (_kind != "lr") then { _radio call TFAR_fnc_setActiveLrRadio };
        [_radio, _tfarChannel] call TFAR_fnc_setLrChannel;
        playSound "TFAR_rotatorPush";
        if (missionNamespace getVariable ["TFAR_showChannelChangedHint", true]) then {
            [_radio, true] call TFAR_fnc_showRadioInfo;
        };
        if (dialog) then {
            [] call compile ([_radio select 0, "tf_dialogUpdate"] call TFAR_fnc_getLrRadioProperty);
        };
    };
    case "intercom": {
        private _vehicle = objectParent _unit;
        if (isNull _vehicle || { _tfarChannel < -1 } || { _tfarChannel > 1 }) exitWith {};
        [_vehicle, _unit, _tfarChannel] call TFAR_fnc_setIntercomChannel;
    };
    default {
        diag_log format ["[tfar_sd] unknown radio kind %1", _kind];
    };
};

true call tfar_sd_fnc_sendState;
