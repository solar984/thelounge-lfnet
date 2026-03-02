import crypto from "crypto";
import path from "path";
import net from "net";
import tls from "tls";
import os from "os";

import type {Database} from "sqlite3";

import Config from "../config";
import Helper from "../helper";
import ClientManager from "../clientManager";

type RegistrationRecord = {
	email: string;
	password_hash: string;
	token: string;
	created_at: number;
	expires_at: number;
	consumed_at: number | null;
};

type PasswordResetRecord = {
	email: string;
	token: string;
	created_at: number;
	expires_at: number;
	consumed_at: number | null;
};

type ActivationResult =
	| {ok: true; email: string}
	| {
			ok: false;
			reason: "invalid" | "expired" | "already_used" | "already_exists" | "disabled" | "error";
	  };

type PasswordResetResult =
	| {ok: true}
	| {
			ok: false;
			reason: "invalid" | "expired" | "already_used" | "disabled" | "error";
	  };

type PasswordResetTokenStatus =
	| {ok: true}
	| {
			ok: false;
			reason: "invalid" | "expired" | "already_used" | "disabled";
	  };

let sqlite3: any;

try {
	sqlite3 = require("sqlite3");
} catch (error) {
	sqlite3 = null;
}

class RegistrationService {
	private database: Database | null = null;
	private isReady = false;

	isEnabled() {
		if (Config.values.public) {
			return false;
		}

		return Config.values.registration.enable;
	}

	async initialize() {
		if (this.isReady || !this.isEnabled()) {
			return;
		}

		if (!sqlite3) {
			throw new Error("sqlite3 module is required for registration support");
		}

		const dbPath = path.join(Config.getHomePath(), "registrations.sqlite3");
		this.database = new sqlite3.Database(dbPath);

		await this.run(
			`CREATE TABLE IF NOT EXISTS pending_registrations (
				email TEXT NOT NULL,
				password_hash TEXT NOT NULL,
				token TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				consumed_at INTEGER
			)`
		);
		await this.run(
			"CREATE UNIQUE INDEX IF NOT EXISTS pending_registrations_email_idx ON pending_registrations(email)"
		);
		await this.run(
			"CREATE INDEX IF NOT EXISTS pending_registrations_expires_idx ON pending_registrations(expires_at)"
		);
		await this.run(
			`CREATE TABLE IF NOT EXISTS password_resets (
				email TEXT NOT NULL,
				token TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				consumed_at INTEGER
			)`
		);
		await this.run(
			"CREATE UNIQUE INDEX IF NOT EXISTS password_resets_email_idx ON password_resets(email)"
		);
		await this.run(
			"CREATE INDEX IF NOT EXISTS password_resets_expires_idx ON password_resets(expires_at)"
		);

		this.isReady = true;
	}

	async close() {
		return new Promise<void>((resolve) => {
			if (!this.database) {
				resolve();
				return;
			}

			this.database.close(() => {
				this.database = null;
				this.isReady = false;
				resolve();
			});
		});
	}

	async createPendingRegistration(emailInput: string, password: string) {
		await this.initialize();

		if (!this.database) {
			throw new Error("Registration storage is not initialized");
		}

		const email = emailInput.trim().toLowerCase();

		if (!this.isValidEmail(email)) {
			throw new Error("Please provide a valid email address.");
		}

		if (password.length < 8) {
			throw new Error("Password must be at least 8 characters.");
		}

		const createdAt = Date.now();
		const expiresAt = createdAt + Config.values.registration.tokenTtlMinutes * 60 * 1000;
		const token = crypto.randomBytes(32).toString("hex");
		const passwordHash = Helper.password.hash(password);

		await this.cleanup(createdAt);

		await this.run(
			`INSERT INTO pending_registrations (email, password_hash, token, created_at, expires_at, consumed_at)
			 VALUES (?, ?, ?, ?, ?, NULL)
			 ON CONFLICT(email) DO UPDATE SET
				password_hash = excluded.password_hash,
				token = excluded.token,
				created_at = excluded.created_at,
				expires_at = excluded.expires_at,
				consumed_at = NULL`,
			email,
			passwordHash,
			token,
			createdAt,
			expiresAt
		);

		const activationUrl = this.getActivationUrl(token);
		await this.sendActivationEmail(email, activationUrl);

		return {
			email,
			activationUrl,
			expiresAt,
		};
	}

