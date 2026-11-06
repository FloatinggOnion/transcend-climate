/** Failure from an LLM provider, with a coarse code the orchestrator can act on. */
export class NlpProviderError extends Error {
  /** @param {'auth'|'rate_limited'|'bad_request'|'network'|'upstream'|'timeout'|'unknown'} code */
  constructor(code, message, status = null) {
    super(message);
    this.name = 'NlpProviderError';
    this.code = code;
    this.status = status;
  }
}
