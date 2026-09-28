import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import { sendSetChannel } from "../connection.ts";
import { normalizeSettings, renderKey, type ChannelSettings } from "../render.ts";
import { store } from "../state.ts";

/** One key = one channel of one radio kind. Shows the frequency and highlights the active channel. */
@action({ UUID: "com.liron.tfar.channel" })
export class TfarChannel extends SingletonAction<ChannelSettings> {
	constructor() {
		super();
		store.on("change", () => void this.renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<ChannelSettings>): Promise<void> {
		await this.render(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ChannelSettings>): Promise<void> {
		await this.render(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<ChannelSettings>): Promise<void> {
		const { radio, channel } = normalizeSettings(ev.payload.settings);
		if (!sendSetChannel(radio, channel)) {
			await ev.action.showAlert();
			return;
		}
		// No optimistic highlight: the next `state` from the game re-renders all keys.
		// (Automatic state toggling on press is disabled in the manifest.)
	}

	private async renderAll(): Promise<void> {
		for (const a of this.actions) {
			try {
				await this.render(a, await a.getSettings());
			} catch (err) {
				streamDeck.logger.error(`Render failed: ${err}`);
			}
		}
	}

	private async render(
		a: { setTitle(t: string): Promise<void>; isKey(): boolean; setState?(s: 0 | 1): Promise<void> },
		settings: ChannelSettings,
	): Promise<void> {
		const view = renderKey(settings, store.connected, store.game);
		await a.setTitle(view.title);
		if (a.isKey() && "setState" in a && a.setState) await a.setState(view.state);
	}
}
