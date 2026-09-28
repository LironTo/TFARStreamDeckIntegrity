/*
    tfar_sd_fnc_onCallback — ExtensionCallback mission event handler.

    Arguments: 0: extension name <STRING>, 1: function <STRING>, 2: data <STRING>
*/
params ["_name", "_function", "_data"];
if (_name != "tfar_sd") exitWith {};

switch (_function) do {
    case "setChannel": {
        // Data is validated by the extension: ["sw",3]
        (parseSimpleArray _data) call tfar_sd_fnc_handleCommand;
    };
    case "requestState": {
        true call tfar_sd_fnc_sendState;
    };
    case "log": {
        diag_log format ["[tfar_sd] %1", _data];
    };
    default {
        diag_log format ["[tfar_sd] unknown callback %1 %2", _function, _data];
    };
};
