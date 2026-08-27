// js/services/storage.js
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

export function isRememberDeviceEnabled() {
  return localStorage.getItem(REMEMBER_DEVICE_STORAGE_KEY) === '1';
}

export function setRememberDevicePreference(enabled) {
  if (enabled) {
    localStorage.setItem(REMEMBER_DEVICE_STORAGE_KEY, '1');
    return;
  }
  localStorage.removeItem(REMEMBER_DEVICE_STORAGE_KEY);
}

export function readStartupToken() {
  const remembered = isRememberDeviceEnabled();
  const sourceStorage = remembered ? localStorage : sessionStorage;
  const staleStorage = remembered ? sessionStorage : localStorage;
  staleStorage.removeItem(TOKEN_STORAGE_KEY);
  return String(sourceStorage.getItem(TOKEN_STORAGE_KEY) || '').trim();
}

export function persistAuthToken(nextToken, rememberDevice = false) {
  const normalized = String(nextToken || '').trim();
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);

  if (!normalized) {
    setRememberDevicePreference(false);
    return;
  }

  setRememberDevicePreference(Boolean(rememberDevice));
  if (rememberDevice) {
    localStorage.setItem(TOKEN_STORAGE_KEY, normalized);
    return;
  }
  sessionStorage.setItem(TOKEN_STORAGE_KEY, normalized);
}

export function clearPersistedAuthToken() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function normalizeAccentColor(
  value,
  fallback = DEFAULT_APP_SETTINGS.accentColor
) {
  const input = String(value || '').trim();
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
    defaultView: localStorage.getItem(SETTINGS_DEFAULT_VIEW_KEY),
    reduceMotion: localStorage.getItem(SETTINGS_REDUCE_MOTION_KEY) === '1',
    profileAvatar: localStorage.getItem(SETTINGS_PROFILE_AVATAR_KEY),
    accentColor: localStorage.getItem(SETTINGS_ACCENT_COLOR_KEY)
  };
  return normalizeAppSettings(stored);
}

export function saveStoredAppSettings(settings) {
  localStorage.setItem(
    SETTINGS_DEFAULT_VIEW_KEY,
    settings.defaultView || DEFAULT_APP_SETTINGS.defaultView
  );
  localStorage.setItem(
    SETTINGS_REDUCE_MOTION_KEY,
    settings.reduceMotion ? '1' : '0'
  );
  localStorage.setItem(
    SETTINGS_PROFILE_AVATAR_KEY,
    settings.profileAvatar || DEFAULT_APP_SETTINGS.profileAvatar
  );
  localStorage.setItem(
    SETTINGS_ACCENT_COLOR_KEY,
    normalizeAccentColor(settings.accentColor, DEFAULT_APP_SETTINGS.accentColor)
  );
}