	async activate(tokenInput: string, manager: ClientManager): Promise<ActivationResult> {
		if (!this.isEnabled()) {
			return {ok: false, reason: "disabled"};
		}

		await this.initialize();

		const token = tokenInput.trim();

		if (!/^[a-fA-F0-9]{64}$/.test(token)) {
			return {ok: false, reason: "invalid"};
		}

		const row = await this.get<RegistrationRecord>(
			"SELECT * FROM pending_registrations WHERE token = ?",
			token
		);

		if (!row) {
			return {ok: false, reason: "invalid"};
		}

		if (row.consumed_at !== null) {
			return {ok: false, reason: "already_used"};
		}

		if (row.expires_at < Date.now()) {
			return {ok: false, reason: "expired"};
		}

		if (manager.findClient(row.email)) {
			return {ok: false, reason: "already_exists"};
		}

		const created = manager.addUser(row.email, row.password_hash, false);

		if (!created) {
			return {ok: false, reason: "already_exists"};
		}

		await this.run(
			"UPDATE pending_registrations SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL",
			Date.now(),
			token
		);

		return {ok: true, email: row.email};
	}

	async createPasswordResetRequest(emailInput: string, manager: ClientManager) {
		if (!this.isEnabled()) {
			return;
		}

		await this.initialize();

		const email = emailInput.trim().toLowerCase();

		if (!this.isValidEmail(email)) {
			return;
		}

		const client = manager.findClient(email);

		// Silently ignore unknown accounts.
		if (!client) {
			return;
		}

		const createdAt = Date.now();
		const expiresAt = createdAt + Config.values.registration.tokenTtlMinutes * 60 * 1000;
		const token = crypto.randomBytes(32).toString("hex");

		await this.cleanup(createdAt);

		await this.run(
			`INSERT INTO password_resets (email, token, created_at, expires_at, consumed_at)
			 VALUES (?, ?, ?, ?, NULL)
			 ON CONFLICT(email) DO UPDATE SET
				token = excluded.token,
				created_at = excluded.created_at,
				expires_at = excluded.expires_at,
				consumed_at = NULL`,
			email,
			token,
			createdAt,
			expiresAt
		);

		await this.sendPasswordResetEmail(email, this.getPasswordResetUrl(token));
	}

	async resetPassword(
		tokenInput: string,
		password: string,
		manager: ClientManager
	): Promise<PasswordResetResult> {
		if (!this.isEnabled()) {
			return {ok: false, reason: "disabled"};
		}

		await this.initialize();

		const token = tokenInput.trim();

		if (!/^[a-fA-F0-9]{64}$/.test(token)) {
			return {ok: false, reason: "invalid"};
		}

		if (password.length < 8) {
			return {ok: false, reason: "error"};
		}

		const row = await this.get<PasswordResetRecord>(
			"SELECT * FROM password_resets WHERE token = ?",
			token
		);

		if (!row) {
			return {ok: false, reason: "invalid"};
		}

		if (row.consumed_at !== null) {
			return {ok: false, reason: "already_used"};
		}

		if (row.expires_at < Date.now()) {
			return {ok: false, reason: "expired"};
		}

		const client = manager.findClient(row.email);

		if (!client) {
			return {ok: false, reason: "invalid"};
		}

		const hash = Helper.password.hash(password);
		const updated = await new Promise<boolean>((resolve) => {
			client.setPassword(hash, (success) => resolve(success));
		});

		if (!updated) {
			return {ok: false, reason: "error"};
		}

		await this.run(
			"UPDATE password_resets SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL",
			Date.now(),
			token
		);

		return {ok: true};
	}

	async getPasswordResetTokenStatus(tokenInput: string): Promise<PasswordResetTokenStatus> {
		if (!this.isEnabled()) {
			return {ok: false, reason: "disabled"};
		}

		await this.initialize();

		const token = tokenInput.trim();

		if (!/^[a-fA-F0-9]{64}$/.test(token)) {
			return {ok: false, reason: "invalid"};
		}

		const row = await this.get<PasswordResetRecord>(
			"SELECT * FROM password_resets WHERE token = ?",
			token
		);

		if (!row) {
			return {ok: false, reason: "invalid"};
		}

		if (row.consumed_at !== null) {
			return {ok: false, reason: "already_used"};
		}

		if (row.expires_at < Date.now()) {
			return {ok: false, reason: "expired"};
		}

		return {ok: true};
	}

