import { config } from '../../config.js'
import { ProviderError, type ProviderCode } from './errors.js'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface ProviderStatus {
  session: boolean
  sessionAgeMs: number | null
  operacionPresent: boolean
  blocked: boolean
  blockCode: ProviderCode | null
  retryAfterMs: number
}

/**
 * Acceso verificado el 2026-10-19:
 * - Hace falta la cookie PHPSESSID que entrega GET /usuario/urbano.php?conf=cbaciudad.
 *   Sin cookie, consultacocheporruta responde HTTP 408.
 * - `operacion` viene embebido en el HTML y cambia en cada carga. Se reenvía como
 *   string si aparece, pero la consulta GPS también respondió sin ese campo.
 * - El header X-Device-FlakerParam (fp.js) no fue necesario para líneas, trazas ni GPS.
 */
export class MicronautaClient {
  private cookie: string | null = null
  private operacion: string | null = null
  private sessionAt = 0
  private blockedUntil = 0
  private blockCode: ProviderCode | null = null
  private inflight = 0
  private readonly waiters: Array<() => void> = []
  private sessionQueue: Promise<void> = Promise.resolve()
  private interactiveDepth = 0

  /** Una búsqueda de viaje tiene prioridad sobre el barrido de circulación. */
  holdInteractive(): () => void {
    this.interactiveDepth += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.interactiveDepth = Math.max(0, this.interactiveDepth - 1)
    }
  }

  interactivePending(): boolean {
    return this.interactiveDepth > 0
  }

  status(): ProviderStatus {
    const retryAfterMs = Math.max(0, this.blockedUntil - Date.now())
    return {
      session: Boolean(this.cookie),
      sessionAgeMs: this.sessionAt ? Date.now() - this.sessionAt : null,
      operacionPresent: Boolean(this.operacion),
      blocked: retryAfterMs > 0,
      blockCode: retryAfterMs > 0 ? this.blockCode : null,
      retryAfterMs,
    }
  }

  async lines(): Promise<unknown> {
    return this.post(`${config.micronautaBaseUrl}/usuario/urbano2_cmd.php`, {
      cmd: 'lineasyrutas',
      conf: config.micronautaConf,
    })
  }

  async trace(routeId: string, clientId: string): Promise<unknown> {
    return this.post(`${config.micronautaBaseUrl}/usuario/urbano2_cmd.php?cmd=seleccionatraza`, {
      ruta: routeId,
      cliente_id: clientId,
      conf: config.micronautaConf,
    })
  }

  /** Abre una sesión nueva cuando la actual deja de responder al GPS. */
  refreshSession(): Promise<void> {
    return this.ensureSession(true)
  }

  async vehicles(routeId: string, clientId: string, stopCode = '', timeoutMs = config.upstreamTimeoutMs): Promise<unknown> {
    await this.ensureSession()
    const params: Record<string, string> = {
      ruta: routeId,
      coche: '0',
      cliente: clientId,
      parada_seleccionada: stopCode,
      conf: config.micronautaConf,
    }
    return this.post(
      `${config.micronautaBaseUrl}/usuario/urbano2_cmd.php?cmd=consultacocheporruta`,
      params,
      0,
      timeoutMs,
    )
  }

  /**
   * Búsqueda origen-destino. `continua` avanza etapas (directos → ampliar → combinaciones).
   * `resultados` evita devolver opciones ya vistas.
   */
  async searchTrip(input: {
    fromLat: number
    fromLon: number
    toLat: number
    toLon: number
    continua: number
    resultados: unknown
    userLat?: number
    userLon?: number
  }): Promise<unknown> {
    return this.post(`${config.micronautaBaseUrl}/usuario/urbano2_cmd.php?cmd=buscarlineas`, {
      lat1: String(input.fromLat),
      lon1: String(input.fromLon),
      lat2: String(input.toLat),
      lon2: String(input.toLon),
      usr_lat: String(input.userLat ?? 0),
      usr_lon: String(input.userLon ?? 0),
      resultados: JSON.stringify(input.resultados ?? []),
      continua: String(input.continua),
      email: '',
      userkey: '',
      conf: config.micronautaConf,
    })
  }

  async searchAddress(query: string): Promise<unknown> {
    await this.ensureSession()
    const url = `${config.micronautaBaseUrl}/usuario/urbano2_cmd.php?a=&cmd=buscar_direccion&q=${encodeURIComponent(query)}&conf=${encodeURIComponent(config.micronautaConf)}`
    const response = await this.request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Cookie: this.cookie ?? '',
      },
    })
    this.assertStatus(response)
    const body = await response.text()
    if (!body.trim()) return []
    try {
      return JSON.parse(body) as unknown
    } catch {
      throw new ProviderError('provider_unavailable', 'Micronauta devolvió un cuerpo que no es JSON.')
    }
  }

  private async ensureSession(force = false): Promise<void> {
    this.assertNotBlocked()
    this.sessionQueue = this.sessionQueue
      .catch(() => undefined)
      .then(async () => {
        const fresh = this.cookie !== null && Date.now() - this.sessionAt < config.sessionTtlMs
        if (!force && fresh) return
        await this.openSession()
      })
    await this.sessionQueue
  }

  private async openSession(): Promise<void> {
    const url = `${config.micronautaBaseUrl}/usuario/urbano.php?conf=${encodeURIComponent(config.micronautaConf)}`
    const response = await this.request(url, { method: 'GET' })
    this.assertStatus(response)
    const html = await response.text()
    const jar = readCookies(response)
    if (!jar.some((item) => item.startsWith('PHPSESSID='))) {
      throw new ProviderError('provider_unavailable', 'Micronauta no entregó una cookie de sesión.')
    }
    this.cookie = jar.join('; ')
    const match = html.match(/operacion:\s*'(\d+)'/)
    this.operacion = match?.[1] ?? null
    this.sessionAt = Date.now()
  }

  private async post(
    url: string,
    params: Record<string, string>,
    attempt = 0,
    timeoutMs = config.upstreamTimeoutMs,
  ): Promise<unknown> {
    this.assertNotBlocked()
    await this.ensureSession()
    const response = await this.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, text/plain, */*',
        Cookie: this.cookie ?? '',
      },
      body: new URLSearchParams(params),
    }, timeoutMs)

    if ((response.status === 403 || response.status === 429) && attempt < 1) {
      this.trip(response.status)
    }
    if (response.status === 408 && attempt < 1) {
      await this.ensureSession(true)
      return this.post(url, params, attempt + 1, timeoutMs)
    }
    this.assertStatus(response)

    const body = await response.text()
    if (!body.trim()) {
      throw new ProviderError('provider_unavailable', 'Micronauta devolvió una respuesta vacía.')
    }
    try {
      return JSON.parse(body) as unknown
    } catch {
      throw new ProviderError('provider_unavailable', 'Micronauta devolvió un cuerpo que no es JSON.')
    }
  }

  private async request(url: string, init: RequestInit, timeoutMs = config.upstreamTimeoutMs): Promise<Response> {
    await this.acquire()
    try {
      return await fetch(url, {
        ...init,
        headers: {
          ...browserHeaders(),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new ProviderError('provider_timeout', 'Micronauta no respondió a tiempo.')
      }
      throw new ProviderError('provider_unavailable', 'No se pudo conectar con Micronauta.')
    } finally {
      this.release()
    }
  }

  /** Como máximo tres consultas a la vez: más que eso, el GPS deja de contestar. */
  private acquire(): Promise<void> {
    if (this.inflight < 3) {
      this.inflight += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.inflight += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.inflight = Math.max(0, this.inflight - 1)
    const next = this.waiters.shift()
    if (next) next()
  }

  private assertStatus(response: Response): void {
    if (response.status === 403 || response.status === 429) this.trip(response.status)
    if (response.status === 408) {
      throw new ProviderError('provider_timeout', 'Micronauta cerró la sesión o no respondió (HTTP 408).')
    }
    if (!response.ok) {
      throw new ProviderError('provider_unavailable', `Micronauta respondió HTTP ${response.status}.`)
    }
  }

  private assertNotBlocked(): void {
    const retryAfterMs = this.blockedUntil - Date.now()
    if (retryAfterMs > 0) {
      const code = this.blockCode ?? 'provider_blocked'
      const message = code === 'provider_rate_limited'
        ? 'Las consultas están en pausa porque Micronauta respondió 429.'
        : 'Las consultas están en pausa porque Micronauta respondió 403.'
      throw new ProviderError(code, message, retryAfterMs)
    }
  }

  private trip(status: 403 | 429): never {
    const code: ProviderCode = status === 429 ? 'provider_rate_limited' : 'provider_blocked'
    this.blockedUntil = Date.now() + config.providerCooldownMs
    this.blockCode = code
    this.cookie = null
    this.operacion = null
    const message = status === 429
      ? 'Micronauta respondió 429. Las consultas nuevas quedan en pausa.'
      : 'Micronauta respondió 403. Las consultas nuevas quedan en pausa.'
    throw new ProviderError(code, message, config.providerCooldownMs)
  }
}

function browserHeaders(): HeadersInit {
  return {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    Origin: config.micronautaBaseUrl,
    Referer: `${config.micronautaBaseUrl}/usuario/urbano.php?conf=${config.micronautaConf}`,
  }
}

function readCookies(response: Response): string[] {
  const extended = response.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = typeof extended.getSetCookie === 'function' ? extended.getSetCookie() : []
  return cookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
}
