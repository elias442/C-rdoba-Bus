export type ProviderCode =
  | 'provider_blocked'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'

export class ProviderError extends Error {
  readonly code: ProviderCode
  readonly retryAfterMs: number | null

  constructor(code: ProviderCode, message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}
