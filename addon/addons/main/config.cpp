class CfgPatches {
    class tfar_sd_main {
        name = "TFAR Stream Deck";
        author = "Liron";
        units[] = {};
        weapons[] = {};
        requiredVersion = 2.18;
        requiredAddons[] = {"cba_main", "tfar_core"};
    };
};

class Extended_PostInit_EventHandlers {
    class tfar_sd_main {
        init = "call tfar_sd_fnc_init";
    };
};

class CfgFunctions {
    class tfar_sd {
        class main {
            file = "\z\tfar_sd\addons\main\functions";
            class init {};
            class convertChannel {};
            class radioJson {};
            class buildState {};
            class sendState {};
            class requestSend {};
            class onCallback {};
            class handleCommand {};
        };
    };
};
