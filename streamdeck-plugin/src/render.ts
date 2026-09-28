// Pure mapping: (key settings, connection, game state) → what the key shows.
import { maxChannel, minChannel, RADIO_KINDS, type GameState, type RadioKind } from "./protocol.ts";

export type ChannelSettings = {
	radio?: RadioKind;
	channel?: number | string; // property inspector may store it as a string
	label?: string;
};

export type KeyView = { title: string; state: 0 | 1 };

const INTERCOM_NAMES = ["OFF", "CARGO", "CREW"];

const KIND_TAGS: Record<RadioKind, string> = {
	sw: "SR",
	lr: "LR",
	lrBackpack: "BP",
	lrVehicle: "VEH",
	intercom: "IC",
};

/** Normalizes raw settings to a valid kind and channel (defaults: sw, channel 1 / intercom Crew). */
export function normalizeSettings(settings: ChannelSettings): { radio: RadioKind; channel: number; label: string } {
	const radio: RadioKind = RADIO_KINDS.includes(settings.radio as RadioKind) ? (settings.radio as RadioKind) : "sw";
	let channel = Number(settings.channel);
	if (!Number.isInteger(channel) || channel < minChannel(radio) || channel > maxChannel(radio)) {
		channel = radio === "intercom" ? 2 : 1;
	}
	return { radio, channel, label: (settings.label ?? "").trim() };
}

export function renderKey(settings: ChannelSettings, connected: boolean, state: GameState | null): KeyView {
	if (!connected) return { title: "OFFLINE", state: 0 };
	if (!state || !state.inGame) return { title: "—", state: 0 };

	const { radio, channel, label } = normalizeSettings(settings);

	if (radio === "intercom") {
		const ic = state.intercom;
		const name = INTERCOM_NAMES[channel];
		if (!ic.present) return { title: `${label || "IC"} ${name}\nNO IC`, state: 0 };
		return { title: `${label || "IC"}\n${name}`, state: ic.channel === channel ? 1 : 0 };
	}

	const r = state[radio];
	if (!r.present) return { title: `${KIND_TAGS[radio]} ${channel}\nNO RADIO`, state: 0 };
	const freq = r.frequencies[channel - 1] ?? "—";
	const head = label || `${KIND_TAGS[radio]} CH${channel}`;
	return { title: `${head}\n${freq}`, state: r.channel === channel ? 1 : 0 };
}
