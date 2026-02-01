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
		if (
			!["error", "warning", "info", "hint"].includes(normalized.minSeverity)
		) {
			normalized.minSeverity = "info";
		}
		return normalized;
	}
}
