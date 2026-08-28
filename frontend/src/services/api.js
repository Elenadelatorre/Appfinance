// src/services/api.js
import {
  API_STORAGE_KEY,
  DEFAULT_LOCAL_API,
  API_TIMEOUT_MS
} from '../config/constants.js';
import { readStartupToken } from './storage.js';
import { showAlert } from '../utils/toast.js';

function normalizeApiBase(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  return cleaned.replace(/\/+$/, '');
}

export function resolveApiBase() {
  const params = new URLSearchParams(globalThis.location.search);
  const fromQuery = normalizeApiBase(params.get('api'));
  if (fromQuery) {
    localStorage.setItem(API_STORAGE_KEY, fromQuery);
    return fromQuery;
  }

  const fromStorage = normalizeApiBase(localStorage.getItem(API_STORAGE_KEY));
  if (fromStorage) return fromStorage;

  const fromMeta = normalizeApiBase(
    document
      .querySelector('meta[name="finance-api-base"]')
      ?.getAttribute('content')
  );
  if (fromMeta) return fromMeta;

  const host = globalThis.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  return isLocal ? DEFAULT_LOCAL_API : '';
}

export const API = resolveApiBase();
let currentToken = readStartupToken();
let onSessionExpiredCallback = null;

export function setApiToken(token) {
  currentToken = token || '';
}

export function getApiToken() {
  return currentToken;
}

export function setSessionExpiredHandler(handler) {
  onSessionExpiredCallback = handler;
}

export function extractApiErrorMessage(
  payload,
  fallback = 'Error en la petición'
) {
  if (!payload) return fallback;

  const details = payload.detail;
  if (typeof details === 'string' && details.trim()) return details.trim();

  if (Array.isArray(details)) {
    const lines = details
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const loc = Array.isArray(item.loc)
          ? item.loc.filter((p) => String(p) !== 'body').join('.')
          : '';
        const msg = item.msg || item.message || '';
        if (!msg) return '';
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (lines.length) return lines.join(' | ');
  }

  const extraErrors = payload.errors;
  if (Array.isArray(extraErrors) && extraErrors.length) {
    return extraErrors
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join(' | ');
  }

  if (details && typeof details === 'object') {
    if (typeof details.message === 'string') return details.message;
    if (typeof details.msg === 'string') return details.msg;
    return JSON.stringify(details);
  }

  return fallback;
}

export async function readErrorMessage(response, fallback) {
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const payload = JSON.parse(text);
      return extractApiErrorMessage(payload, fallback);
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

export async function fetchJsonSilent(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  if (opts.json) headers['Content-Type'] = 'application/json';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      opts.timeoutMs || API_TIMEOUT_MS || 15000
    );

    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers,
      signal: opts.signal || controller.signal,
      credentials: 'include',
      mode: 'cors'
    });
    clearTimeout(timeout);

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err };
  }
}

export async function api(path, opts = {}) {
  if (!path.startsWith('/')) {
    throw new Error('Path inválido: debe comenzar con /');
  }

  const headers = { ...(opts.headers || {}) };
  const requestToken = currentToken;
  if (requestToken) headers['Authorization'] = `Bearer ${requestToken}`;
  if (opts.json) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs || API_TIMEOUT_MS || 15000
  );

  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers,
      signal: opts.signal || controller.signal,
      credentials: 'include',
      mode: 'cors'
    });
    clearTimeout(timeout);

    if (res.status === 401) {
      if (requestToken && requestToken !== currentToken) {
        const staleAuthError = new Error('Petición antigua ignorada');
        staleAuthError.code = 'STALE_AUTH_REQUEST';
        throw staleAuthError;
      }

      if (requestToken) {
        if (typeof onSessionExpiredCallback === 'function') {
          onSessionExpiredCallback();
        }
        const expiredErr = new Error(
          'Sesión caducada. Vuelve a iniciar sesión.'
        );
        expiredErr.code = 'SESSION_EXPIRED';
        throw expiredErr;
      }

      const noAuthErr = new Error('No autenticado');
      noAuthErr.code = 'NO_AUTH';
      throw noAuthErr;
    }

    if (res.status === 204) {
      return null;
    }

    const text = await res.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Respuesta inválida del servidor');
      }
    }

    if (!res.ok) {
      const errorMsg = extractApiErrorMessage(data, `Error ${res.status}`);
      throw new Error(errorMsg);
    }

    return data;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      const timeoutErr = new Error(
        'Tiempo de espera agotado al conectar con el servidor'
      );
      showAlert(timeoutErr.message, 'error');
      throw timeoutErr;
    }
    if (
      error?.code === 'STALE_AUTH_REQUEST' ||
      error?.code === 'NO_AUTH' ||
      error?.code === 'SESSION_EXPIRED'
    ) {
      throw error;
    }
    showAlert(error.message, 'error');
    throw error;
  }
}