	private async sendActivationEmail(email: string, activationUrl: string) {
		const smtp = Config.values.registration.smtp;
		const appName = this.getDisplayName();

		if (!smtp.host || !smtp.port || !Config.values.registration.from) {
			throw new Error(
				"Registration email is not configured. Set registration.from and registration.smtp in config.js"
			);
		}

		await this.sendSmtpMail({
			host: smtp.host,
			port: smtp.port,
			secure: smtp.secure,
			user: smtp.user,
			password: smtp.password,
			from: Config.values.registration.from,
			to: email,
			subject: `Activate your ${appName} account`,
			text:
				"Complete your registration by opening this link:\n\n" +
				activationUrl +
				"\n\nIf you did not request this, you can ignore this email.",
			html:
				"<p>Complete your registration by opening this link:</p>" +
				`<p><a href=\"${this.escapeHtml(activationUrl)}\">${this.escapeHtml(activationUrl)}</a></p>` +
				"<p>If you did not request this, you can ignore this email.</p>",
		});
	}

	private async sendPasswordResetEmail(email: string, resetUrl: string) {
		const smtp = Config.values.registration.smtp;
		const appName = this.getDisplayName();

		if (!smtp.host || !smtp.port || !Config.values.registration.from) {
			throw new Error(
				"Registration email is not configured. Set registration.from and registration.smtp in config.js"
			);
		}

		await this.sendSmtpMail({
			host: smtp.host,
			port: smtp.port,
			secure: smtp.secure,
			user: smtp.user,
			password: smtp.password,
			from: Config.values.registration.from,
			to: email,
			subject: `Reset your ${appName} password`,
			text:
				"Reset your password by opening this link:\n\n" +
				resetUrl +
				"\n\nIf you did not request this, you can ignore this email.",
			html:
				"<p>Reset your password by opening this link:</p>" +
				`<p><a href=\"${this.escapeHtml(resetUrl)}\">${this.escapeHtml(resetUrl)}</a></p>` +
				"<p>If you did not request this, you can ignore this email.</p>",
		});
	}

	private getDisplayName() {
		return Config.values.defaults?.name || "The Lounge";
	}

	private getActivationUrl(token: string) {
		const base = this.getPublicBaseUrl();
		return `${base}/auth/activate/${token}`;
	}

	private getPasswordResetUrl(token: string) {
		const base = this.getPublicBaseUrl();
		return `${base}/#/reset-password/${token}`;
	}

	getClientBaseUrl() {
		return this.getPublicBaseUrl();
	}

	private getPublicBaseUrl() {
		const base = Config.values.registration.activationBaseUrl;

		if (base) {
			return base.replace(/\/$/, "");
		}

		const protocol = Config.values.https.enable ? "https" : "http";
		const host =
			typeof Config.values.host === "string" && Config.values.host.length > 0
				? Config.values.host
				: "localhost";
		const port = Config.values.port;

		return `${protocol}://${host}:${port.toString()}`;
	}

	private isValidEmail(email: string) {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	}

	private async cleanup(now: number) {
		await this.run(
			"DELETE FROM pending_registrations WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)",
			now,
			now - 7 * 24 * 60 * 60 * 1000
		);
		await this.run(
			"DELETE FROM password_resets WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)",
			now,
			now - 7 * 24 * 60 * 60 * 1000
		);
	}

