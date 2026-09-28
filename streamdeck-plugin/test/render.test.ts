import assert from "node:assert/strict";
import { test } from "node:test";
import { parseState, type GameState } from "../src/protocol.ts";
import { DEFAULT_COLORS, keyImage, normalizeSettings, renderKey } from "../src/render.ts";

const freqs8 = ["30", "31.2", "45.5", "50", "60", "70", "80", "90"];
const freqs9 = ["41", "42", "43", "44", "45", "46", "47", "48", "49"];

const absent = { present: false } as const;

function state(overrides: Partial<GameState> = {}): GameState {
	return {
		type: "state",
		v: 1,
		inGame: true,
		sw: { present: true, radio: "TFAR_anprc152_1", channel: 3, additionalChannel: null, frequencies: freqs8 },
		lr: { present: true, source: "backpack", radio: "TFAR_rt1523g", channel: 2, additionalChannel: null, frequencies: freqs9 },
		lrBackpack: { present: true, radio: "TFAR_rt1523g", channel: 2, additionalChannel: null, frequencies: freqs9 },
		lrVehicle: absent,
		intercom: absent,
		...overrides,
	};
}

test("offline when not connected", () => {
	assert.deepEqual(renderKey({ radio: "sw", channel: 1 }, false, state()), { title: "OFFLINE", highlight: "none" });
});

test("dash when connected but no mission", () => {
	assert.deepEqual(renderKey({ radio: "sw", channel: 1 }, true, null), { title: "—", highlight: "none" });
	assert.deepEqual(renderKey({ radio: "sw", channel: 1 }, true, state({ inGame: false })), { title: "—", highlight: "none" });
});

test("SW channel shows frequency and highlights the active channel", () => {
	assert.deepEqual(renderKey({ radio: "sw", channel: 3 }, true, state()), { title: "SR CH3\n45.5", highlight: "active" });
	assert.deepEqual(renderKey({ radio: "sw", channel: 1 }, true, state()), { title: "SR CH1\n30", highlight: "none" });
});

test("custom label replaces the header", () => {
	assert.deepEqual(renderKey({ radio: "sw", channel: 3, label: " PLT " }, true, state()), { title: "PLT\n45.5", highlight: "active" });
});

test("channel stored as string by the property inspector", () => {
	assert.deepEqual(renderKey({ radio: "sw", channel: "3" }, true, state()), { title: "SR CH3\n45.5", highlight: "active" });
});

test("LR channel 9 exists", () => {
	assert.deepEqual(renderKey({ radio: "lr", channel: 9 }, true, state()), { title: "LR CH9\n49", highlight: "none" });
});

test("missing radio shows NO RADIO", () => {
	assert.deepEqual(renderKey({ radio: "lrVehicle", channel: 1 }, true, state()), { title: "VEH 1\nNO RADIO", highlight: "none" });
	assert.deepEqual(renderKey({ radio: "sw", channel: 2 }, true, state({ sw: absent })), { title: "SR 2\nNO RADIO", highlight: "none" });
});

test("intercom", () => {
	const s = state({ intercom: { present: true, channel: 2 } });
	assert.deepEqual(renderKey({ radio: "intercom", channel: 2 }, true, s), { title: "IC\nCREW", highlight: "active" });
	assert.deepEqual(renderKey({ radio: "intercom", channel: 0 }, true, s), { title: "IC\nOFF", highlight: "none" });
	assert.deepEqual(renderKey({ radio: "intercom", channel: 1 }, true, state()), { title: "IC CARGO\nNO IC", highlight: "none" });
});

test("invalid settings fall back to defaults", () => {
	assert.deepEqual(normalizeSettings({}), { radio: "sw", channel: 1, label: "" });
	assert.deepEqual(normalizeSettings({ radio: "sw", channel: 9 }), { radio: "sw", channel: 1, label: "" });
	assert.deepEqual(normalizeSettings({ radio: "intercom", channel: 7 }), { radio: "intercom", channel: 2, label: "" });
	assert.deepEqual(normalizeSettings({ radio: "bogus" as never, channel: 2 }), { radio: "sw", channel: 2, label: "" });
});

test("parseState rejects junk and fills missing kinds as absent", () => {
	assert.equal(parseState(null), null);
	assert.equal(parseState({ type: "state", v: 2, inGame: true }), null);
	assert.equal(parseState({ type: "other", v: 1 }), null);
	const s = parseState({ type: "state", v: 1, inGame: true, sw: { present: true, radio: "x", channel: 1, additionalChannel: null, frequencies: freqs8 } });
	assert.ok(s);
	assert.equal(s.sw.present, true);
	assert.deepEqual(s.lrVehicle, { present: false });
	assert.deepEqual(s.intercom, { present: false });
});

test("additional channel gets its own highlight, and both when it equals the active one", () => {
	const s = state({
		sw: { present: true, radio: "TFAR_anprc152_1", channel: 3, additionalChannel: 5, frequencies: freqs8 },
	});
	assert.equal(renderKey({ radio: "sw", channel: 5 }, true, s).highlight, "additional");
	assert.equal(renderKey({ radio: "sw", channel: 3 }, true, s).highlight, "active");
	assert.equal(renderKey({ radio: "sw", channel: 1 }, true, s).highlight, "none");
	const same = state({
		sw: { present: true, radio: "TFAR_anprc152_1", channel: 4, additionalChannel: 4, frequencies: freqs8 },
	});
	assert.equal(renderKey({ radio: "sw", channel: 4 }, true, same).highlight, "both");
});

function svgOf(url: string): string {
	assert.ok(url.startsWith("data:image/svg+xml;base64,"));
	return Buffer.from(url.slice("data:image/svg+xml;base64,".length), "base64").toString();
}

test("key image: per-kind default colors (SR green/orange, LR blue/purple)", () => {
	assert.ok(svgOf(keyImage("active", { radio: "sw" })).includes(`fill="${DEFAULT_COLORS.sw.active}"`));
	assert.ok(svgOf(keyImage("additional", { radio: "sw" })).includes(`fill="${DEFAULT_COLORS.sw.additional}"`));
	for (const radio of ["lr", "lrBackpack", "lrVehicle"] as const) {
		assert.ok(svgOf(keyImage("active", { radio })).includes(`fill="${DEFAULT_COLORS.lr.active}"`));
		assert.ok(svgOf(keyImage("additional", { radio })).includes(`fill="${DEFAULT_COLORS.lr.additional}"`));
	}
	assert.notEqual(DEFAULT_COLORS.sw.active, DEFAULT_COLORS.lr.active);
	assert.notEqual(DEFAULT_COLORS.sw.additional, DEFAULT_COLORS.lr.additional);
});

test("key image: custom colors only when enabled; invalid values fall back to the kind default", () => {
	assert.ok(svgOf(keyImage("active", { radio: "sw", activeColor: "#0055ff" })).includes(`fill="${DEFAULT_COLORS.sw.active}"`));
	assert.ok(svgOf(keyImage("active", { radio: "sw", customColors: true, activeColor: "#0055ff" })).includes('fill="#0055ff"'));
	assert.ok(svgOf(keyImage("active", { radio: "lr", customColors: true, activeColor: "red;junk" })).includes(`fill="${DEFAULT_COLORS.lr.active}"`));
	const both = svgOf(keyImage("both", { customColors: true, activeColor: "#112233", additionalColor: "#aabbcc" }));
	assert.ok(both.includes('fill="#112233"') && both.includes('stroke="#aabbcc"'));
});
