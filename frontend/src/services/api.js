// js/services/api.js
import { API_STORAGE_KEY, DEFAULT_LOCAL_API } from '../config/constants.js';
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
  currentToken = token;
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
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text);
    return extractApiErrorMessage(payload, fallback);
  } catch {
    return text;
  }
}

export async function fetchJsonSilent(path, opts = {}) {
  const headers = opts.headers || {};
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
  if (opts.json) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
    mode: 'cors'
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

export async function api(path, opts = {}) {
  if (!path.startsWith('/')) {
    console.error('❌ Path debe comenzar con /');
    throw new Error('Path inválido');
  }

  const headers = opts.headers || {};
  const requestToken = currentToken;
  if (requestToken) headers['Authorization'] = `Bearer ${requestToken}`;
  if (opts.json) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers,
      credentials: 'include',
      mode: 'cors'
    });

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

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      console.error('Error parseando respuesta:', e);
      throw new Error('Respuesta inválida del servidor');
    }

    if (!res.ok) {
      const errorMsg = extractApiErrorMessage(data, `Error ${res.status}`);
      console.error(`❌ API ${res.status}:`, errorMsg);
      throw new Error(errorMsg);
    }

    return data;
  } catch (error) {
    if (error?.code === 'STALE_AUTH_REQUEST' || error?.code === 'NO_AUTH') {
      throw error;
    }
    console.error('❌ API Error:', error.message);
    showAlert(error.message, 'error');
    throw error;
  }
}
