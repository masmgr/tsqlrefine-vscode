export type LintReason = "save" | "type" | "manual" | "open";
export type PendingLint = {
	reason: LintReason;
	version: number | null;
};

type SchedulerOptions = {
	maxConcurrentRuns: number;
	getDocumentVersion: (uri: string) => number | null;
	runLint: (uri: string, pending: PendingLint) => Promise<number>;
};

type Release = () => void;

class Semaphore {
	private available: number;
	private waiters: Array<(release: Release) => void> = [];

	constructor(maxConcurrentRuns: number) {
		this.available = Math.max(1, maxConcurrentRuns);
	}

	tryAcquire(): Release | null {
		if (this.available <= 0) {
			return null;
		}
		this.available -= 1;
		return this.createRelease();
	}

	acquire(): Promise<Release> {
		const release = this.tryAcquire();
		if (release) {
			return Promise.resolve(release);
		}
		return new Promise((resolve) => {
			this.waiters.push(resolve);
		});
	}

	private createRelease(): Release {
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			this.available += 1;
			const next = this.waiters.shift();
			if (next) {
				this.available -= 1;
				next(this.createRelease());
			}
		};
	}
}

export class LintScheduler {
	private readonly options: SchedulerOptions;
	private readonly semaphore: Semaphore;
	private readonly pendingByUri = new Map<string, PendingLint>();
	private readonly debounceTimerByUri = new Map<string, NodeJS.Timeout>();
	private readonly queuedUris: string[] = [];
	private draining = false;

	constructor(options: SchedulerOptions) {
		this.options = options;
		this.semaphore = new Semaphore(options.maxConcurrentRuns);
	}

	clear(uri: string): void {
		this.clearDebounce(uri);
		this.pendingByUri.delete(uri);
		this.removeFromQueue(uri);
	}

	requestLint(
		uri: string,
		reason: LintReason,
		version: number | null,
		debounceMs?: number,
	): Promise<number> {
		this.pendingByUri.set(uri, { reason, version });
		if (reason === "manual") {
			return this.runWhenPossible(uri);
		}
		this.scheduleLint(uri, reason, debounceMs);
		return Promise.resolve(0);
	}

	private scheduleLint(
		uri: string,
		reason: LintReason,
		debounceMs?: number,
	): void {
		this.clearDebounce(uri);
		if (reason !== "type") {
			void this.runIfReady(uri);
			return;
		}
		const delay = Math.max(0, debounceMs ?? 0);
		const timer = setTimeout(() => {
			this.debounceTimerByUri.delete(uri);
			void this.runIfReady(uri);
		}, delay);
		this.debounceTimerByUri.set(uri, timer);
	}

	private clearDebounce(uri: string): void {
		const timer = this.debounceTimerByUri.get(uri);
		if (timer) {
			clearTimeout(timer);
			this.debounceTimerByUri.delete(uri);
		}
	}

	private async runIfReady(uri: string): Promise<void> {
		this.clearDebounce(uri);
		const release = this.semaphore.tryAcquire();
		if (!release) {
			this.queueUri(uri);
			return;
		}
		await this.runWithRelease(uri, release, false);
	}

	private async runWhenPossible(uri: string): Promise<number> {
		this.clearDebounce(uri);
		this.removeFromQueue(uri);
		const release = await this.semaphore.acquire();
		return await this.runWithRelease(uri, release, true);
	}

	private async runWithRelease(
		uri: string,
		release: Release,
		forceLatestVersion: boolean,
	): Promise<number> {
		try {
			const pending = this.pendingByUri.get(uri);
			if (!pending) {
				return 0;
			}
			this.pendingByUri.delete(uri);

			const currentVersion = this.options.getDocumentVersion(uri);
			if (currentVersion === null) {
				return 0;
			}

			if (
				pending.version !== null &&
				pending.version !== currentVersion &&
				!forceLatestVersion
			) {
				pending.version = currentVersion;
				this.pendingByUri.set(uri, pending);
				this.queueUri(uri);
				return 0;
			}

			if (
				pending.version !== null &&
				pending.version !== currentVersion &&
				forceLatestVersion
			) {
				pending.version = currentVersion;
			}

			return await this.options.runLint(uri, pending);
		} finally {
			release();
			void this.drainQueue();
		}
	}

	private queueUri(uri: string): void {
		if (!this.queuedUris.includes(uri)) {
			this.queuedUris.push(uri);
		}
	}

	private removeFromQueue(uri: string): void {
		const index = this.queuedUris.indexOf(uri);
		if (index >= 0) {
			this.queuedUris.splice(index, 1);
		}
	}

	private async drainQueue(): Promise<void> {
		if (this.draining) {
			return;
		}
		this.draining = true;
		try {
			while (this.queuedUris.length > 0) {
				const release = this.semaphore.tryAcquire();
				if (!release) {
					return;
				}
				const nextUri = this.queuedUris.shift();
				if (!nextUri) {
					release();
					continue;
				}
				if (!this.pendingByUri.has(nextUri)) {
					release();
					continue;
				}
				await this.runWithRelease(nextUri, release, false);
			}
		} finally {
			this.draining = false;
		}
	}
}
