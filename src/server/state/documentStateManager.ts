/**
 * Manages document-related state for the server.
 * Handles in-flight operation tracking and saved version tracking.
 */
export class DocumentStateManager {
	private readonly inFlightByUri = new Map<string, AbortController>();
	private readonly savedVersionByUri = new Map<string, number>();

	/**
	 * Set the saved version for a document.
	 */
	setSavedVersion(uri: string, version: number): void {
		this.savedVersionByUri.set(uri, version);
	}

	/**
	 * Get the saved version for a document.
	 */
	getSavedVersion(uri: string): number | undefined {
		return this.savedVersionByUri.get(uri);
	}

	/**
	 * Clear the saved version for a document.
	 */
	clearSavedVersion(uri: string): void {
		this.savedVersionByUri.delete(uri);
	}

	/**
	 * Check if the document's current version matches the saved version.
	 */
	isSaved(uri: string, currentVersion: number): boolean {
		const savedVersion = this.savedVersionByUri.get(uri);
		return savedVersion !== undefined && savedVersion === currentVersion;
	}

	/**
	 * Set an in-flight abort controller for a document.
	 */
	setInFlight(uri: string, controller: AbortController): void {
		this.inFlightByUri.set(uri, controller);
	}

	/**
	 * Get the in-flight abort controller for a document.
	 */
	getInFlight(uri: string): AbortController | undefined {
		return this.inFlightByUri.get(uri);
	}

	/**
	 * Check if the given controller is still the current in-flight controller.
	 */
	isCurrentInFlight(uri: string, controller: AbortController): boolean {
		return this.inFlightByUri.get(uri) === controller;
	}

	/**
	 * Cancel any in-flight operation for a document.
	 */
	cancelInFlight(uri: string): void {
		const controller = this.inFlightByUri.get(uri);
		if (controller) {
			controller.abort();
			this.inFlightByUri.delete(uri);
		}
	}

	/**
	 * Clear the in-flight controller for a document (without aborting).
	 */
	clearInFlight(uri: string): void {
		this.inFlightByUri.delete(uri);
	}

	/**
	 * Clear all state for a document.
	 */
	clearAll(uri: string): void {
		this.cancelInFlight(uri);
		this.clearSavedVersion(uri);
	}
}
