import type { Connection } from "vscode-languageserver/node";
import { defaultSettings, type TsqlRefineSettings } from "../config/settings";

/**
 * Manages settings retrieval and normalization.
 */
export class SettingsManager {
	private settings: TsqlRefineSettings = defaultSettings;

	constructor(private readonly connection: Connection) {}

	/**
	 * Get the current global settings.
	 */
	getSettings(): TsqlRefineSettings {
		return this.settings;
	}

	/**
	 * Refresh settings from the workspace configuration.
	 */
	async refreshSettings(): Promise<void> {
		const config =
			(await this.connection.workspace.getConfiguration({
				section: "tsqlrefine",
			})) ?? {};
		this.settings = this.normalizeSettings({
			...defaultSettings,
			...config,
		});
	}

	/**
	 * Get settings for a specific document, merging global and scoped settings.
	 */
	async getSettingsForDocument(uri: string): Promise<TsqlRefineSettings> {
		const scopedConfig = ((await this.connection.workspace.getConfiguration({
			scopeUri: uri,
			section: "tsqlrefine",
		})) ?? {}) as Partial<TsqlRefineSettings>;
		return this.normalizeSettings({
			...defaultSettings,
			...this.settings,
			...scopedConfig,
		});
	}

	/**
	 * Normalize settings values to ensure they are valid.
	 */
	private normalizeSettings(value: TsqlRefineSettings): TsqlRefineSettings {
		const normalized = { ...value };
		if (
			!Number.isFinite(normalized.maxFileSizeKb) ||
			normalized.maxFileSizeKb < 0
		) {
			normalized.maxFileSizeKb = 0;
		}
		if (!Number.isFinite(normalized.timeoutMs) || normalized.timeoutMs <= 0) {
			normalized.timeoutMs = defaultSettings.timeoutMs;
		}
		if (
			normalized.formatTimeoutMs !== undefined &&
			(!Number.isFinite(normalized.formatTimeoutMs) ||
				normalized.formatTimeoutMs <= 0)
		) {
			normalized.formatTimeoutMs =
				defaultSettings.formatTimeoutMs ?? defaultSettings.timeoutMs;
		}
		if (
			normalized.fixTimeoutMs !== undefined &&
			(!Number.isFinite(normalized.fixTimeoutMs) ||
				normalized.fixTimeoutMs <= 0)
		) {
			normalized.fixTimeoutMs =
				defaultSettings.fixTimeoutMs ?? defaultSettings.timeoutMs;
		}
		if (!Number.isFinite(normalized.debounceMs) || normalized.debounceMs < 0) {
			normalized.debounceMs = defaultSettings.debounceMs;
		}
		if (
			!["error", "warning", "info", "hint"].includes(normalized.minSeverity)
		) {
			normalized.minSeverity = "info";
		}
		if (typeof normalized.allowPlugins !== "boolean") {
			normalized.allowPlugins = false;
		}
		return normalized;
	}
}
