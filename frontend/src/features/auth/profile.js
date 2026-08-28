// src/features/auth/profile.js
import { state } from '../../state/state.js';
import { API, getApiToken, setApiToken } from '../../services/api.js';
import {
  DEFAULT_APP_SETTINGS,
  PROFILE_AVATAR_CHOICES,
  START_VIEW_CONFIG,
  SETTINGS_OPEN_PANEL_KEY
} from '../../config/constants.js';
import { $ } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import {
  normalizeAppSettings,
  normalizeAccentColor,
  saveStoredAppSettings,
  clearPersistedAuthToken
} from '../../services/storage.js';

let appSettingsSyncTimer = null;
let supportsRemoteSettingsApi = true;

export function getAccentCssTokens(color) {
  const accent = normalizeAccentColor(color, DEFAULT_APP_SETTINGS.accentColor);
  const cleanHex = accent.replace('#', '');
  const r = Number.parseInt(cleanHex.slice(0, 2), 16) || 99;
  const g = Number.parseInt(cleanHex.slice(2, 4), 16) || 102;
  const b = Number.parseInt(cleanHex.slice(4, 6), 16) || 241;

  const dark = `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel * 0.78)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

  return {
    accent,
    dark,
    glow: `rgba(${r}, ${g}, ${b}, 0.32)`
  };
}

export function updateAppSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  saveStoredAppSettings(state.settings);
  applyAppSettings();
  scheduleRemoteSettingsSync();
}

export function getSettingsPayloadForApi() {
  const normalized = normalizeAppSettings(state.settings);
  return {
    default_view: normalized.defaultView,
    reduce_motion: normalized.reduceMotion,
    profile_avatar: normalized.profileAvatar,
    accent_color: normalized.accentColor
  };
}

export async function fetchRemoteAppSettings() {
  const token = getApiToken();
  if (!token || !supportsRemoteSettingsApi) return false;

  try {
    const res = await fetch(`${API}/me/settings`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      mode: 'cors'
    });

    if (res.status === 404) {
      supportsRemoteSettingsApi = false;
      return false;
    }
    if (!res.ok) return false;
    const remoteSettings = await res.json().catch(() => null);
    state.settings = normalizeAppSettings(remoteSettings || {});
    saveStoredAppSettings(state.settings);
    applyAppSettings();
    return true;
  } catch {
    return false;
  }
}

export async function persistRemoteAppSettings() {
  const token = getApiToken();
  if (!token || !supportsRemoteSettingsApi) return false;
  try {
    const res = await fetch(`${API}/me/settings`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      mode: 'cors',
      body: JSON.stringify(getSettingsPayloadForApi())
    });
    if (res.status === 404) {
      supportsRemoteSettingsApi = false;
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

export function scheduleRemoteSettingsSync() {
  const token = getApiToken();
  if (!token) return;
  if (appSettingsSyncTimer) clearTimeout(appSettingsSyncTimer);
  appSettingsSyncTimer = setTimeout(() => {
    appSettingsSyncTimer = null;
    persistRemoteAppSettings();
  }, 300);
}

export function flushRemoteSettingsSync() {
  const token = getApiToken();
  if (!token || !supportsRemoteSettingsApi) return;
  if (appSettingsSyncTimer) {
    clearTimeout(appSettingsSyncTimer);
    appSettingsSyncTimer = null;
  }
  persistRemoteAppSettings();
}

export function applyAppSettings() {
  const root = document.documentElement;
  const accentTokens = getAccentCssTokens(state.settings?.accentColor);

  root.style.setProperty('--accent', accentTokens.accent);
  root.style.setProperty('--accent-dark', accentTokens.dark);
  root.style.setProperty('--accent-glow', accentTokens.glow);

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', accentTokens.accent);

  document.body.classList.toggle(
    'reduced-motion',
    Boolean(state.settings?.reduceMotion)
  );
  syncAppSettingsControls();
  renderProfileIdentity();
  renderProfileAvatarChoices();
}

export function syncAppSettingsControls() {
  const defaultView = $('settingDefaultView');
  const reduceMotion = $('settingReduceMotion');
  const accentColor = $('settingAccentColor');

  if (defaultView) {
    defaultView.value = START_VIEW_CONFIG[state.settings?.defaultView]
      ? state.settings.defaultView
      : DEFAULT_APP_SETTINGS.defaultView;
  }
  if (reduceMotion) {
    reduceMotion.checked = Boolean(state.settings?.reduceMotion);
  }
  if (accentColor) {
    accentColor.value = normalizeAccentColor(
      state.settings?.accentColor,
      DEFAULT_APP_SETTINGS.accentColor
    );
  }
}

export function getUserEmail() {
  return String(state.user?.email || '').trim();
}

export function getFallbackInitial() {
  const email = getUserEmail();
  return email ? email.charAt(0).toUpperCase() : 'E';
}

export function getActiveAvatarSymbol() {
  const chosen = state.settings?.profileAvatar || 'auto';
  return chosen === 'auto' ? getFallbackInitial() : chosen;
}

export function renderProfileIdentity() {
  const topAvatar = $('topAvatar');
  const currentDate = $('currentDate');
  const profileAvatarPreview = $('profileAvatarPreview');
  const profileEmail = $('profileEmail');
  const avatarSymbol = getActiveAvatarSymbol();
  const email = getUserEmail();

  if (topAvatar) topAvatar.textContent = avatarSymbol;
  if (profileAvatarPreview) profileAvatarPreview.textContent = avatarSymbol;
  if (currentDate) currentDate.textContent = email || 'Finance';
  if (profileEmail) profileEmail.textContent = email || 'Sin sesión activa';
}

export function renderProfileAvatarChoices() {
  const container = $('profileAvatarChoices');
  if (!container) return;
  const selected = state.settings?.profileAvatar || 'auto';

  container.innerHTML = PROFILE_AVATAR_CHOICES.map((choice) => {
    const active = choice === selected ? ' is-active' : '';
    const icon = choice === 'auto' ? getFallbackInitial() : choice;
    const label = choice === 'auto' ? 'Auto' : choice;
    return `<button type="button" class="avatar-choice-btn${active}" data-avatar-choice="${choice}" title="${label}">${icon}</button>`;
  }).join('');
}

export function isStrongPassword(value) {
  if (!value || value.length < 8) return false;
  const hasUppercase = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  return hasUppercase && hasNumber;
}

export function getPasswordStrength(value) {
  const input = String(value || '');
  if (!input) return { label: '-', className: '' };

  let score = 0;
  if (input.length >= 8) score += 1;
  if (/[A-Z]/.test(input)) score += 1;
  if (/\d/.test(input)) score += 1;
  if (/[^A-Za-z0-9]/.test(input)) score += 1;

  if (score <= 1) return { label: 'baja', className: 'is-low' };
  if (score <= 3) return { label: 'media', className: 'is-medium' };
  return { label: 'alta', className: 'is-high' };
}

export function updateProfilePasswordFormState() {
  const currentField = $('profileCurrentPassword');
  const nextField = $('profileNextPassword');
  const confirmField = $('profileConfirmPassword');
  const currentPassword = currentField?.value || '';
  const nextPassword = nextField?.value || '';
  const confirmPassword = confirmField?.value || '';
  const submitBtn = $('btnProfileChangePassword');
  const hint = $('profilePasswordHint');
  const strength = $('profilePasswordStrength');

  const hasCurrent = currentPassword.length > 0;
  const strongEnough = isStrongPassword(nextPassword);
  const matches = nextPassword.length > 0 && nextPassword === confirmPassword;
  const canSubmit = hasCurrent && strongEnough && matches;

  if (strength) {
    const level = getPasswordStrength(nextPassword);
    strength.textContent = `Seguridad: ${level.label}`;
    strength.classList.remove('is-low', 'is-medium', 'is-high');
    if (level.className) strength.classList.add(level.className);
  }
  if (submitBtn && submitBtn.textContent !== 'Actualizando...') {
    submitBtn.disabled = !canSubmit;
  }
  if (hint) {
    if (!nextPassword && !confirmPassword) {
      hint.textContent =
        'Mínimo 8 caracteres, una mayúscula, un número y que coincidan.';
      hint.classList.remove('is-error', 'is-ok');
      return;
    }
    if (!strongEnough) {
      hint.textContent =
        'La nueva contraseña debe tener mínimo 8 caracteres, una mayúscula y un número.';
      hint.classList.add('is-error');
      hint.classList.remove('is-ok');
      return;
    }
    if (!matches) {
      hint.textContent = 'La confirmación no coincide con la nueva contraseña.';
      hint.classList.add('is-error');
      hint.classList.remove('is-ok');
      return;
    }
    hint.textContent = 'Contraseña válida. Puedes actualizarla.';
    hint.classList.remove('is-error');
    hint.classList.add('is-ok');
  }
}

export function clearProfilePasswordForm(resetShowPasswords = false) {
  const current = $('profileCurrentPassword');
  const next = $('profileNextPassword');
  const confirm = $('profileConfirmPassword');
  const show = $('profileShowPasswords');
  const capsHint = $('profileCapsLockHint');

  if (current) current.value = '';
  if (next) next.value = '';
  if (confirm) confirm.value = '';

  if (show && resetShowPasswords) show.checked = false;
  if (capsHint) capsHint.style.display = 'none';

  const nextType = show?.checked ? 'text' : 'password';
  if (current) current.type = nextType;
  if (next) next.type = nextType;
  if (confirm) confirm.type = nextType;

  updateProfilePasswordFormState();
}

export async function changePasswordFromProfile() {
  const currentField = $('profileCurrentPassword');
  const nextField = $('profileNextPassword');
  const confirmField = $('profileConfirmPassword');
  const currentPassword = currentField?.value || '';
  const nextPassword = nextField?.value || '';
  const confirmPassword = confirmField?.value || '';
  const submitBtn = $('btnProfileChangePassword');
  const clearBtn = $('btnProfileClearPasswords');
  const passwordBlock = $('profilePasswordBlock');
  const token = getApiToken();

  const setSubmittingState = (isSubmitting) => {
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting
      ? 'Actualizando...'
      : 'Actualizar contraseña';
    if (clearBtn) clearBtn.disabled = isSubmitting;
    if (passwordBlock)
      passwordBlock.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
  };

  if (!currentPassword || !nextPassword || !confirmPassword) {
    showAlert('Rellena contraseña actual, nueva y confirmación', 'error');
    return;
  }
  if (nextPassword !== confirmPassword) {
    showAlert('La confirmación no coincide con la nueva contraseña', 'error');
    return;
  }
  if (!isStrongPassword(nextPassword)) {
    showAlert(
      'La nueva contraseña debe tener mínimo 8 caracteres, una mayúscula y un número',
      'error'
    );
    return;
  }

  try {
    setSubmittingState(true);
    const res = await fetch(`${API}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      credentials: 'include',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: nextPassword
      })
    });

    if (res.status === 404) {
      showAlert('Cambio de contraseña no implementado en backend', 'info');
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || 'No se pudo cambiar la contraseña');
    }
    clearProfilePasswordForm();
    showAlert('Contraseña actualizada con éxito', 'info');
  } catch (err) {
    showAlert(err?.message || 'Error actualizando contraseña', 'error');
  } finally {
    setSubmittingState(false);
    updateProfilePasswordFormState();
  }
}

