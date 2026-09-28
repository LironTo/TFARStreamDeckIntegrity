// Protocol v1 types — must match docs/protocol.md.

export const PROTOCOL_VERSION = 1;

export const RADIO_KINDS = ["sw", "lr", "lrBackpack", "lrVehicle", "intercom"] as const;
export type RadioKind = (typeof RADIO_KINDS)[number];

export type AbsentRadio = { present: false };

export type PresentRadio = {
	present: true;
	radio: string;
	channel: number; // 1-based
	additionalChannel: number | null;
	frequencies: string[];
};

export type ActiveLr = PresentRadio & { source: "backpack" | "vehicle" };

export type Intercom = { present: true; channel: number } | AbsentRadio; // 0 = Disabled, 1 = Cargo, 2 = Crew

export type GameState = {
	type: "state";
	v: number;
	inGame: boolean;
	sw: PresentRadio | AbsentRadio;
	lr: ActiveLr | AbsentRadio;
	lrBackpack: PresentRadio | AbsentRadio;
	lrVehicle: PresentRadio | AbsentRadio;
	intercom: Intercom;
};

export type SetChannelMessage = { type: "setChannel"; v: number; radio: RadioKind; channel: number };

/** Highest valid channel for a kind (lowest is 1, or 0 for intercom). */
export function maxChannel(kind: RadioKind): number {
	if (kind === "sw") return 8;
	if (kind === "intercom") return 2;
	return 9;
}

export function minChannel(kind: RadioKind): number {
	return kind === "intercom" ? 0 : 1;
}

/** Validates an incoming `state` message. Missing radio objects are treated as absent. */
export function parseState(msg: unknown): GameState | null {
	if (typeof msg !== "object" || msg === null) return null;
	const m = msg as Record<string, unknown>;
	if (m.type !== "state" || m.v !== PROTOCOL_VERSION || typeof m.inGame !== "boolean") return null;
	const absent: AbsentRadio = { present: false };
	const pick = (key: RadioKind) => {
		const r = m[key] as { present?: unknown } | undefined;
		return r && typeof r === "object" && r.present === true ? r : absent;
	};
	return {
		type: "state",
		v: PROTOCOL_VERSION,
		inGame: m.inGame,
		sw: pick("sw") as GameState["sw"],
		lr: pick("lr") as GameState["lr"],
		lrBackpack: pick("lrBackpack") as GameState["lrBackpack"],
		lrVehicle: pick("lrVehicle") as GameState["lrVehicle"],
		intercom: pick("intercom") as GameState["intercom"],
	};
}
