import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",

	setup(build) {
		build.onStart(() => {
			console.log("[watch] build started");
		});
		build.onEnd((result) => {
			for (const { text, location } of result.errors) {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(
						`    ${location.file}:${location.line}:${location.column}:`,
					);
				}
			}
			for (const { text, location } of result.warnings) {
				console.warn(`▲ [WARNING] ${text}`);
				if (location) {
					console.warn(
						`    ${location.file}:${location.line}:${location.column}:`,
					);
				}
			}
			console.log("[watch] build finished");
		});
	},
};

/**
 * @type {import('esbuild').BuildOptions}
 */
const baseConfig = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: "node",
	target: "node22",
	logLevel: watch ? "silent" : "warning",
	plugins: watch ? [esbuildProblemMatcherPlugin] : [],
};

async function main() {
	const builds = [
		{
			...baseConfig,
			entryPoints: ["src/extension.ts"],
			outfile: "dist/extension.js",
			external: ["vscode"],
			format: "cjs",
		},
		{
			...baseConfig,
			entryPoints: ["src/server/server.ts"],
			outfile: "dist/server.js",
			external: [],
			format: "cjs",
		},
	];

	if (watch) {
		const contexts = await Promise.all(
			builds.map((build) => esbuild.context(build)),
		);
		await Promise.all(contexts.map((context) => context.watch()));
	} else {
		await Promise.all(builds.map((build) => esbuild.build(build)));
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
