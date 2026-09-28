// Mock of the game side (extension DLL) speaking protocol v1 — see docs/protocol.md.
// Keys typed in this terminal change the simulated game state (press "h" for help).
import { WebSocketServer, WebSocket } from "ws";

const PROTOCOL_VERSION = 1;
const HOST = "127.0.0.1";
const PORT = Number(process.env.TFAR_SD_PORT ?? 9800);
const CYCLE = process.argv.includes("--cycle");

type RadioKind = "sw" | "lr" | "lrBackpack" | "lrVehicle" | "intercom";

interface Radio {
	radio: string;
	channel: number; // 1-based
	additionalChannel: number | null;
	frequencies: string[];
}

// Simulated world. The mock keeps TFAR-like semantics: when seated in a vehicle with LR,
// the vehicle radio becomes the active LR; pressing lrBackpack/lrVehicle makes that one active.
const world = {
	inGame: true,
	hasSw: true,
	hasBackpack: true,
	inVehicle: false,
	activeLr: "backpack" as "backpack" | "vehicle",
	intercom: 1, // 0 = Disabled, 1 = Cargo, 2 = Crew (protocol values)
	sw: { radio: "TFAR_anprc152_1", channel: 1, additionalChannel: null, frequencies: randomFreqs(8, 30, 512) } as Radio,
	backpack: { radio: "TFAR_rt1523g", channel: 1, additionalChannel: null, frequencies: randomFreqs(9, 30, 87) } as Radio,
	vehicle: { radio: "B_MRAP_01_F", channel: 1, additionalChannel: null, frequencies: randomFreqs(9, 30, 87) } as Radio,
};

function randomFreqs(count: number, min: number, max: number): string[] {
	return Array.from({ length: count }, () => String(Math.round((min + Math.random() * (max - min)) * 10) / 10));
}

function activeLr(): { source: "backpack" | "vehicle"; radio: Radio } | null {
	if (world.inVehicle && world.activeLr === "vehicle") return { source: "vehicle", radio: world.vehicle };
	if (world.hasBackpack) return { source: "backpack", radio: world.backpack };
	if (world.inVehicle) return { source: "vehicle", radio: world.vehicle };
	return null;
}

