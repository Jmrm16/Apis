export class ApiError extends Error {
    statusCode;
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ApiError';
    }
}
export async function requestJson(baseUrl, path, signal, init) {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal,
    });
    if (!response.ok) {
        let message = 'La API externa respondio con un error.';
        try {
            const payload = (await response.json());
            if (payload.message) {
                message = payload.message;
            }
        }
        catch {
            message = response.statusText || message;
        }
        throw new ApiError(message, response.status);
    }
    const payload = (await response.json());
    if (!payload.success) {
        throw new ApiError('La API externa respondio sin datos validos.', 502);
    }
    return payload.data;
}
export async function requestText(url, signal, init) {
    const response = await fetch(url, {
        ...init,
        signal,
    });
    if (!response.ok) {
        throw new ApiError(response.statusText || 'La pagina externa respondio con un error.', response.status);
    }
    const bodyText = await response.text();
    return Object.assign(response, { bodyText });
}
