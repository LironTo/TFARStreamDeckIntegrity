/*
    tfar_sd_fnc_buildState — full protocol v1 `state` message as a JSON string (docs/protocol.md).

    Arguments: 0: mission running <BOOL> (default true; false → offline state)
    Returns: JSON <STRING>
*/
params [["_inGame", true]];

private _absent = "{""present"":false}";
private _sw = _absent;
private _lr = _absent;
private _lrBackpack = _absent;
private _lrVehicle = _absent;
private _intercom = _absent;

private _unit = missionNamespace getVariable ["TFAR_currentUnit", objNull];
if (isNil "_unit" || { isNull _unit }) then { _inGame = false };

if (_inGame && { alive _unit }) then {
    // Decide "SW present" by activeSwRadio, not haveSWRadio (cached, see tfar-api-notes.md).
    private _swRadio = call TFAR_fnc_activeSwRadio;
    if (!isNil "_swRadio") then {
        _sw = [_swRadio, _swRadio, 8] call tfar_sd_fnc_radioJson;
    };

    private _backpack = _unit call TFAR_fnc_backpackLr;
    if (!isNil "_backpack") then {
        _lrBackpack = [typeOf (_backpack select 0), _backpack, 9] call tfar_sd_fnc_radioJson;
    };

    private _vehicleLr = _unit call TFAR_fnc_vehicleLr;
    if (!isNil "_vehicleLr") then {
        _lrVehicle = [typeOf (_vehicleLr select 0), _vehicleLr, 9] call tfar_sd_fnc_radioJson;
    };

    private _active = call TFAR_fnc_activeLrRadio;
    if (!isNil "_active") then {
        private _source = ["vehicle", "backpack"] select (!isNil "_backpack" && { _active isEqualTo _backpack });
        _lr = [typeOf (_active select 0), _active, 9, format [",""source"":%1", str _source]] call tfar_sd_fnc_radioJson;
    };

    private _vehicle = objectParent _unit;
    if (
        !isNull _vehicle
        && { missionNamespace getVariable ["TFAR_enableIntercom", true] }
        && { ([typeOf _vehicle, "TFAR_hasIntercom", 0] call TFAR_fnc_getVehicleConfigProperty) > 0 }
    ) then {
        private _slot = [_vehicle, _unit] call TFAR_fnc_getIntercomChannel;
        if (!isNil "_slot") then {
            _intercom = format ["{""present"":true,""channel"":%1}", [_slot, true] call tfar_sd_fnc_convertChannel];
        };
    };
};

format [
    "{""type"":""state"",""v"":1,""inGame"":%1,""sw"":%2,""lr"":%3,""lrBackpack"":%4,""lrVehicle"":%5,""intercom"":%6}",
    ["false", "true"] select _inGame, _sw, _lr, _lrBackpack, _lrVehicle, _intercom
]
