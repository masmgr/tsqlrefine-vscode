/**
 * Raised when the tsqlrefine executable cannot be resolved or used.
 */
export class MissingTsqlRefineError extends Error {
	override readonly name = "MissingTsqlRefineError";
}
