const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost'

export function getStoredToken() {
  return localStorage.getItem('kanban_token')
}

export function setStoredToken(token) {
  localStorage.setItem('kanban_token', token)
}

export function clearStoredToken() {
  localStorage.removeItem('kanban_token')
}

export async function apiRequest(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (response.status === 204) {
    return null
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const validationMessages = payload?.errors
      ? Object.values(payload.errors).flat().join(' ')
      : ''
    const message = validationMessages || payload?.message || 'Request failed.'
    throw new Error(message)
  }

  return payload
}