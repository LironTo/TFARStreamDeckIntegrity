import streamDeck from "@elgato/streamdeck";
import { TfarChannel } from "./actions/tfar-channel.ts";
import { connect } from "./connection.ts";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new TfarChannel());

streamDeck.connect();
connect();
