import {IrcEventHandler} from "../../client";
import Msg from "../../models/msg";
import {MessageType} from "../../../shared/types/msg";

type ServerLinkEntry = {
	address?: string;
	access_via?: string;
	hops?: number;
	description?: string;
};

type ServerLinksPayload = {
	links?: ServerLinkEntry[];
};

export default <IrcEventHandler>function (irc, network) {
	const client = this;

	irc.on("server links", (data: ServerLinksPayload) => {
		const lobby = network.getLobby();
		const links = Array.isArray(data?.links) ? data.links : [];

		if (links.length === 0) {
			lobby.pushMessage(
				client,
				new Msg({
					type: MessageType.MONOSPACE_BLOCK,
					command: "links",
					text: "No LINKS results.",
				}),
				true
			);
			return;
		}

		const lines = links.map((entry) => {
			const address = entry.address || "(unknown)";
			const via = entry.access_via ? ` via ${entry.access_via}` : "";
			const hops = Number.isFinite(entry.hops) ? ` [hops: ${entry.hops}]` : "";
			const description = entry.description ? ` - ${entry.description}` : "";

			return `${address}${via}${hops}${description}`;
		});

		lobby.pushMessage(
			client,
			new Msg({
				type: MessageType.MONOSPACE_BLOCK,
				command: "links",
				text: lines.join("\n"),
			}),
			true
		);
	});
};
