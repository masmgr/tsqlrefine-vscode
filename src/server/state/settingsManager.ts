import type { Connection } from "vscode-languageserver/node";
import {
	DOCUMENT_SETTINGS_CACHE_MAX_SIZE,
	DOCUMENT_SETTINGS_CACHE_TTL_MS,
} from "../config/constants";
import { defaultSettings, type TsqlRefineSettings } from "../config/settings";

type DocumentSettingsCacheEntry = {
	settings: TsqlRefineSettings;
	cachedAtMs: number;
};

/**
 * Manages settings retrieval and normalization.
 */
export class SettingsManager {
	private settings: TsqlRefineSettings = defaultSettings;

	/**
	 * Short-lived cache of per-document settings to avoid repeated LSP
	 * round-trips during rapid typing. Invalidated on configuration change.
	 */
	private readonly documentSettingsCache = new Map<
		string,
		DocumentSettingsCacheEntry
	>();

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
		// Global settings feed into per-document settings, so the cache is stale.
		this.documentSettingsCache.clear();
	}

	/**
	 * Get settings for a specific document, merging global and scoped settings.
	 * Results are cached briefly to avoid repeated LSP round-trips during typing.
	 */
	async getSettingsForDocument(uri: string): Promise<TsqlRefineSettings> {
		const cached = this.documentSettingsCache.get(uri);
		if (
			cached &&
			Date.now() - cached.cachedAtMs < DOCUMENT_SETTINGS_CACHE_TTL_MS
		) {
			return cached.settings;
		}

		const scopedConfig = ((await this.connection.workspace.getConfiguration({
			scopeUri: uri,
			section: "tsqlrefine",
		})) ?? {}) as Partial<TsqlRefineSettings>;
		const settings = this.normalizeSettings({
			...defaultSettings,
			...this.settings,
			...scopedConfig,
		});

		this.setCachedDocumentSettings(uri, settings);
		return settings;
	}

	/**
	 * Invalidate cached settings for a single document (e.g. on close).
	 */
	invalidateDocument(uri: string): void {
		this.documentSettingsCache.delete(uri);
	}

	/**
	 * Invalidate all cached document settings (e.g. on workspace changes).
	 */
	invalidateAll(): void {
		this.documentSettingsCache.clear();
	}

	private setCachedDocumentSettings(
		uri: string,
		settings: TsqlRefineSettings,
	): void {
		// Bound the cache size to prevent unbounded growth across many documents.
		if (
			this.documentSettingsCache.size >= DOCUMENT_SETTINGS_CACHE_MAX_SIZE &&
			!this.documentSettingsCache.has(uri)
		) {
			const oldestKey = this.documentSettingsCache.keys().next().value;
			if (oldestKey !== undefined) {
				this.documentSettingsCache.delete(oldestKey);
			}
		}
		this.documentSettingsCache.set(uri, {
			settings,
			cachedAtMs: Date.now(),
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
