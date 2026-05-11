const API_BASE = '/api';

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${API_BASE}${path}`, init);
}
