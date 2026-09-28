// Pure mapping: (key settings, connection, game state) → what the key shows.
import { maxChannel, minChannel, RADIO_KINDS, type GameState, type RadioKind } from "./protocol.ts";

export type ChannelSettings = {
	radio?: RadioKind;
	channel?: number | string; // property inspector may store it as a string
	label?: string;
	customColors?: boolean; // false/unset → per-kind defaults (DEFAULT_COLORS)
	activeColor?: string; // "#rrggbb", used only with customColors
	additionalColor?: string; // "#rrggbb", used only with customColors
};

/** Which highlight the key gets: the radio's active channel, its additional channel, or both. */
export type Highlight = "none" | "active" | "additional" | "both";

export type KeyView = { title: string; highlight: Highlight };

/** Default key colors per radio kind: short range green/orange, long range blue/purple. */
export const DEFAULT_COLORS: Record<RadioKind, { active: string; additional: string }> = {
	sw: { active: "#1e8a4a", additional: "#d97706" },
	lr: { active: "#1d4ed8", additional: "#9333ea" },
	lrBackpack: { active: "#1d4ed8", additional: "#9333ea" },
	lrVehicle: { active: "#1d4ed8", additional: "#9333ea" },
	intercom: { active: "#0e7490", additional: "#0e7490" }, // intercom has no additional channel
};
const IDLE_BACKGROUND = "#1c1e22";
const IDLE_BORDER = "#464a50";

const INTERCOM_NAMES = ["OFF", "CARGO", "CREW"];

const KIND_TAGS: Record<RadioKind, string> = {
	sw: "SR",
	lr: "ACT", // active LR (backpack or vehicle, whichever TFAR uses)
	lrBackpack: "LR",
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

function highlightOf(isActive: boolean, isAdditional: boolean): Highlight {
	if (isActive && isAdditional) return "both";
	if (isActive) return "active";
	if (isAdditional) return "additional";
	return "none";
}

export function renderKey(settings: ChannelSettings, connected: boolean, state: GameState | null): KeyView {
	if (!connected) return { title: "OFFLINE", highlight: "none" };
	if (!state || !state.inGame) return { title: "—", highlight: "none" };

	const { radio, channel, label } = normalizeSettings(settings);

	if (radio === "intercom") {
		const ic = state.intercom;
		const name = INTERCOM_NAMES[channel];
		if (!ic.present) return { title: `${label || "IC"} ${name}\nNO IC`, highlight: "none" };
		return { title: `${label || "IC"}\n${name}`, highlight: highlightOf(ic.channel === channel, false) };
	}

	const r = state[radio];
	if (!r.present) return { title: `${KIND_TAGS[radio]} ${channel}\nNO RADIO`, highlight: "none" };
	const freq = r.frequencies[channel - 1] ?? "—";
	const head = label || `${KIND_TAGS[radio]} CH${channel}`;
	return {
		title: `${head}\n${freq}`,
		highlight: highlightOf(r.channel === channel, r.additionalChannel === channel),
	};
}

function color(value: string | undefined, fallback: string): string {
	return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/** Key background as an SVG data URL (144×144, the @2x key size). */
export function keyImage(highlight: Highlight, settings: ChannelSettings): string {
	const defaults = DEFAULT_COLORS[normalizeSettings(settings).radio];
	const custom = settings.customColors === true;
	const active = custom ? color(settings.activeColor, defaults.active) : defaults.active;
	const additional = custom ? color(settings.additionalColor, defaults.additional) : defaults.additional;
	const [fill, stroke, width] = {
		none: [IDLE_BACKGROUND, IDLE_BORDER, 6],
		active: [active, active, 0],
		additional: [additional, additional, 0],
		both: [active, additional, 16], // active background framed in the additional color
	}[highlight] as [string, string, number];
	const frame = width > 0
		? `<rect x="${width / 2}" y="${width / 2}" width="${144 - width}" height="${144 - width}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`
		: "";
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="${fill}"/>${frame}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
