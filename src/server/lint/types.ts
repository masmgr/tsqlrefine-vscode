export type LintRunResult = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
	cancelled: boolean;
};