export function initSettingsAccordion() {
  const accordion = $('settingsAccordion');
  if (!accordion) return;

  const panels = Array.from(accordion.querySelectorAll('.settings-panel'));
  if (!panels.length) return;

  const storedOpenPanelRaw = localStorage.getItem(SETTINGS_OPEN_PANEL_KEY);
  const storedOpenPanel =
    storedOpenPanelRaw === 'general' ? 'profile' : storedOpenPanelRaw;
  const panelToRestore = storedOpenPanel
    ? panels.find((panel) => panel.dataset.settingsPanel === storedOpenPanel)
    : null;

  if (panelToRestore) {
    panels.forEach((panel) => {
      panel.open = panel === panelToRestore;
    });
  }

  panels.forEach((panel) => {
    panel.addEventListener('toggle', () => {
      if (panel.open) {
        panels.forEach((other) => {
          if (other !== panel) other.open = false;
        });
        if (panel.dataset.settingsPanel) {
          localStorage.setItem(
            SETTINGS_OPEN_PANEL_KEY,
            panel.dataset.settingsPanel
          );
        }
        return;
      }
      const hasOpenPanel = panels.some((item) => item.open);
      if (!hasOpenPanel) localStorage.removeItem(SETTINGS_OPEN_PANEL_KEY);
    });
  });
}