	private escapeHtml(input: string) {
		return input
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	private run(sql: string, ...params: any[]) {
		return new Promise<void>((resolve, reject) => {
			if (!this.database) {
				reject(new Error("Registration database is not initialized"));
				return;
			}

			this.database.run(sql, params, (error) => {
				if (error) {
					reject(error);
					return;
				}

				resolve();
			});
		});
	}

	private get<T>(sql: string, ...params: any[]) {
		return new Promise<T | undefined>((resolve, reject) => {
			if (!this.database) {
				reject(new Error("Registration database is not initialized"));
				return;
			}

			this.database.get(sql, params, (error, row) => {
				if (error) {
					reject(error);
					return;
				}

				resolve(row as T | undefined);
			});
		});
	}

	private async sendSmtpMail(payload: {
		host: string;
		port: number;
		secure: boolean;
		user?: string;
		password?: string;
		from: string;
		to: string;
		subject: string;
		text: string;
		html: string;
	}) {
		let socket = await this.connectSmtp(payload.host, payload.port, payload.secure);

		try {
			await this.readResponse(socket, [220]);
			const ehloResponse = await this.sendCommand(
				socket,
				`EHLO ${os.hostname() || "thelounge"}`,
				[250]
			);

			if (!payload.secure && /\bSTARTTLS\b/i.test(ehloResponse)) {
				await this.sendCommand(socket, "STARTTLS", [220]);
				socket = await this.upgradeSmtpSocket(socket as net.Socket, payload.host);
				await this.sendCommand(socket, `EHLO ${os.hostname() || "thelounge"}`, [250]);
			}

			if (payload.user) {
				await this.sendCommand(socket, "AUTH LOGIN", [334]);
				await this.sendCommand(
					socket,
					Buffer.from(payload.user, "utf8").toString("base64"),
					[334]
				);
				await this.sendCommand(
					socket,
					Buffer.from(payload.password || "", "utf8").toString("base64"),
					[235]
				);
			}

			await this.sendCommand(socket, `MAIL FROM:<${payload.from}>`, [250]);
			await this.sendCommand(socket, `RCPT TO:<${payload.to}>`, [250, 251]);
			await this.sendCommand(socket, "DATA", [354]);

			const dataLines = [
				`From: ${payload.from}`,
				`To: ${payload.to}`,
				`Subject: ${payload.subject}`,
				"MIME-Version: 1.0",
				'Content-Type: multipart/alternative; boundary=\"thelounge-boundary\"',
				"",
				"--thelounge-boundary",
				"Content-Type: text/plain; charset=utf-8",
				"",
				payload.text,
				"",
				"--thelounge-boundary",
				"Content-Type: text/html; charset=utf-8",
				"",
				payload.html,
				"",
				"--thelounge-boundary--",
				"",
				".",
			];
			socket.write(`${dataLines.join("\r\n")}\r\n`);
			await this.readResponse(socket, [250]);
			await this.sendCommand(socket, "QUIT", [221]);
		} finally {
			socket.end();
		}
	}

	private connectSmtp(host: string, port: number, secure: boolean) {
		return new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
			if (secure) {
				const socket = tls.connect(port, host, {servername: host});
				const onError = (error: Error) => {
					socket.destroy();
					reject(error);
				};

				socket.once("error", onError);
				socket.once("secureConnect", () => {
					socket.off("error", onError);
					resolve(socket);
				});
				return;
			}

			const socket = net.createConnection(port, host);
			const onError = (error: Error) => {
				socket.destroy();
				reject(error);
			};

			socket.once("error", onError);
			socket.once("connect", () => {
				socket.off("error", onError);
				resolve(socket);
			});
		});
	}

	private upgradeSmtpSocket(socket: net.Socket, host: string) {
		return new Promise<tls.TLSSocket>((resolve, reject) => {
			const tlsSocket = tls.connect({
				socket,
				servername: host,
			});

			const onError = (error: Error) => {
				tlsSocket.destroy();
				reject(error);
			};

			tlsSocket.once("error", onError);
			tlsSocket.once("secureConnect", () => {
				tlsSocket.off("error", onError);
				resolve(tlsSocket);
			});
		});
	}

	private sendCommand(
		socket: net.Socket | tls.TLSSocket,
		command: string,
		expectedCodes: number[]
	) {
		socket.write(`${command}\r\n`);
		return this.readResponse(socket, expectedCodes);
	}

	private readResponse(socket: net.Socket | tls.TLSSocket, expectedCodes: number[]) {
		return new Promise<string>((resolve, reject) => {
			let response = "";

			const onData = (chunk: Buffer | string) => {
				response += chunk.toString();

				if (!response.includes("\n")) {
					return;
				}

				const lines = response
					.split(/\r?\n/)
					.filter(Boolean)
					.map((line) => line.trim());
				const lastLine = lines.at(-1);

				if (!lastLine || !/^\d{3}[ -]/.test(lastLine)) {
					return;
				}

				const code = Number.parseInt(lastLine.slice(0, 3), 10);

				if (Number.isNaN(code)) {
					cleanup();
					reject(new Error(`Invalid SMTP response: ${lastLine}`));
					return;
				}

				const isMultiLine = lastLine[3] === "-";

				if (isMultiLine) {
					return;
				}

				cleanup();

				if (!expectedCodes.includes(code)) {
					reject(new Error(`SMTP error ${code}: ${lastLine}`));
					return;
				}

				resolve(response);
			};

			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};

			const cleanup = () => {
				socket.off("data", onData);
				socket.off("error", onError);
			};

			socket.on("data", onData);
			socket.on("error", onError);
		});
	}
}

const registration = new RegistrationService();

export default registration;