function buildState(): object {
	const absent = { present: false };
	if (!world.inGame) {
		return { type: "state", v: PROTOCOL_VERSION, inGame: false, sw: absent, lr: absent, lrBackpack: absent, lrVehicle: absent, intercom: absent };
	}
	const lr = activeLr();
	return {
		type: "state",
		v: PROTOCOL_VERSION,
		inGame: true,
		sw: world.hasSw ? { present: true, ...world.sw } : absent,
		lr: lr ? { present: true, source: lr.source, ...lr.radio } : absent,
		lrBackpack: world.hasBackpack ? { present: true, ...world.backpack } : absent,
		lrVehicle: world.inVehicle ? { present: true, ...world.vehicle } : absent,
		intercom: world.inVehicle ? { present: true, channel: world.intercom } : absent,
	};
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

function send(ws: WebSocket, msg: object): void {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(reason: string): void {
	const state = buildState();
	for (const client of wss.clients) send(client, state);
	console.log(`[state] -> ${wss.clients.size} client(s) (${reason})`);
}

function inRange(kind: RadioKind, channel: number): boolean {
	if (!Number.isInteger(channel)) return false;
	if (kind === "sw") return channel >= 1 && channel <= 8;
	if (kind === "intercom") return channel >= 0 && channel <= 2;
	return channel >= 1 && channel <= 9;
}

function applySetChannel(kind: RadioKind, channel: number): string | null {
	if (!world.inGame) return "not in game";
	if (!inRange(kind, channel)) return `channel ${channel} out of range for ${kind}`;
	switch (kind) {
		case "sw":
			if (!world.hasSw) return "no SW radio";
			world.sw.channel = channel;
			return null;
		case "lr": {
			const lr = activeLr();
			if (!lr) return "no LR radio";
			lr.radio.channel = channel;
			return null;
		}
		case "lrBackpack":
			if (!world.hasBackpack) return "no backpack LR";
			world.backpack.channel = channel;
			world.activeLr = "backpack";
			return null;
		case "lrVehicle":
			if (!world.inVehicle) return "not in a vehicle";
			world.vehicle.channel = channel;
			world.activeLr = "vehicle";
			return null;
		case "intercom":
			if (!world.inVehicle) return "not in a vehicle";
			world.intercom = channel;
			return null;
	}
}

function handleMessage(ws: WebSocket, raw: string): void {
	let msg: any;
	try {
		msg = JSON.parse(raw);
	} catch {
		console.warn(`[recv] malformed JSON ignored: ${raw.slice(0, 200)}`);
		return;
	}
	if (typeof msg !== "object" || msg === null || msg.v !== PROTOCOL_VERSION) {
		console.warn(`[recv] ignored (bad object or version): ${raw.slice(0, 200)}`);
		return;
	}
	switch (msg.type) {
		case "hello":
			console.log(`[recv] hello from ${msg.client}`);
			send(ws, buildState());
			break;
		case "requestState":
			console.log("[recv] requestState");
			send(ws, buildState());
			break;
		case "setChannel": {
			console.log(`[recv] setChannel radio=${msg.radio} channel=${msg.channel}`);
			const kinds: RadioKind[] = ["sw", "lr", "lrBackpack", "lrVehicle", "intercom"];
			if (!kinds.includes(msg.radio)) {
				console.warn(`[recv] unknown radio kind ${msg.radio}`);
				return;
			}
			const error = applySetChannel(msg.radio, msg.channel);
			if (error) console.warn(`[recv] setChannel ignored: ${error}`);
			else broadcast(`setChannel ${msg.radio} ${msg.channel}`);
			break;
		}
		default:
			console.warn(`[recv] unknown type ignored: ${msg.type}`);
	}
}

wss.on("connection", (ws, req) => {
	console.log(`[ws] client connected from ${req.socket.remoteAddress}`);
	send(ws, buildState());
	ws.on("message", (data) => handleMessage(ws, data.toString()));
	ws.on("close", () => console.log("[ws] client disconnected"));
	ws.on("error", (err) => console.warn(`[ws] client error: ${err.message}`));
});
wss.on("listening", () => {
	console.log(`TFAR mock server on ws://${HOST}:${PORT}${CYCLE ? " (cycling)" : ""}`);
	printHelp();
});
wss.on("error", (err) => {
	console.error(`[ws] server error: ${err.message}`);
	process.exit(1);
});

/** off → 1 → 2 … → max → off */
function nextAdditional(current: number | null, max: number): number | null {
	if (current === null) return 1;
	return current >= max ? null : current + 1;
}

function printHelp(): void {
	console.log(
		[
			"Keys:",
			"  g  toggle inGame        s  toggle SW radio      b  toggle LR backpack",
			"  v  toggle in-vehicle    f  randomize frequencies",
			"  a  cycle SW additional channel (off,1..8)     l  cycle LR backpack additional (off,1..9)",
			"  1-9  set SW channel     p  print state          h  help      q  quit",
		].join("\n"),
	);
}

function onKey(key: string): void {
	switch (key) {
		case "g": world.inGame = !world.inGame; break;
		case "s": world.hasSw = !world.hasSw; break;
		case "b": world.hasBackpack = !world.hasBackpack; break;
		case "v":
			world.inVehicle = !world.inVehicle;
			world.activeLr = world.inVehicle ? "vehicle" : "backpack"; // TFAR picks the vehicle LR when seated
			break;
		case "f":
			world.sw.frequencies = randomFreqs(8, 30, 512);
			world.backpack.frequencies = randomFreqs(9, 30, 87);
			world.vehicle.frequencies = randomFreqs(9, 30, 87);
			break;
		case "a": world.sw.additionalChannel = nextAdditional(world.sw.additionalChannel, 8); break;
		case "l": world.backpack.additionalChannel = nextAdditional(world.backpack.additionalChannel, 9); break;
		case "p": console.log(JSON.stringify(buildState(), null, 2)); return;
		case "h": printHelp(); return;
		case "q": case "\u0003": process.exit(0);
		default:
			if (key >= "1" && key <= "8" && world.hasSw) { world.sw.channel = Number(key); break; }
			return;
	}
	broadcast(`key ${key}`);
}

if (process.stdin.isTTY) {
	process.stdin.setRawMode(true);
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk: string) => { for (const ch of chunk) onKey(ch.toLowerCase()); });
}

if (CYCLE) {
	// Simulates someone else changing things in-game: every 5 s move SW to the next channel.
	setInterval(() => {
		if (!world.hasSw) return;
		world.sw.channel = (world.sw.channel % 8) + 1;
		broadcast("cycle");
	}, 5000);
}