export function logout() {
  flushRemoteSettingsSync();
  clearPersistedAuthToken();
  if (appSettingsSyncTimer) {
    clearTimeout(appSettingsSyncTimer);
    appSettingsSyncTimer = null;
  }
  setApiToken('');
  state.user = null;
  renderProfileIdentity();
  globalThis.switchView?.('login', 'Inicio de sesión');
}

export function initProfileListeners() {
  const btnProfileChangePassword = $('btnProfileChangePassword');
  const btnProfileClearPasswords = $('btnProfileClearPasswords');
  const profileCurrentPassword = $('profileCurrentPassword');
  const profileNextPassword = $('profileNextPassword');
  const profileConfirmPassword = $('profileConfirmPassword');
  const profileShowPasswords = $('profileShowPasswords');
  const profileAvatarChoices = $('profileAvatarChoices');
  const settingDefaultView = $('settingDefaultView');
  const settingReduceMotion = $('settingReduceMotion');
  const settingAccentColor = $('settingAccentColor');
  const btnLogoutFromSettings = $('btnLogoutFromSettings');
  const capsLockHint = $('profileCapsLockHint');

  if (profileAvatarChoices) {
    profileAvatarChoices.addEventListener('click', (event) => {
      const button = event.target.closest('[data-avatar-choice]');
      if (!button) return;
      updateAppSetting('profileAvatar', button.dataset.avatarChoice || 'auto');
    });
  }
  if (btnProfileChangePassword) {
    btnProfileChangePassword.addEventListener(
      'click',
      changePasswordFromProfile
    );
  }
  if (btnProfileClearPasswords) {
    btnProfileClearPasswords.addEventListener('click', () =>
      clearProfilePasswordForm(true)
    );
  }

  // Detección de Bloq Mayús y envío con Enter
  const passwordInputs = [
    profileCurrentPassword,
    profileNextPassword,
    profileConfirmPassword
  ].filter(Boolean);

  passwordInputs.forEach((input) => {
    input.addEventListener('input', updateProfilePasswordFormState);

    input.addEventListener('keyup', (e) => {
      if (capsLockHint && typeof e.getModifierState === 'function') {
        const isCaps = e.getModifierState('CapsLock');
        capsLockHint.style.display = isCaps ? 'block' : 'none';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const submitBtn = $('btnProfileChangePassword');
        if (submitBtn && !submitBtn.disabled) {
          changePasswordFromProfile();
        }
      }
    });
  });

  if (profileShowPasswords) {
    profileShowPasswords.addEventListener('change', () => {
      const nextType = profileShowPasswords.checked ? 'text' : 'password';
      if (profileCurrentPassword) profileCurrentPassword.type = nextType;
      if (profileNextPassword) profileNextPassword.type = nextType;
      if (profileConfirmPassword) profileConfirmPassword.type = nextType;
    });
  }

  if (settingDefaultView) {
    settingDefaultView.addEventListener('change', () => {
      updateAppSetting(
        'defaultView',
        settingDefaultView.value || DEFAULT_APP_SETTINGS.defaultView
      );
      showAlert('Vista inicial guardada', 'info');
    });
  }
  if (settingReduceMotion) {
    settingReduceMotion.addEventListener('change', () => {
      updateAppSetting('reduceMotion', settingReduceMotion.checked);
    });
  }
  if (settingAccentColor) {
    settingAccentColor.addEventListener('change', () => {
      updateAppSetting(
        'accentColor',
        normalizeAccentColor(settingAccentColor.value)
      );
      showAlert('Color de la app guardado', 'info');
    });
  }
  if (btnLogoutFromSettings) {
    btnLogoutFromSettings.addEventListener('click', () => {
      if (confirm('¿Seguro que quieres cerrar sesión?')) logout();
    });
  }
}
