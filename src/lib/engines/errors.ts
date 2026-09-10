import "server-only";

/**
 * Internal engine-routing invariant failure.
 *
 * Thrown only when the engine layer itself is misconfigured: an unknown
 * conversion type, or a conversion whose only engine is unavailable. This is
 * a programmer error, never a user error. It must surface loudly — and were
 * it ever to reach the processing service, it would become a generic 500
 * INTERNAL_ERROR — rather than silently routing to an unintended engine.
 *
 * The router must never "recover" by guessing an engine.
 */
export class EngineRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineRoutingError";
  }
}
