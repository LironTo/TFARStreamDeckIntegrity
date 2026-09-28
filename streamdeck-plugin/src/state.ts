// Typed store for the latest game state and connection status.
import { EventEmitter } from "node:events";
import type { GameState } from "./protocol.ts";

class StateStore extends EventEmitter<{ change: [] }> {
	connected = false;
	game: GameState | null = null;

	setConnected(connected: boolean): void {
		if (this.connected === connected) return;
		this.connected = connected;
		if (!connected) this.game = null;
		this.emit("change");
	}

	setGame(game: GameState): void {
		this.game = game;
		this.emit("change");
	}
}

export const store = new StateStore();
