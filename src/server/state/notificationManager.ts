import type { Connection } from "vscode-languageserver/node";
import { MISSING_TSQLLINT_NOTICE_COOLDOWN_MS } from "../config/constants";
import { firstLine } from "../shared/textUtils";

/**
 * Manages user notifications with cooldown support.
 */
export class NotificationManager {
	private lastMissingTsqllintNoticeAtMs = 0;

	constructor(private readonly connection: Connection) {}

	/**
	 * Notify about missing tsqlrefine with cooldown to avoid spamming.
	 */
	async maybeNotifyMissingTsqllint(message: string): Promise<void> {
		const now = Date.now();
		if (
			now - this.lastMissingTsqllintNoticeAtMs <
			MISSING_TSQLLINT_NOTICE_COOLDOWN_MS
		) {
			return;
		}
		this.lastMissingTsqllintNoticeAtMs = now;
		const action = await this.connection.window.showWarningMessage(
			`tsqlrefine: ${message}`,
			{ title: "Open Install Guide" },
		);
		if (action?.title === "Open Install Guide") {
			this.connection.sendNotification("tsqlrefine/openInstallGuide");
		}
	}

	/**
	 * Notify about a general run failure.
	 */
	async notifyRunFailure(error: unknown): Promise<void> {
		const message = String(error);
		await this.connection.window.showWarningMessage(
			`tsqlrefine: failed to run (${message})`,
		);
		this.connection.console.warn(`tsqlrefine: failed to run (${message})`);
	}

	/**
	 * Notify about stderr output from the CLI.
	 */
	async notifyStderr(stderr: string): Promise<void> {
		const trimmed = stderr.trim();
		if (!trimmed) {
			return;
		}
		await this.connection.window.showWarningMessage(
			`tsqlrefine: ${firstLine(trimmed)}`,
		);
		this.connection.console.warn(trimmed);
	}

	/**
	 * Check if an error message indicates missing tsqlrefine.
	 */
	isMissingTsqllintError(message: string): boolean {
		const normalized = message.toLowerCase();
		return (
			normalized.includes("tsqlrefine not found") ||
			normalized.includes("tsqlrefine.path not found") ||
			normalized.includes("tsqlrefine.path is not a file")
		);
	}

	/**
	 * Log a message to the console.
	 */
	log(message: string): void {
		this.connection.console.log(message);
	}

	/**
	 * Log a warning to the console.
	 */
	warn(message: string): void {
		this.connection.console.warn(message);
	}

	/**
	 * Log an error to the console.
	 */
	error(message: string): void {
		this.connection.console.error(message);
	}
}
