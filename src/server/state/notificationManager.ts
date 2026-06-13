import type { Connection } from "vscode-languageserver/node";
import { MISSING_TSQLREFINE_NOTICE_COOLDOWN_MS } from "../config/constants";
import { firstLine } from "../shared/textUtils";

/**
 * Manages user notifications with cooldown support.
 */
export class NotificationManager {
	private lastMissingTsqlRefineNoticeAtMs = 0;

	/**
	 * Whether verbose debug logging is enabled. Driven by the client's
	 * `tsqlrefine.trace.server` setting (off => disabled). When disabled,
	 * lazy debug message factories are never evaluated, avoiding the cost of
	 * building (and sending) trace strings on hot paths like parseOutput.
	 */
	private debugEnabled = false;

	constructor(private readonly connection: Connection) {}

	/**
	 * Enable or disable verbose debug logging.
	 */
	setDebugEnabled(enabled: boolean): void {
		this.debugEnabled = enabled;
	}

	/**
	 * Whether verbose debug logging is currently enabled.
	 */
	isDebugEnabled(): boolean {
		return this.debugEnabled;
	}

	/**
	 * Notify about missing tsqlrefine with cooldown to avoid spamming.
	 */
	async maybeNotifyMissingTsqlRefine(message: string): Promise<void> {
		const now = Date.now();
		if (
			now - this.lastMissingTsqlRefineNoticeAtMs <
			MISSING_TSQLREFINE_NOTICE_COOLDOWN_MS
		) {
			return;
		}
		this.lastMissingTsqlRefineNoticeAtMs = now;
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
	notifyRunFailure(error: unknown): void {
		const message = String(error);
		const formatted = `tsqlrefine: run failed (${message})`;
		// Don't await - warning message may block in some environments
		void this.connection.window.showWarningMessage(formatted);
		this.connection.console.warn(formatted);
	}

	/**
	 * Notify about stderr output from the CLI.
	 */
	notifyStderr(stderr: string): void {
		const trimmed = stderr.trim();
		if (!trimmed) {
			return;
		}
		// Don't await - warning message may block in some environments
		void this.connection.window.showWarningMessage(
			`tsqlrefine: ${firstLine(trimmed)}`,
		);
		this.connection.console.warn(trimmed);
	}

	/**
	 * Check if an error message indicates missing tsqlrefine.
	 */
	isMissingTsqlRefineError(message: string): boolean {
		const normalized = message.toLowerCase();
		return (
			normalized.includes("tsqlrefine not found") ||
			normalized.includes("tsqlrefine.path not found") ||
			normalized.includes("tsqlrefine.path is not a file")
		);
	}

	/**
	 * Log a debug message to the console (verbose tracing, not shown by default).
	 *
	 * Accepts a lazily-evaluated factory so that callers on hot paths can defer
	 * expensive message construction (e.g. JSON.stringify). When debug logging
	 * is disabled, the factory is never invoked and nothing is sent.
	 */
	debug(message: string | (() => string)): void {
		if (!this.debugEnabled) {
			return;
		}
		const resolved = typeof message === "function" ? message() : message;
		this.connection.console.debug(resolved);
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
