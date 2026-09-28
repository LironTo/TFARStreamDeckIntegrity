/*
    tfar_sd_fnc_convertChannel — the ONLY place that converts channel numbers.
    TFAR stores channels 0-based (and intercom as -1/0/1); the protocol is TFAR + 1
    (radios 1-based, intercom 0=Disabled 1=Cargo 2=Crew). See docs/protocol.md.

    Arguments: 0: channel <NUMBER>, 1: true = TFAR → protocol, false = protocol → TFAR <BOOL>
    Returns: converted channel <NUMBER>
*/
params ["_channel", "_toProtocol"];
[_channel - 1, _channel + 1] select _toProtocol
