// src/services/storage.js
import {
  TOKEN_STORAGE_KEY,
  REMEMBER_DEVICE_STORAGE_KEY,
  SETTINGS_DEFAULT_VIEW_KEY,
  SETTINGS_REDUCE_MOTION_KEY,
  SETTINGS_PROFILE_AVATAR_KEY,
  SETTINGS_ACCENT_COLOR_KEY,
  DEFAULT_APP_SETTINGS,
  START_VIEW_CONFIG,
  PROFILE_AVATAR_CHOICES
} from '../config/constants.js';

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {}
}

function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {}
}

export function isRememberDeviceEnabled() {
  return safeStorageGet(localStorage, REMEMBER_DEVICE_STORAGE_KEY) === '1';
}

export function setRememberDevicePreference(enabled) {
  if (enabled) {
    safeStorageSet(localStorage, REMEMBER_DEVICE_STORAGE_KEY, '1');
    return;
  }
  safeStorageRemove(localStorage, REMEMBER_DEVICE_STORAGE_KEY);
}

export function readStartupToken() {
  const remembered = isRememberDeviceEnabled();
  const sourceStorage = remembered ? localStorage : sessionStorage;
  const staleStorage = remembered ? sessionStorage : localStorage;

  safeStorageRemove(staleStorage, TOKEN_STORAGE_KEY);

  let token = safeStorageGet(sourceStorage, TOKEN_STORAGE_KEY);

  // Migración retrocompatible por si existía bajo la clave simple 'token'
  if (!token) {
    const legacyToken = safeStorageGet(sourceStorage, 'token');
    if (legacyToken) {
      token = legacyToken;
      safeStorageSet(sourceStorage, TOKEN_STORAGE_KEY, legacyToken);
      safeStorageRemove(sourceStorage, 'token');
    }
  }

  return String(token || '').trim();
}

export function persistAuthToken(nextToken, rememberDevice = false) {
  const normalized = String(nextToken || '').trim();

  safeStorageRemove(localStorage, TOKEN_STORAGE_KEY);
  safeStorageRemove(sessionStorage, TOKEN_STORAGE_KEY);
  safeStorageRemove(localStorage, 'token');
  safeStorageRemove(sessionStorage, 'token');

  if (!normalized) {
    setRememberDevicePreference(false);
    return;
  }

  setRememberDevicePreference(Boolean(rememberDevice));
  if (rememberDevice) {
    safeStorageSet(localStorage, TOKEN_STORAGE_KEY, normalized);
    return;
  }
  safeStorageSet(sessionStorage, TOKEN_STORAGE_KEY, normalized);
}

export function clearPersistedAuthToken() {
  safeStorageRemove(sessionStorage, TOKEN_STORAGE_KEY);
  safeStorageRemove(localStorage, TOKEN_STORAGE_KEY);
  safeStorageRemove(sessionStorage, 'token');
  safeStorageRemove(localStorage, 'token');
}

export function normalizeAccentColor(
  value,
  fallback = DEFAULT_APP_SETTINGS.accentColor
) {
  const input = String(value || '').trim();

  // Soporte para #RGB (3 caracteres) expandido a #RRGGBB
  if (/^#[0-9a-f]{3}$/i.test(input)) {
    const r = input[1];
    const g = input[2];
    const b = input[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : fallback;
}

export function normalizeAppSettings(rawSettings = {}) {
  const source =
    rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const defaultViewCandidate = String(
    source.defaultView || source.default_view || ''
  ).trim();
  const profileAvatarCandidate = String(
    source.profileAvatar || source.profile_avatar || ''
  ).trim();
  const accentColorCandidate = String(
    source.accentColor || source.accent_color || ''
  ).trim();

  return {
    defaultView: START_VIEW_CONFIG[defaultViewCandidate]
      ? defaultViewCandidate
      : DEFAULT_APP_SETTINGS.defaultView,
    reduceMotion: Boolean(
      source.reduceMotion ??
      source.reduce_motion ??
      DEFAULT_APP_SETTINGS.reduceMotion
    ),
    profileAvatar: PROFILE_AVATAR_CHOICES.includes(profileAvatarCandidate)
      ? profileAvatarCandidate
      : DEFAULT_APP_SETTINGS.profileAvatar,
    accentColor: normalizeAccentColor(
      accentColorCandidate,
      DEFAULT_APP_SETTINGS.accentColor
    )
  };
}

export function loadStoredAppSettings() {
  const stored = {
    defaultView: safeStorageGet(localStorage, SETTINGS_DEFAULT_VIEW_KEY),
    reduceMotion:
      safeStorageGet(localStorage, SETTINGS_REDUCE_MOTION_KEY) === '1',
    profileAvatar: safeStorageGet(localStorage, SETTINGS_PROFILE_AVATAR_KEY),
    accentColor: safeStorageGet(localStorage, SETTINGS_ACCENT_COLOR_KEY)
  };
  return normalizeAppSettings(stored);
}

export function saveStoredAppSettings(settings) {
  safeStorageSet(
    localStorage,
    SETTINGS_DEFAULT_VIEW_KEY,
    settings.defaultView || DEFAULT_APP_SETTINGS.defaultView
  );
  safeStorageSet(
    localStorage,
    SETTINGS_REDUCE_MOTION_KEY,
    settings.reduceMotion ? '1' : '0'
  );
  safeStorageSet(
    localStorage,
    SETTINGS_PROFILE_AVATAR_KEY,
    settings.profileAvatar || DEFAULT_APP_SETTINGS.profileAvatar
  );
  safeStorageSet(
    localStorage,
    SETTINGS_ACCENT_COLOR_KEY,
    normalizeAccentColor(settings.accentColor, DEFAULT_APP_SETTINGS.accentColor)
  );
}
