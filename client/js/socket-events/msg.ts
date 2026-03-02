import socket from "../socket";
import {cleanIrcMessage} from "../../../shared/irc";
import {playNotificationSound} from "../notification-audio";
import {store} from "../store";
import {switchToChannel} from "../router";
import {ClientChan, NetChan, ClientMessage} from "../types";
import {SharedMsg, MessageType} from "../../../shared/types/msg";
import {ChanType} from "../../../shared/types/chan";

socket.on("msg", function (data) {
	const receivingChannel = store.getters.findChannel(data.chan);

	if (!receivingChannel) {
		return;
	}

	let channel = receivingChannel.channel;
	let isActiveChannel =
		store.state.activeChannel && store.state.activeChannel.channel === channel;

	// Display received notices and errors in currently active channel.
	// Reloading the page will put them back into the lobby window.
	if (data.msg.showInActive) {
		// We only want to put errors/notices in active channel if they arrive on the same network
		if (
			store.state.activeChannel &&
			store.state.activeChannel.network === receivingChannel.network
		) {
			channel = store.state.activeChannel.channel;

			// Do not update unread/highlight counters for this channel
			// as we are putting this message in the active channel
			isActiveChannel = true;

			if (data.chan === channel.id) {
				// If active channel is the intended channel for this message,
				// remove the showInActive flag
				delete data.msg.showInActive;
			} else {
				data.chan = channel.id;
			}
		} else {
			delete data.msg.showInActive;
		}
	}

	const previousUnread = channel.unread;
	const previousHighlight = channel.highlight;

	// Keep unread/highlight clear only when this channel is active and the tab is actually in focus.
	// If the tab is in background, still track unread/highlights so title/favicon can alert.
	const tabIsActive = document.visibilityState === "visible" && document.hasFocus();

	if (!isActiveChannel || !tabIsActive) {
		if (typeof data.highlight !== "undefined") {
			channel.highlight = data.highlight;
		}

		if (typeof data.unread !== "undefined") {
			channel.unread = data.unread;
		}
	}

	// Server-side counters don't increase for a channel marked as "open", even if this tab is in background.
	// Compensate locally so title/favicon still alert while tab is inactive.
	if (isActiveChannel && !tabIsActive && !data.msg.self) {
		const isUnreadMessageType =
			data.msg.type === MessageType.MESSAGE || data.msg.type === MessageType.ACTION;

		if (isUnreadMessageType || data.msg.highlight) {
			const serverUnread = typeof data.unread === "number" ? data.unread : channel.unread;

			if (serverUnread <= previousUnread) {
				channel.unread = previousUnread + 1;
			}
		}

		if (data.msg.highlight) {
			const serverHighlight =
				typeof data.highlight === "number" ? data.highlight : channel.highlight;

			if (serverHighlight <= previousHighlight) {
				channel.highlight = previousHighlight + 1;
			}
		}
	}

	channel.messages.push(data.msg);

	if (data.msg.self) {
		channel.firstUnread = data.msg.id;
	} else {
		notifyMessage(data.chan, channel, store.state.activeChannel, data.msg);
	}

	let messageLimit = 0;

	if (!isActiveChannel) {
		// If message arrives in non active channel, keep only 100 messages
		messageLimit = 100;
	} else if (channel.scrolledToBottom) {
		// If message arrives in active channel, keep 1500 messages if scroll is currently at the bottom
		// One history load may load up to 1000 messages at once if condendesed or hidden events are enabled
		messageLimit = 1500;
	}

	if (messageLimit > 0 && channel.messages.length > messageLimit) {
		channel.messages.splice(0, channel.messages.length - messageLimit);
		channel.moreHistoryAvailable = true;
	}

	if (channel.type === ChanType.CHANNEL) {
		updateUserList(channel, data.msg);
	}
});

declare global {
	// this extends the interface from lib.dom with additional stuff which is not
	// exactly standard but implemented in some browsers
	interface NotificationOptions {
		timestamp?: number; // chrome has it, other browsers ignore it
	}
}

function notifyMessage(
	targetId: number,
	channel: ClientChan,
	activeChannel: NetChan | undefined,
	msg: ClientMessage
) {
	if (channel.muted) {
		return;
	}

	if (
		msg.highlight ||
		(store.state.settings.notifyAllMessages && msg.type === MessageType.MESSAGE)
	) {
			if (!document.hasFocus() || !activeChannel || activeChannel.channel !== channel) {
				if (store.state.settings.notification) {
					try {
						playNotificationSound();
					} catch (exception) {
						// On mobile, sounds can not be played without user interaction.
					}
				}

			if (
				store.state.settings.desktopNotifications &&
				"Notification" in window &&
				Notification.permission === "granted"
			) {
				let title: string;
				let body: string;
				// TODO: fix msg type and get rid of that conditional
				const nick = msg.from && msg.from.nick ? msg.from.nick : "unkonown";

				if (msg.type === MessageType.INVITE) {
					title = "New channel invite:";
					body = nick + " invited you to " + msg.channel;
				} else {
					title = nick;

					if (channel.type !== ChanType.QUERY) {
						title += ` (${channel.name})`;
					}

					if (msg.type === MessageType.MESSAGE) {
						title += " says:";
					}

					// TODO: fix msg type and get rid of that conditional
					body = cleanIrcMessage(msg.text ? msg.text : "");
				}

				const timestamp = Date.parse(String(msg.time));

				try {
					if (store.state.hasServiceWorker) {
						navigator.serviceWorker.ready
							.then((registration) => {
								registration.active?.postMessage({
									type: "notification",
									chanId: targetId,
									timestamp: timestamp,
									title: title,
									body: body,
								});
							})
							.catch(() => {
								// no-op
							});
					} else {
						const notify = new Notification(title, {
							tag: `chan-${targetId}`,
							badge: "img/icon-alerted-black-transparent-bg-72x72px.png",
							icon: "img/icon-alerted-grey-bg-192x192px.png",
							body: body,
							timestamp: timestamp,
						});
						notify.addEventListener("click", function () {
							this.close();
							window.focus();

							const channelTarget = store.getters.findChannel(targetId);

							if (channelTarget) {
								switchToChannel(channelTarget.channel);
							}
						});
					}
				} catch (exception) {
					// `new Notification(...)` is not supported and should be silenced.
				}
			}
		}
	}
}

function updateUserList(channel: ClientChan, msg: SharedMsg) {
	switch (msg.type) {
		case MessageType.MESSAGE: // fallthrough

		case MessageType.ACTION: {
			const user = channel.users.find((u) => u.nick === msg.from?.nick);

			if (user) {
				user.lastMessage = new Date(msg.time).getTime() || Date.now();
			}

			break;
		}

		case MessageType.QUIT: // fallthrough

		case MessageType.PART: {
			const idx = channel.users.findIndex((u) => u.nick === msg.from?.nick);

			if (idx > -1) {
				channel.users.splice(idx, 1);
			}

			break;
		}

		case MessageType.KICK: {
			const idx = channel.users.findIndex((u) => u.nick === msg.target?.nick);

			if (idx > -1) {
				channel.users.splice(idx, 1);
			}

			break;
		}
	}
}
