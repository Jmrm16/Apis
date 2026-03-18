interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export class ApiError extends Error {
  constructor(message: string, readonly statusCode = 500) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    signal,
  })

  if (!response.ok) {
    let message = 'La API externa respondio con un error.'

    try {
      const payload = (await response.json()) as Partial<{ message: string }>
      if (payload.message) {
        message = payload.message
      }
    } catch {
      message = response.statusText || message
    }

    throw new ApiError(message, response.status)
  }

  const payload = (await response.json()) as ApiEnvelope<T>

  if (!payload.success) {
    throw new ApiError('La API externa respondio sin datos validos.', 502)
  }

  return payload.data
}
