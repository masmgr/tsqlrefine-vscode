/**
 * Fake CLI helper for creating mock tsqllint executables in tests.
 * Creates temporary executables that run custom JavaScript code.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { rmWithRetry } from "./cleanup";

/**
 * Fake CLI instance with cleanup method.
 */
export type FakeCli = {
	/** Path to the fake CLI executable */
	commandPath: string;
	/** Cleanup function to remove temporary files */
	cleanup: () => Promise<void>;
};

/**
 * Creates a fake tsqllint CLI executable for testing.
 * The fake CLI runs custom JavaScript code instead of real linting.
 *
 * @param scriptBody - JavaScript code to execute when CLI is invoked
 * @returns FakeCli instance with commandPath and cleanup method
 *
 * @example
 * const cli = await createFakeCli(`
 *   const args = process.argv.slice(2);
 *   const filePath = args[args.length - 1] || "";
 *   process.stdout.write(\`\${filePath}(1,1): error Rule : Message.\`);
 * `);
 * // Use cli.commandPath in tests
 * await cli.cleanup(); // Clean up when done
 */
export async function createFakeCli(scriptBody: string): Promise<FakeCli> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqllint-fake-"));
	const scriptPath = path.join(dir, "fake-tsqllint.js");
	await fs.writeFile(scriptPath, `${scriptBody}\n`, "utf8");

	const nodePath = process.execPath;
	let commandPath: string;

	if (process.platform === "win32") {
		commandPath = path.join(dir, "fake-tsqllint.cmd");
		const cmd = `@echo off\r\n"${nodePath}" "${scriptPath}" %*\r\n`;
		await fs.writeFile(commandPath, cmd, "utf8");
	} else {
		commandPath = path.join(dir, "fake-tsqllint");
		const sh = `#!/bin/sh\n"${nodePath}" "${scriptPath}" "$@"\n`;
		await fs.writeFile(commandPath, sh, "utf8");
		await fs.chmod(commandPath, 0o755);
	}

	return {
		commandPath,
		cleanup: async () => {
			await rmWithRetry(dir, { throwOnFailure: true });
		},
	};
}
