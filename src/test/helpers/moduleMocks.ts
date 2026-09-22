import Module from "node:module";

/** Replace only host-provided modules while loading a fresh extension instance. */
export function loadWithMocks<T>(
	filename: string,
	mocks: Record<string, unknown>,
): T {
	const loader = Module as unknown as {
		_load: (name: string, ...args: unknown[]) => unknown;
	};
	const original = loader._load;
	loader._load = (name, ...args) => {
		if (Object.hasOwn(mocks, name)) return mocks[name];
		return original(name, ...args);
	};
	try {
		return require(filename) as T;
	} finally {
		loader._load = original;
	}
}
