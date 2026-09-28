// WebSocket client to the game side with auto-reconnect (backoff 1s → 2s → 5s, max 5s).
import streamDeck from "@elgato/streamdeck";
import { parseState, PROTOCOL_VERSION, type RadioKind } from "./protocol.ts";
import { store } from "./state.ts";

const URL = `ws://127.0.0.1:${process.env.TFAR_SD_PORT ?? 9800}`;
const BACKOFF_MS = [1000, 2000, 5000];

const log = streamDeck.logger.createScope("connection");

let socket: WebSocket | null = null;
let attempt = 0;

function send(msg: object): boolean {
	if (socket?.readyState !== WebSocket.OPEN) return false;
	socket.send(JSON.stringify({ ...msg, v: PROTOCOL_VERSION }));
	return true;
}

function scheduleReconnect(): void {
	const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
	attempt++;
	setTimeout(connect, delay);
}

function onMessage(data: unknown): void {
	if (typeof data !== "string") {
		log.warn("Ignoring non-text frame");
		return;
	}
	let msg: unknown;
	try {
		msg = JSON.parse(data);
	} catch {
		log.warn(`Ignoring malformed JSON: ${data.slice(0, 200)}`);
		return;
	}
	const state = parseState(msg);
	if (state) {
		log.debug(`state inGame=${state.inGame} sw=${state.sw.present ? state.sw.channel : "-"} lr=${state.lr.present ? state.lr.channel : "-"}`);
		store.setGame(state);
	} else log.warn(`Ignoring unknown message: ${data.slice(0, 200)}`);
}

export function connect(): void {
	let ws: WebSocket;
	try {
		ws = new WebSocket(URL);
	} catch (err) {
		log.error(`Cannot create WebSocket: ${err}`);
		scheduleReconnect();
		return;
	}
	socket = ws;
	ws.addEventListener("open", () => {
		log.info(`Connected to ${URL}`);
		attempt = 0;
		store.setConnected(true);
		send({ type: "hello", client: "streamdeck" });
	});
	ws.addEventListener("message", (ev) => onMessage(ev.data));
	ws.addEventListener("close", () => {
		if (socket !== ws) return;
		socket = null;
		store.setConnected(false);
		scheduleReconnect();
	});
	// "error" is always followed by "close", which handles reconnecting.
	ws.addEventListener("error", () => log.debug(`Connection to ${URL} failed`));
}

export function sendSetChannel(radio: RadioKind, channel: number): boolean {
	log.info(`setChannel ${radio} ${channel}`);
	return send({ type: "setChannel", radio, channel });
}

export function requestState(): boolean {
	return send({ type: "requestState" });
}
