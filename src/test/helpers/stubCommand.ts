import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Create a directory under `rootDir` holding a spawnable no-op command, so a
 * test can put it on PATH and let command resolution succeed without the real
 * tsqlrefine CLI.
 */
export async function createStubCommandDir(
	rootDir: string,
	commandName = "tsqlrefine",
): Promise<string> {
	const dir = path.join(rootDir, "bin");
	await fs.mkdir(dir, { recursive: true });
	if (process.platform === "win32") {
		// Node's spawn resolves PATHEXT, so the stub must be a real executable.
		const target = path.join(dir, `${commandName}.exe`);
		try {
			await fs.link(process.execPath, target);
		} catch {
			await fs.copyFile(process.execPath, target);
		}
	} else {
		const target = path.join(dir, commandName);
		await fs.writeFile(target, "#!/bin/sh\nexit 0\n");
		await fs.chmod(target, 0o755);
	}
	return dir;
}
