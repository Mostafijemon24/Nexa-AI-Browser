import { GATEWAY_ERROR_STATUS, gatewayErrorMessage, type GatewayErrorBody, type GatewayErrorCode } from '../../src/shared/ai-gateway'

/** A normalized, user-safe gateway error. `detail` is for server logs only. */
export class GatewayError extends Error {
  constructor(
    public code: GatewayErrorCode,
    public detail?: string,
    public retryAfterSeconds?: number
  ) {
    super(code)
  }

  get status(): number {
    return GATEWAY_ERROR_STATUS[this.code]
  }

  body(): GatewayErrorBody {
    return {
      error: {
        code: this.code,
        message: gatewayErrorMessage(this.code),
        ...(this.retryAfterSeconds != null ? { retryAfterSeconds: this.retryAfterSeconds } : {})
      }
    }
  }
}

export function asGatewayError(e: unknown): GatewayError {
  if (e instanceof GatewayError) return e
  return new GatewayError('AI_SERVICE_UNAVAILABLE', e instanceof Error ? e.message : 'unknown')
}
