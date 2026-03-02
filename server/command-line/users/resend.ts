import log from "../../log";
import colors from "chalk";
import {Command} from "commander";
import registration from "../../plugins/registration";
import Utils from "../utils";

const program = new Command("resend");
program
	.description("Resend account activation email for a pending registration")
	.on("--help", Utils.extraHelp)
	.argument("<email>", "email address used during registration")
	.action(async function (email) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const ClientManager = require("../../clientManager").default;
		const manager = new ClientManager();

		try {
			const result = await registration.resendActivationEmail(email, manager);

			if (!result.ok) {
				switch (result.reason) {
					case "disabled":
						log.error("Registration is disabled in config.");
						return;
					case "not_found":
						log.error(`No pending registration found for ${colors.bold(email)}.`);
						return;
					case "already_used":
						log.error(
							`Registration for ${colors.bold(
								email
							)} was already used. User may already be activated.`
						);
						return;
					case "already_exists":
						log.error(`User ${colors.bold(email)} already exists.`);
						return;
					default:
						log.error(`Could not resend activation email for ${colors.bold(email)}.`);
						return;
				}
			}

			log.info(`Activation email resent to ${colors.bold(result.email)}.`);
			log.info(
				`New token expires at ${colors.green(new Date(result.expiresAt).toISOString())}.`
			);
		} catch (error: any) {
			log.error(`Failed to resend activation email: ${error.message}`);
		}
	});

export default program;
