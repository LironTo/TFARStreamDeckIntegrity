/*
    tfar_sd_fnc_radioJson — JSON object for one present radio.

    Arguments:
        0: radio name (SW classname or typeOf backpack/vehicle) <STRING>
        1: SW classname <STRING> or LR radio <ARRAY> — passed to TFAR getters
        2: channel count (8 SW, 9 LR) <NUMBER>
        3: extra JSON members, e.g. ',"source":"vehicle"' <STRING>
    Returns: JSON <STRING>

    Strings are emitted with `str`, which equals JSON for strings without quotes/backslashes
    (classnames and TFAR frequency strings never contain them).
*/
params ["_name", "_radio", "_count", ["_extra", ""]];

private _isSw = _radio isEqualType "";
private _channel = if (_isSw) then { _radio call TFAR_fnc_getSwChannel } else { _radio call TFAR_fnc_getLrChannel };
if (isNil "_channel") then { _channel = 0 };
private _additional = if (_isSw) then { _radio call TFAR_fnc_getAdditionalSwChannel } else { _radio call TFAR_fnc_getAdditionalLrChannel };
private _additionalJson = if (isNil "_additional" || { _additional < 0 }) then { "null" } else { str ([_additional, true] call tfar_sd_fnc_convertChannel) };

// getChannelFrequency is 1-based. TFAR's arrays carry one extra entry; we take exactly _count.
private _freqs = [];
for "_i" from 1 to _count do {
    private _f = [_radio, _i] call TFAR_fnc_getChannelFrequency;
    if (isNil "_f") then { _f = "" };
    if !(_f isEqualType "") then { _f = str _f };
    _freqs pushBack str _f;
};

format [
    "{""present"":true,""radio"":%1,""channel"":%2,""additionalChannel"":%3,""frequencies"":[%4]%5}",
    str _name,
    [_channel, true] call tfar_sd_fnc_convertChannel,
    _additionalJson,
    _freqs joinString ",",
    _extra
]
