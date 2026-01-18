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
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(
					`    ${location?.file}:${location?.line}:${location?.column}:`,
				);
			});
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
	target: "node24",
	logLevel: "silent",
	plugins: [
		/* add to the end of plugins array */
		esbuildProblemMatcherPlugin,
	],
};

async function main() {
	const ctx = await esbuild.context({
		...baseConfig,
		entryPoints: ["src/extension.ts"],
		outfile: "dist/extension.js",
		external: ["vscode"],
		format: "cjs",
	});

	const serverCtx = await esbuild.context({
		...baseConfig,
		entryPoints: ["src/server/server.ts"],
		outfile: "dist/server.js",
		external: [],
		format: "cjs",
	});

	if (watch) {
		await ctx.watch();
		await serverCtx.watch();
	} else {
		await ctx.rebuild();
		await serverCtx.rebuild();
		await ctx.dispose();
		await serverCtx.dispose();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
