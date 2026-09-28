/*
    tfar_sd_fnc_requestSend — coalesces bursts of TFAR events into one send on the next frame
    (also lets TFAR finish saving settings before we read them).
*/
if (tfar_sd_sendQueued) exitWith {};
tfar_sd_sendQueued = true;
[{
    tfar_sd_sendQueued = false;
    false call tfar_sd_fnc_sendState;
}] call CBA_fnc_execNextFrame;
