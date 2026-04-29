/**
 * Finance App - API Client & Main Logic
 * Aplicación de gestión financiera personal
 */

const API_STORAGE_KEY = 'financeApiBaseUrl';
const DEFAULT_LOCAL_API = 'http://127.0.0.1:8001';

function normalizeApiBase(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  return cleaned.replace(/\/+$/, '');
}

function resolveApiBase() {
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

const API = resolveApiBase();
const TRANSACTIONS_PAGE_SIZE = 500;
const BUDGET_FILTER_STORAGE_KEY = 'budgetStatusFilter';
const HISTORY_PRESETS_STORAGE_KEY = 'financeApp.history.filterPresets';
const HISTORY_PRESET_RECENTS_STORAGE_KEY = 'financeApp.history.presetRecents';
const HISTORY_LAST_STATE_STORAGE_KEY = 'financeApp.history.lastState';
const HISTORY_FAVORITE_PRESET_STORAGE_KEY = 'financeApp.history.favoritePreset';
const SETTINGS_DEFAULT_VIEW_KEY = 'financeApp.settings.defaultView';
const SETTINGS_REDUCE_MOTION_KEY = 'financeApp.settings.reduceMotion';
const SETTINGS_OPEN_PANEL_KEY = 'financeApp.settings.openPanel';
const SETTINGS_PROFILE_AVATAR_KEY = 'financeApp.settings.profileAvatar';
const SETTINGS_ACCENT_COLOR_KEY = 'financeApp.settings.accentColor';
const DEFAULT_APP_SETTINGS = {
  defaultView: 'home',
  reduceMotion: false,
  profileAvatar: 'auto',
  accentColor: '#6366f1'
};
const PROFILE_AVATAR_CHOICES = ['auto', '🙂', '😎', '🧠', '💼', '💸', '🚀'];
const START_VIEW_CONFIG = {
  home: { id: 'home', title: 'Inicio' },
  dashboard: { id: 'dashboard', title: 'Resumen' },
  history: { id: 'history', title: 'Historial' },
  stats: { id: 'stats', title: 'Presupuestos' },
  accounts: { id: 'accounts', title: 'Cuentas' },
  reminders: { id: 'reminders', title: 'Recordatorios' }
};
const REMINDER_TYPE_LABELS = {
  insurance: 'Seguro',
  subscription: 'Suscripción',
  other: 'Otro'
};
const REMINDER_RECURRENCE_LABELS = {
  none: 'Sin repetición',
  monthly: 'Cada mes',
  yearly: 'Cada año'
};
let token = localStorage.getItem('token') || '';
const $ = (id) => document.getElementById(id);

// Estado de la aplicación
const state = {
  tree: [],
  catsById: new Map(),
  accounts: [],
  recurringTemplates: [],
  automationRules: [],
  forecast: null,
  accountsDragLockUntil: 0,
  accountDetailOriginViewId: 'accounts',
  dashboardSelectedAccountId: null,
  dashboardAccountSpendMode: 'all',
  dashboardSummaryMode: 'full',
  dashboardDateStart: '',
  dashboardDateEnd: '',
  dashboardUseCustomRange: false,
  budgetStatusFilter: localStorage.getItem(BUDGET_FILTER_STORAGE_KEY) || 'all',
  editingBudgetId: null,
  editingAccountId: null,
  editingCategoryId: null,
  currentAccountId: null,
  currentAccountTransactions: [],
  currentViewId: 'home',
  reminders: [],
  reminderFilter: 'all',
  historyRangeStart: '',
  historyRangeEnd: '',
  historyRangeSource: '',
  historyPendingAccountId: '',
  historyPendingCategoryId: '',
  user: null,
  settings: { ...DEFAULT_APP_SETTINGS }
};

let editingTxId = null;
let historySearchTimer = null;
let categoryFormImageData = null;
let categoryBgColorOverridden = false;
let accountFormImageData = null;
let editingReminderId = null;
let editingRecurringId = null;
let editingRuleId = null;
let appSettingsSyncTimer = null;
let categoryDragState = null;
let automationLastRunAt = 0;
let supportsRemoteSettingsApi = true;
let supportsAutomationApi = true;
let backendCapabilitiesLoaded = false;
let backendCapabilitiesPromise = null;
const collapsedHistoryGroups = new Set();
let historyFilteredTxns = [];
let historyVisibleCount = 30;
const historySelectedTxIds = new Set();
let historyFilterPresets = [];
let historyRecentPresetNames = [];
let historyFavoritePresetName = '';
const HISTORY_PAGE_SIZE = 30;

function applyAutomationApiAvailability() {
  const panel = document.querySelector('[data-settings-panel="automation"]');
  if (!panel) return;
  panel.style.display = supportsAutomationApi ? '' : 'none';
}

function applyBackendCapabilities(paths = {}) {
  supportsRemoteSettingsApi = Boolean(paths['/me/settings']);

  const automationPaths = [
    '/automation/recurring',
    '/automation/rules',
    '/automation/run',
    '/forecast'
  ];
  supportsAutomationApi = automationPaths.every((path) => Boolean(paths[path]));
  applyAutomationApiAvailability();
}

async function detectBackendCapabilities() {
  if (!API) return;

  try {
    const res = await fetch(`${API}/openapi.json`, {
      credentials: 'include',
      mode: 'cors'
    });

    if (!res.ok) return;

    const spec = await res.json().catch(() => null);
    const pathsCandidate = spec?.paths;
    const paths =
      pathsCandidate && typeof pathsCandidate === 'object'
        ? pathsCandidate
        : {};
    applyBackendCapabilities(paths);
  } catch (err) {
    // Backend capabilities detection failed - continue with defaults
  }
}

async function ensureBackendCapabilities() {
  if (backendCapabilitiesLoaded) return;
  if (backendCapabilitiesPromise) {
    await backendCapabilitiesPromise;
    return;
  }

  backendCapabilitiesPromise = detectBackendCapabilities();
  try {
    await backendCapabilitiesPromise;
  } finally {
    backendCapabilitiesLoaded = true;
    backendCapabilitiesPromise = null;
  }
}

async function fetchJsonSilent(path, opts = {}) {
  const headers = opts.headers || {};
  if (token) headers.Authorization = `Bearer ${token}`;
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
  } catch (err) {
    // Non-JSON response in silent request - continue with null
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

function normalizeCategoryKeyPart(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('es-ES')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function dedupeCategoryTree(rawTree = []) {
  const mergedSections = new Map();

  for (const section of rawTree || []) {
    const sectionName = normalizeCategoryKeyPart(section?.section);
    const sectionId = String(section?.section_id || '').trim();
    const sectionKey = sectionName || sectionId;
    if (!sectionKey) continue;

    if (!mergedSections.has(sectionKey)) {
      mergedSections.set(sectionKey, {
        section: section?.section || 'Sin sección',
        section_id: sectionId,
        categories: []
      });
    }

    const targetSection = mergedSections.get(sectionKey);
    targetSection.categories.push(...(section?.categories || []));
  }

  return Array.from(mergedSections.values()).map((section) => {
    const seenParents = new Set();
    const dedupedParents = [];

    for (const category of section.categories || []) {
      const parentName = normalizeCategoryKeyPart(category?.name);
      if (!parentName) continue;

      const parentKey = `${section.section_id}|${parentName}`;
      if (seenParents.has(parentKey)) continue;
      seenParents.add(parentKey);

      const seenSubs = new Set();
      const dedupedSubs = [];
      for (const subcategory of category?.subcategories || []) {
        const subName = normalizeCategoryKeyPart(subcategory?.name);
        if (!subName) continue;

        const subKey = `${parentName}|${subName}`;
        if (seenSubs.has(subKey)) continue;
        seenSubs.add(subKey);
        dedupedSubs.push(subcategory);
      }

      dedupedParents.push({
        ...category,
        subcategories: dedupedSubs
      });
    }

    return {
      ...section,
      categories: dedupedParents
    };
  });
}

function normalizeAppSettings(rawSettings = {}) {
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

function normalizeAccentColor(
  value,
  fallback = DEFAULT_APP_SETTINGS.accentColor
) {
  const input = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : fallback;
}

function getAccentCssTokens(color) {
  const accent = normalizeAccentColor(color, DEFAULT_APP_SETTINGS.accentColor);
  const r = Number.parseInt(accent.slice(1, 3), 16);
  const g = Number.parseInt(accent.slice(3, 5), 16);
  const b = Number.parseInt(accent.slice(5, 7), 16);

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

function loadAppSettings() {
  const stored = {
    defaultView: localStorage.getItem(SETTINGS_DEFAULT_VIEW_KEY),
    reduceMotion: localStorage.getItem(SETTINGS_REDUCE_MOTION_KEY) === '1',
    profileAvatar: localStorage.getItem(SETTINGS_PROFILE_AVATAR_KEY),
    accentColor: localStorage.getItem(SETTINGS_ACCENT_COLOR_KEY)
  };

  state.settings = normalizeAppSettings(stored);
}

function saveAppSettings() {
  localStorage.setItem(
    SETTINGS_DEFAULT_VIEW_KEY,
    state.settings.defaultView || DEFAULT_APP_SETTINGS.defaultView
  );
  localStorage.setItem(
    SETTINGS_REDUCE_MOTION_KEY,
    state.settings.reduceMotion ? '1' : '0'
  );
  localStorage.setItem(
    SETTINGS_PROFILE_AVATAR_KEY,
    state.settings.profileAvatar || DEFAULT_APP_SETTINGS.profileAvatar
  );
  localStorage.setItem(
    SETTINGS_ACCENT_COLOR_KEY,
    normalizeAccentColor(
      state.settings.accentColor,
      DEFAULT_APP_SETTINGS.accentColor
    )
  );
}

function updateAppSetting(key, value) {
  state.settings = {
    ...state.settings,
    [key]: value
  };
  saveAppSettings();
  applyAppSettings();
  scheduleRemoteSettingsSync();
}

function getSettingsPayloadForApi() {
  const normalized = normalizeAppSettings(state.settings);
  return {
    default_view: normalized.defaultView,
    reduce_motion: normalized.reduceMotion,
    profile_avatar: normalized.profileAvatar,
    accent_color: normalized.accentColor
  };
}

async function fetchRemoteAppSettings() {
  if (!token || !supportsRemoteSettingsApi) return false;

  try {
    const res = await fetch(`${API}/me/settings`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      },
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
    saveAppSettings();
    applyAppSettings();
    return true;
  } catch (err) {
    // Settings sync failed - continuing with local settings
    return false;
  }
}

async function persistRemoteAppSettings() {
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
  } catch (err) {
    // Remote save failed - falling back to local
    return false;
  }
}

function scheduleRemoteSettingsSync() {
  if (!token) return;
  if (appSettingsSyncTimer) {
    clearTimeout(appSettingsSyncTimer);
  }
  appSettingsSyncTimer = setTimeout(() => {
    appSettingsSyncTimer = null;
    persistRemoteAppSettings();
  }, 250);
}

function flushRemoteSettingsSync() {
  if (!token || !supportsRemoteSettingsApi) return;
  if (appSettingsSyncTimer) {
    clearTimeout(appSettingsSyncTimer);
    appSettingsSyncTimer = null;
  }
  persistRemoteAppSettings();
}

function applyAppSettings() {
  const root = document.documentElement;
  const accentTokens = getAccentCssTokens(state.settings.accentColor);
  root.style.setProperty('--accent', accentTokens.accent);
  root.style.setProperty('--accent-dark', accentTokens.dark);
  root.style.setProperty('--accent-glow', accentTokens.glow);
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', accentTokens.accent);
  }

  document.body.classList.toggle(
    'reduced-motion',
    Boolean(state.settings.reduceMotion)
  );
  syncAppSettingsControls();
  renderProfileIdentity();
  renderProfileAvatarChoices();
}

function syncAppSettingsControls() {
  const defaultView = $('settingDefaultView');
  const reduceMotion = $('settingReduceMotion');
  const accentColor = $('settingAccentColor');

  if (defaultView) {
    defaultView.value = START_VIEW_CONFIG[state.settings.defaultView]
      ? state.settings.defaultView
      : DEFAULT_APP_SETTINGS.defaultView;
  }

  if (reduceMotion) {
    reduceMotion.checked = Boolean(state.settings.reduceMotion);
  }

  if (accentColor) {
    accentColor.value = normalizeAccentColor(
      state.settings.accentColor,
      DEFAULT_APP_SETTINGS.accentColor
    );
  }
}

function getConfiguredStartView() {
  const candidate = state.settings.defaultView;
  if (START_VIEW_CONFIG[candidate]) {
    return START_VIEW_CONFIG[candidate];
  }
  return START_VIEW_CONFIG.home;
}

function getUserEmail() {
  return String(state.user?.email || '').trim();
}

function getFallbackInitial() {
  const email = getUserEmail();
  return email ? email.charAt(0).toUpperCase() : 'U';
}

function getActiveAvatarSymbol() {
  const chosen = state.settings.profileAvatar || 'auto';
  return chosen === 'auto' ? getFallbackInitial() : chosen;
}

function renderProfileIdentity() {
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

function renderProfileAvatarChoices() {
  const container = $('profileAvatarChoices');
  if (!container) return;
  const selected = state.settings.profileAvatar || 'auto';

  container.innerHTML = PROFILE_AVATAR_CHOICES.map((choice) => {
    const active = choice === selected ? ' is-active' : '';
    const icon = choice === 'auto' ? getFallbackInitial() : choice;
    const label = choice === 'auto' ? 'Auto' : choice;
    return `<button type="button" class="avatar-choice-btn${active}" data-avatar-choice="${choice}" title="${label}">${icon}</button>`;
  }).join('');
}

function isStrongPassword(value) {
  if (!value || value.length < 8) return false;
  const hasUppercase = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  return hasUppercase && hasNumber;
}

function getPasswordStrength(value) {
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

function setFieldAriaInvalid(field, isInvalid) {
  if (!field) return;
  field.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
}

function syncProfilePasswordAriaState({
  currentField,
  nextField,
  confirmField,
  currentPassword,
  nextPassword,
  confirmPassword
}) {
  const hasCurrent = currentPassword.length > 0;
  const strongEnough = isStrongPassword(nextPassword);
  const matches = nextPassword.length > 0 && nextPassword === confirmPassword;
  const hasStarted = nextPassword.length > 0 || confirmPassword.length > 0;

  setFieldAriaInvalid(currentField, hasStarted && !hasCurrent);
  setFieldAriaInvalid(
    nextField,
    hasStarted && (nextPassword.length === 0 || !strongEnough)
  );
  setFieldAriaInvalid(confirmField, confirmPassword.length > 0 && !matches);
}

function updateProfilePasswordFormState() {
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

  syncProfilePasswordAriaState({
    currentField,
    nextField,
    confirmField,
    currentPassword,
    nextPassword,
    confirmPassword
  });

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
        'Minimo 8 caracteres, una mayuscula, un numero y que coincidan.';
      hint.classList.remove('is-error', 'is-ok');
      return;
    }

    if (!strongEnough) {
      hint.textContent =
        'La nueva contrasena debe tener minimo 8 caracteres, una mayuscula y un numero.';
      hint.classList.add('is-error');
      hint.classList.remove('is-ok');
      return;
    }

    if (!matches) {
      hint.textContent = 'La confirmacion no coincide con la nueva contrasena.';
      hint.classList.add('is-error');
      hint.classList.remove('is-ok');
      return;
    }

    hint.textContent = 'Contrasena valida. Puedes actualizarla.';
    hint.classList.remove('is-error');
    hint.classList.add('is-ok');
  }
}

function clearProfilePasswordForm(resetShowPasswords = false) {
  const current = $('profileCurrentPassword');
  const next = $('profileNextPassword');
  const confirm = $('profileConfirmPassword');
  const show = $('profileShowPasswords');

  if (current) current.value = '';
  if (next) next.value = '';
  if (confirm) confirm.value = '';

  if (show && resetShowPasswords) {
    show.checked = false;
  }

  const nextType = show?.checked ? 'text' : 'password';
  if (current) current.type = nextType;
  if (next) next.type = nextType;
  if (confirm) confirm.type = nextType;

  updateProfilePasswordFormState();
}

async function changePasswordFromProfile() {
  const currentField = $('profileCurrentPassword');
  const nextField = $('profileNextPassword');
  const confirmField = $('profileConfirmPassword');
  const currentPassword = currentField?.value || '';
  const nextPassword = nextField?.value || '';
  const confirmPassword = confirmField?.value || '';
  const submitBtn = $('btnProfileChangePassword');
  const clearBtn = $('btnProfileClearPasswords');
  const passwordBlock = $('profilePasswordBlock');

  const setSubmittingState = (isSubmitting) => {
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting
      ? 'Actualizando...'
      : 'Actualizar contraseña';
    if (clearBtn) clearBtn.disabled = isSubmitting;
    if (passwordBlock) {
      passwordBlock.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
    }
  };

  if (!currentPassword) {
    showAlert('Rellena contraseña actual, nueva y confirmación', 'error');
    currentField?.focus();
    return;
  }

  if (!nextPassword) {
    showAlert('Rellena contraseña actual, nueva y confirmación', 'error');
    nextField?.focus();
    return;
  }

  if (!confirmPassword) {
    showAlert('Rellena contraseña actual, nueva y confirmación', 'error');
    confirmField?.focus();
    return;
  }

  if (nextPassword !== confirmPassword) {
    showAlert('La confirmación no coincide con la nueva contraseña', 'error');
    confirmField?.focus();
    return;
  }

  if (!isStrongPassword(nextPassword)) {
    showAlert(
      'La nueva contraseña debe tener mínimo 8 caracteres, una mayúscula y un número',
      'error'
    );
    nextField?.focus();
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
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: nextPassword
      })
    });

    if (res.status === 404) {
      showAlert('Cambio de contraseña pendiente en backend', 'info');
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || 'No se pudo cambiar la contraseña');
    }

    clearProfilePasswordForm();
    showAlert('Contraseña actualizada', 'info');
  } catch (err) {
    showAlert(err?.message || 'Error actualizando contraseña', 'error');
  } finally {
    setSubmittingState(false);
    updateProfilePasswordFormState();
  }
}

function initSettingsAccordion() {
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
      if (!hasOpenPanel) {
        localStorage.removeItem(SETTINGS_OPEN_PANEL_KEY);
      }
    });
  });
}

function reminderIdOf(item) {
  return String(item?.id || item?._id || '');
}

function reminderTypeLabel(type) {
  return REMINDER_TYPE_LABELS[type] || REMINDER_TYPE_LABELS.other;
}

function reminderRecurrenceLabel(value) {
  return REMINDER_RECURRENCE_LABELS[value] || REMINDER_RECURRENCE_LABELS.none;
}

function reminderDueInputValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = /^\d{4}-\d{2}-\d{2}/.exec(raw);
  if (direct) return direct[0];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function reminderDueLabel(value) {
  const inputValue = reminderDueInputValue(value);
  if (!inputValue) return 'Sin fecha';
  const parsed = new Date(`${inputValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
  return parsed.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function isReminderOverdue(reminder) {
  if (reminder?.is_completed) return false;
  const dueInput = reminderDueInputValue(reminder?.due_date);
  if (!dueInput) return false;
  const dueDate = new Date(`${dueInput}T23:59:59`);
  if (Number.isNaN(dueDate.getTime())) return false;
  return dueDate.getTime() < Date.now();
}

function getReminderById(reminderId) {
  return state.reminders.find(
    (item) => reminderIdOf(item) === String(reminderId)
  );
}

function getFilteredReminders(reminders = []) {
  const mode = state.reminderFilter || 'all';
  if (mode === 'pending') {
    return reminders.filter((item) => !item?.is_completed);
  }
  if (mode === 'overdue') {
    return reminders.filter((item) => isReminderOverdue(item));
  }
  return reminders;
}

function renderReminderFilterControls() {
  const filters = $('reminderFilters');
  if (!filters) return;
  filters.querySelectorAll('[data-reminder-filter]').forEach((button) => {
    const mode = button.dataset.reminderFilter || 'all';
    button.classList.toggle('is-active', mode === state.reminderFilter);
  });
}

function notifyReminderAdvanceAlert() {
  const reminders = Array.isArray(state.reminders) ? state.reminders : [];
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );
  const threshold = new Date(todayStart);
  threshold.setMonth(threshold.getMonth() + 2);

  const upcoming = reminders.filter((item) => {
    if (item?.is_completed) return false;
    const dueInput = reminderDueInputValue(item?.due_date);
    if (!dueInput) return false;
    const due = new Date(`${dueInput}T00:00:00`);
    if (Number.isNaN(due.getTime())) return false;
    return due >= todayStart && due <= threshold;
  });

  if (!upcoming.length) return;

  const nearest = upcoming
    .slice()
    .sort((a, b) => {
      const aDue = reminderDueInputValue(a?.due_date) || '9999-12-31';
      const bDue = reminderDueInputValue(b?.due_date) || '9999-12-31';
      return aDue.localeCompare(bDue);
    })
    .slice(0, 2)
    .map((item) => String(item?.title || 'Recordatorio'));

  const preview = nearest.length ? ` (${nearest.join(', ')})` : '';
  showAlert(
    `Tienes ${upcoming.length} recordatorio(s) que vencen en los próximos 2 meses${preview}`,
    'info'
  );
}

function updateReminderTabBadge() {
  const badge = $('remindersTabBadge');
  if (!badge) return;

  const reminders = Array.isArray(state.reminders) ? state.reminders : [];
  const pendingCount = reminders.filter((item) => !item?.is_completed).length;

  if (!pendingCount) {
    badge.style.display = 'none';
    badge.textContent = '0';
    return;
  }

  badge.style.display = 'inline-flex';
  badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
}

function renderRemindersList() {
  const container = $('remindersList');
  if (!container) return;

  const reminders = getFilteredReminders(
    Array.isArray(state.reminders) ? [...state.reminders] : []
  );
  reminders.sort((a, b) => {
    if (Boolean(a.is_completed) !== Boolean(b.is_completed)) {
      return a.is_completed ? 1 : -1;
    }
    const aDue = reminderDueInputValue(a?.due_date) || '9999-12-31';
    const bDue = reminderDueInputValue(b?.due_date) || '9999-12-31';
    return aDue.localeCompare(bDue);
  });

  if (!reminders.length) {
    container.innerHTML =
      '<p class="muted reminders-empty">No tienes recordatorios guardados.</p>';
    return;
  }

  container.innerHTML = reminders
    .map((item) => {
      const id = reminderIdOf(item);
      const completed = Boolean(item.is_completed);
      const overdue = isReminderOverdue(item);
      const hasAmount = Number.isFinite(Number(item.amount));
      const amountText = hasAmount
        ? `${Number(item.amount).toFixed(2)}€`
        : null;
      let status = 'Pendiente';
      let tone = '';
      if (completed) {
        status = 'Pagado';
        tone = 'is-completed';
      } else if (overdue) {
        status = 'Vencido';
        tone = 'is-overdue';
      }
      const note = String(item.note || '').trim();
      const toggleLabel = completed ? 'Marcar pendiente' : 'Marcar pagado';
      const recurrence = reminderRecurrenceLabel(item.recurrence || 'none');

      return `
        <article class="reminder-card ${tone}" data-reminder-id="${escapeHtml(id)}">
          <div class="reminder-card-head">
            <div>
              <h4>${escapeHtml(String(item.title || 'Recordatorio'))}</h4>
              <p class="reminder-meta">
                <span><i class="ph ph-calendar-dots"></i> ${escapeHtml(reminderDueLabel(item.due_date))}</span>
                <span><i class="ph ph-tag"></i> ${escapeHtml(reminderTypeLabel(item.type))}</span>
                <span><i class="ph ph-repeat"></i> ${escapeHtml(recurrence)}</span>
                ${amountText ? `<span><i class="ph ph-currency-eur"></i> ${escapeHtml(amountText)}</span>` : ''}
              </p>
            </div>
            <span class="reminder-status-pill">${escapeHtml(status)}</span>
          </div>
          ${note ? `<p class="reminder-note">${escapeHtml(note)}</p>` : ''}
          <div class="reminder-actions-row">
            <button class="btn" type="button" data-action="toggle-reminder" data-id="${escapeHtml(id)}">
              <i class="ph ph-check-circle"></i> ${escapeHtml(toggleLabel)}
            </button>
            <button class="btn" type="button" data-action="edit-reminder" data-id="${escapeHtml(id)}">
              <i class="ph ph-pencil-simple"></i> Editar
            </button>
            <button class="btn" type="button" data-action="delete-reminder" data-id="${escapeHtml(id)}">
              <i class="ph ph-trash"></i> Borrar
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

function resetReminderForm(shouldFocus = false) {
  editingReminderId = null;
  const title = $('reminderTitle');
  const amount = $('reminderAmount');
  const dueDate = $('reminderDueDate');
  const type = $('reminderType');
  const recurrence = $('reminderRecurrence');
  const autoAdvance = $('reminderAutoAdvance');
  const note = $('reminderNote');
  const completed = $('reminderCompleted');
  const saveBtn = $('btnSaveReminder');

  if (title) title.value = '';
  if (amount) amount.value = '';
  if (dueDate) dueDate.value = '';
  if (type) type.value = 'insurance';
  if (recurrence) recurrence.value = 'none';
  if (autoAdvance) autoAdvance.checked = true;
  if (note) note.value = '';
  if (completed) completed.checked = false;
  if (saveBtn)
    saveBtn.innerHTML = '<i class="ph ph-check"></i> Guardar recordatorio';

  if (shouldFocus && title) title.focus();
}

function loadReminderInForm(reminderId) {
  const reminder = getReminderById(reminderId);
  if (!reminder) return;

  editingReminderId = reminderIdOf(reminder);
  const title = $('reminderTitle');
  const amount = $('reminderAmount');
  const dueDate = $('reminderDueDate');
  const type = $('reminderType');
  const recurrence = $('reminderRecurrence');
  const autoAdvance = $('reminderAutoAdvance');
  const note = $('reminderNote');
  const completed = $('reminderCompleted');
  const saveBtn = $('btnSaveReminder');

  if (title) title.value = String(reminder.title || '');
  if (amount)
    amount.value = Number.isFinite(Number(reminder.amount))
      ? Number(reminder.amount).toFixed(2)
      : '';
  if (dueDate) dueDate.value = reminderDueInputValue(reminder.due_date);
  if (type) type.value = reminder.type || 'other';
  if (recurrence) recurrence.value = reminder.recurrence || 'none';
  if (autoAdvance) autoAdvance.checked = reminder.auto_advance !== false;
  if (note) note.value = String(reminder.note || '');
  if (completed) completed.checked = Boolean(reminder.is_completed);
  if (saveBtn)
    saveBtn.innerHTML = '<i class="ph ph-check"></i> Guardar cambios';
  if (title) title.focus();
}

function buildReminderPayloadFromForm() {
  const titleRaw = String($('reminderTitle')?.value || '').trim();
  const amountRaw = String($('reminderAmount')?.value || '').trim();
  const dueDate = String($('reminderDueDate')?.value || '').trim();
  const type = String($('reminderType')?.value || 'other').trim();
  const recurrence = String($('reminderRecurrence')?.value || 'none').trim();
  const autoAdvance = Boolean($('reminderAutoAdvance')?.checked);
  const noteRaw = String($('reminderNote')?.value || '').trim();
  const isCompleted = Boolean($('reminderCompleted')?.checked);

  if (!titleRaw) {
    showAlert('Indica el nombre del recordatorio', 'error');
    $('reminderTitle')?.focus();
    return null;
  }
  if (!dueDate) {
    showAlert('Selecciona la fecha de vencimiento', 'error');
    $('reminderDueDate')?.focus();
    return null;
  }

  let amountValue = null;
  if (amountRaw) {
    amountValue = Number(amountRaw);
    if (!Number.isFinite(amountValue) || amountValue < 0) {
      showAlert('El importe debe ser un número positivo', 'error');
      $('reminderAmount')?.focus();
      return null;
    }
    amountValue = Number(amountValue.toFixed(2));
  }

  return {
    title: titleRaw,
    due_date: `${dueDate}T00:00:00`,
    amount: amountValue,
    type: REMINDER_TYPE_LABELS[type] ? type : 'other',
    recurrence: REMINDER_RECURRENCE_LABELS[recurrence] ? recurrence : 'none',
    auto_advance: autoAdvance,
    note: noteRaw || null,
    is_completed: isCompleted
  };
}

async function loadReminders(options = {}) {
  const shouldNotify = Boolean(options?.notifyAdvance);
  if (!token) {
    state.reminders = [];
    updateReminderTabBadge();
    renderReminderFilterControls();
    renderRemindersList();
    return;
  }
  try {
    const data = await api('/reminders');
    state.reminders = Array.isArray(data) ? data : [];
    updateReminderTabBadge();
    renderReminderFilterControls();
    renderRemindersList();
    if (shouldNotify) {
      notifyReminderAdvanceAlert();
    }
  } catch (err) {
    console.error('Error cargando recordatorios:', err);
  }
}

async function saveReminderFromSettings() {
  const payload = buildReminderPayloadFromForm();
  if (!payload) return;

  try {
    if (editingReminderId) {
      await api(`/reminders/${editingReminderId}`, {
        method: 'PATCH',
        json: payload,
        body: JSON.stringify(payload)
      });
      showAlert('Recordatorio actualizado', 'success');
    } else {
      await api('/reminders', {
        method: 'POST',
        json: payload,
        body: JSON.stringify(payload)
      });
      showAlert('Recordatorio guardado', 'success');
    }
    resetReminderForm();
    await loadReminders();
  } catch (err) {
    showAlert(err?.message || 'No se pudo guardar el recordatorio', 'error');
  }
}

async function toggleReminderStatus(reminderId) {
  const reminder = getReminderById(reminderId);
  if (!reminder) return;

  try {
    const payload = { is_completed: !reminder.is_completed };
    await api(`/reminders/${reminderId}`, {
      method: 'PATCH',
      json: payload,
      body: JSON.stringify(payload)
    });
    await loadReminders();
  } catch (err) {
    showAlert(err?.message || 'No se pudo actualizar el recordatorio', 'error');
  }
}

async function deleteReminder(reminderId) {
  const reminder = getReminderById(reminderId);
  const title = reminder ? String(reminder.title || '').trim() : '';
  const ok = confirm(
    title
      ? `¿Eliminar el recordatorio "${title}"?`
      : '¿Eliminar este recordatorio?'
  );
  if (!ok) return;

  try {
    await api(`/reminders/${reminderId}`, { method: 'DELETE' });
    if (editingReminderId && editingReminderId === String(reminderId)) {
      resetReminderForm();
    }
    await loadReminders();
    showAlert('Recordatorio eliminado', 'success');
  } catch (err) {
    showAlert(err?.message || 'No se pudo eliminar el recordatorio', 'error');
  }
}

function initReminderListeners() {
  const btnSaveReminder = $('btnSaveReminder');
  const btnClearReminderForm = $('btnClearReminderForm');
  const reminderFilters = $('reminderFilters');
  const remindersList = $('remindersList');

  if (btnSaveReminder)
    btnSaveReminder.addEventListener('click', () => {
      saveReminderFromSettings();
    });

  if (btnClearReminderForm)
    btnClearReminderForm.addEventListener('click', () => {
      resetReminderForm(true);
    });

  if (reminderFilters)
    reminderFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-reminder-filter]');
      if (!button) return;
      state.reminderFilter = button.dataset.reminderFilter || 'all';
      renderReminderFilterControls();
      renderRemindersList();
    });

  if (remindersList)
    remindersList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const reminderId = button.dataset.id;
      if (!reminderId) return;

      if (action === 'toggle-reminder') {
        toggleReminderStatus(reminderId);
        return;
      }
      if (action === 'edit-reminder') {
        loadReminderInForm(reminderId);
        return;
      }
      if (action === 'delete-reminder') {
        deleteReminder(reminderId);
      }
    });
}

const LEGACY_ICON_MAP = {
  payment: '💳',
  payments: '💳',
  work: '💼',
  savings: '🏦',
  restaurant: '🍽️',
  restaurant_menu: '🍽️',
  local_cafe: '☕',
  shopping_cart: '🛒',
  local_gas_station: '⛽',
  directions_car: '🚗',
  directions_bus: '🚌',
  directions_transit: '🚇',
  movie: '🎬',
  flight: '✈️',
  subscriptions: '📱',
  trending_up: '📈',
  psychology: '🧠',
  assignment: '📝',
  apartment: '🏠',
  handyman: '🛠️',
  flash_on: '⚡',
  build: '🔧',
  house: '🏠',
  fitness_center: '🏋️',
  money: '💰',
  account_balance_wallet: '👛',
  account_balance: '🏦',
  shield: '🛡️',
  security: '🛡️',
  category: '🧩'
};

const CATEGORY_NAME_ICON_MAP = [
  [/nomina|nómina|salario/i, '💼'],
  [/extra|bonus/i, '✨'],
  [/regalo/i, '🎁'],
  [/intere/i, '📈'],
  [/venta/i, '🏷️'],
  [/hogar|alquiler|vivienda/i, '🏠'],
  [/suministro|luz|agua/i, '💡'],
  [/supermercado/i, '🛒'],
  [/aliment|ubereat|comida/i, '🍎'],
  [/restaurante|desayuno|snack|cena/i, '🍽️'],
  [/ocio|hobb|cine|concierto|evento|viaje/i, '🎨'],
  [/personal|médico|medico|peluquer|deporte|aseo/i, '🧘'],
  [/compra|ropa|tecnolog/i, '🛍️'],
  [/transporte|gasolina|uber|peaje|coche|moto/i, '🚗'],
  [/invit/i, '🥂'],
  [/suscrip|netflix|spotify|icloud/i, '📱'],
  [/deudor/i, '🤝'],
  [/inversion/i, '📊'],
  [/ahorro|hucha|trade republic/i, '🏦'],
  [/traspaso|transfer/i, '🔁'],
  [/seguro/i, '🛡️'],
  [/vario|otro/i, '🧩']
];

const CATEGORY_ICON_SET = new Set([
  '💼',
  '✨',
  '🎁',
  '📈',
  '🏷️',
  '🏠',
  '💡',
  '🍎',
  '🍽️',
  '☕',
  '🎨',
  '🎬',
  '✈️',
  '🧘',
  '🛍️',
  '🚗',
  '⛽',
  '🚌',
  '🥂',
  '📱',
  '🤝',
  '📊',
  '🏦',
  '🔁',
  '🛡️',
  '🧩',
  '💳',
  '💰',
  '👛',
  '🛠️',
  '🔧',
  '🧾',
  '🧠',
  '📚',
  '🎓',
  '🏥',
  '💊',
  '🦷',
  '🐾',
  '👶',
  '🧒',
  '🎮',
  '🎵',
  '📷',
  '🧳',
  '🚆',
  '🚕',
  '🅿️',
  '🛣️',
  '🏍️',
  '🚲',
  '🏋️',
  '⚽',
  '📦',
  '🏪',
  '🧹',
  '🪑',
  '🪴',
  '🌐',
  '☎️',
  '📶',
  '🔒',
  '🧯',
  '⚖️',
  '🛒',
  '💸',
  '💱',
  '🪙',
  '📅',
  '⏰',
  '📌',
  '✅'
]);

const CATEGORY_ICON_GROUPS = [
  {
    label: 'Ingresos y dinero',
    icons: ['💼', '✨', '🎁', '📈', '💰', '💸', '💱', '🪙', '💳', '👛', '🏦']
  },
  {
    label: 'Hogar y servicios',
    icons: ['🏠', '💡', '🏪', '🧹', '🪑', '🪴', '🧾', '📦']
  },
  {
    label: 'Comida y ocio',
    icons: ['🛒', '🍎', '🍽️', '☕', '🥂', '🎨', '🎬', '🎮', '🎵', '📷']
  },
  {
    label: 'Salud y bienestar',
    icons: ['🧘', '🏥', '💊', '🦷', '🏋️', '⚽', '🐾']
  },
  {
    label: 'Transporte y viajes',
    icons: ['🚗', '⛽', '🚌', '🚆', '🚕', '🏍️', '🚲', '✈️', '🧳', '🅿️', '🛣️']
  },
  {
    label: 'Digital y suscripciones',
    icons: ['📱', '🌐', '☎️', '📶', '🔒']
  },
  {
    label: 'Gestión y otros',
    icons: [
      '🤝',
      '🔁',
      '🛡️',
      '🛠️',
      '🔧',
      '⚖️',
      '📅',
      '⏰',
      '📌',
      '✅',
      '🧩',
      '🧠',
      '📚',
      '🎓',
      '🏷️'
    ]
  }
];

const CATEGORY_ICON_COLOR_MAP = {
  '💼': '#16a34a',
  '✨': '#22c55e',
  '🎁': '#f43f5e',
  '📈': '#0891b2',
  '🏷️': '#0ea5a4',
  '🏠': '#d97706',
  '💡': '#f59e0b',
  '🍎': '#65a30d',
  '🍽️': '#dc2626',
  '☕': '#b45309',
  '🎨': '#8b5cf6',
  '🎬': '#7c3aed',
  '✈️': '#4338ca',
  '🧘': '#db2777',
  '🛍️': '#c026d3',
  '🚗': '#2563eb',
  '⛽': '#1d4ed8',
  '🚌': '#0284c7',
  '🥂': '#ca8a04',
  '📱': '#4f46e5',
  '🤝': '#0e7490',
  '📊': '#059669',
  '🏦': '#0f766e',
  '🔁': '#0284c7',
  '🛡️': '#475569',
  '🧩': '#71717a',
  '💳': '#6366f1',
  '💰': '#16a34a',
  '👛': '#a855f7',
  '🛠️': '#64748b',
  '🔧': '#64748b',
  '🧾': '#475569',
  '🧠': '#7c3aed',
  '📚': '#1d4ed8',
  '🎓': '#4338ca',
  '🏥': '#ef4444',
  '💊': '#f43f5e',
  '🦷': '#06b6d4',
  '🐾': '#a16207',
  '👶': '#f97316',
  '🧒': '#ea580c',
  '🎮': '#7c3aed',
  '🎵': '#8b5cf6',
  '📷': '#0f766e',
  '🧳': '#0369a1',
  '🚆': '#0284c7',
  '🚕': '#ca8a04',
  '🅿️': '#1d4ed8',
  '🛣️': '#334155',
  '🏍️': '#2563eb',
  '🚲': '#0e7490',
  '🏋️': '#dc2626',
  '⚽': '#059669',
  '📦': '#a16207',
  '🏪': '#b45309',
  '🧹': '#0f766e',
  '🪑': '#78716c',
  '🪴': '#65a30d',
  '🌐': '#2563eb',
  '☎️': '#0ea5e9',
  '📶': '#3b82f6',
  '🔒': '#475569',
  '🧯': '#dc2626',
  '⚖️': '#64748b',
  '🛒': '#0ea5e9',
  '💸': '#dc2626',
  '💱': '#0ea5e9',
  '🪙': '#ca8a04',
  '📅': '#7c3aed',
  '⏰': '#f59e0b',
  '📌': '#ef4444',
  '✅': '#16a34a'
};

function normalizeCategoryIcon(rawIcon, categoryName, fallbackIcon = '🧾') {
  const icon = String(rawIcon || '').trim();
  if (!icon) {
    return inferIconFromCategoryName(categoryName, fallbackIcon);
  }

  const normalized = icon.toLowerCase().replaceAll(/\s+/gu, '_');
  const fromLegacy = LEGACY_ICON_MAP[normalized];
  if (fromLegacy) {
    return String(fromLegacy);
  }

  if (/^[a-z0-9_-]+$/i.test(icon)) {
    return inferIconFromCategoryName(categoryName, fallbackIcon);
  }

  return icon;
}

function inferIconFromCategoryName(categoryName, fallbackIcon = '🧾') {
  const name = String(categoryName || '').trim();
  for (const [pattern, icon] of CATEGORY_NAME_ICON_MAP) {
    if (pattern.test(name)) return String(icon);
  }
  return String(fallbackIcon);
}

function inferColorFromCategory(category, fallbackColor = '#94a3b8') {
  const icon = normalizeCategoryIcon(category?.icon, category?.name, '🧾');
  const fromIcon = CATEGORY_ICON_COLOR_MAP[icon];
  if (fromIcon) return fromIcon;

  const name = String(category?.name || '')
    .trim()
    .toLowerCase();
  if (/ingreso|nomina|nómina|extra|interes|interés|venta/.test(name)) {
    return '#16a34a';
  }
  if (/ahorro|inversion|inversión/.test(name)) {
    return '#0f766e';
  }
  if (/traspas|transfer/.test(name)) {
    return '#0284c7';
  }
  return fallbackColor;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeColorValue(value, fallback) {
  const input = String(value || '').trim();
  return input || fallback;
}

function clearFileInput(inputId) {
  const input = $(inputId);
  if (input) input.value = '';
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      resolve(typeof result === 'string' ? result : '');
    };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function normalizeRemoteImageUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('La URL de la imagen debe empezar por http o https');
    }
    return parsed.toString();
  } catch {
    throw new Error('Introduce una URL de imagen válida');
  }
}

function buildVisualPreviewMarkup(imageData, icon, fallbackIcon = '🧾') {
  if (imageData) {
    return `<div class="visual-preview-card"><img class="visual-preview-image" src="${escapeHtml(imageData)}" alt="Vista previa" /></div>`;
  }

  const resolvedIcon = normalizeCategoryIcon(icon, '', fallbackIcon);
  return `<div class="visual-preview-card visual-preview-card--icon"><span>${escapeHtml(resolvedIcon)}</span></div>`;
}

function renderVisualPreview(
  containerId,
  imageData,
  icon,
  fallbackIcon = '🧾'
) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = buildVisualPreviewMarkup(imageData, icon, fallbackIcon);
}

function renderCategoryVisualContent(
  visual,
  imageClass = 'visual-token-image'
) {
  if (visual?.imageData) {
    return `<img class="${imageClass}" src="${escapeHtml(visual.imageData)}" alt="${escapeHtml(visual.name)}" loading="lazy" decoding="async" />`;
  }
  return `<span>${escapeHtml(visual.icon)}</span>`;
}

function buildCategoryVisualStyle(visual, includeColorToken = true) {
  const styles = [];
  if (includeColorToken) styles.push(`--cat-color:${visual.color}`);
  if (visual?.bgColor) styles.push(`background:${visual.bgColor}`);
  if (visual?.borderColor) styles.push(`border-color:${visual.borderColor}`);
  return styles.join(';');
}

function getCategoryVisual(
  category,
  fallbackIcon = '🧾',
  fallbackColor = '#94a3b8'
) {
  const resolvedColor = normalizeColorValue(
    category?.color,
    inferColorFromCategory(category, fallbackColor)
  );
  return {
    icon: normalizeCategoryIcon(category?.icon, category?.name, fallbackIcon),
    color: resolvedColor,
    imageData: category?.image_data || null,
    bgColor: category?.bg_color || '',
    borderColor: category?.border_color || '',
    name: category?.name || 'Sin categoría'
  };
}

function getTransferVisual(categoryId) {
  if (categoryId === 'transfer_out') {
    return {
      icon: '🔁',
      color: '#2563eb',
      imageData: null,
      bgColor: '',
      borderColor: '',
      name: 'Traspaso enviado'
    };
  }
  if (categoryId === 'transfer_in') {
    return {
      icon: '🔁',
      color: '#0f766e',
      imageData: null,
      bgColor: '',
      borderColor: '',
      name: 'Traspaso recibido'
    };
  }
  return null;
}

function buildCategoryOption(category) {
  const visual = getCategoryVisual(category);
  const label = escapeHtml(visual.icon + ' ' + visual.name);
  return `<option value="${category._id}">${label}</option>`;
}

function buildSubcategoryOption(category) {
  const visual = getCategoryVisual(category, '•');
  const label = escapeHtml(visual.icon + ' ' + visual.name);
  return `<option value="${category._id}">${label}</option>`;
}

function findAccountForTransaction(tx) {
  const accountRef = String(tx?.account_id || '').trim();
  if (!accountRef) return null;
  return (
    (state.accounts || []).find(
      (account) =>
        String(account?.id || '') === accountRef ||
        String(account?.name || '') === accountRef
    ) || null
  );
}

function sortTransactionsByMostRecent(transactions = []) {
  return [...transactions].sort((left, right) => {
    const leftTime = new Date(left?.date || 0).getTime();
    const rightTime = new Date(right?.date || 0).getTime();
    if (rightTime !== leftTime) return rightTime - leftTime;
    // Same date: use _id as tiebreaker (MongoDB ObjectId is time-ordered)
    const leftId = String(left?._id || '');
    const rightId = String(right?._id || '');
    if (rightId > leftId) return 1;
    if (rightId < leftId) return -1;
    return 0;
  });
}

function getTransactionSignedAmount(tx) {
  const amount = Math.abs(Number(tx?.amount || 0));
  return tx?.type === 'income' ? amount : -amount;
}

function annotateTransactionsWithRunningBalances(transactions = []) {
  const balanceByAccount = new Map();

  return transactions.map((tx) => {
    const account = findAccountForTransaction(tx);
    const accountKey = String(account?.id || tx?.account_id || '').trim();

    if (!account || !accountKey) {
      return { ...tx, running_balance_after: null };
    }

    if (!balanceByAccount.has(accountKey)) {
      balanceByAccount.set(accountKey, Number(account.current_balance || 0));
    }

    const runningBalanceAfter = balanceByAccount.get(accountKey);
    balanceByAccount.set(
      accountKey,
      runningBalanceAfter - getTransactionSignedAmount(tx)
    );

    return {
      ...tx,
      running_balance_after: Number.isFinite(runningBalanceAfter)
        ? runningBalanceAfter
        : null
    };
  });
}

function buildTransactionIsoDate(dateValue) {
  // Always use current server time for precise ordering
  // The date input only specifies the date (YYYY-MM-DD), time is always NOW
  if (!dateValue) return new Date().toISOString();

  const selectedDate = new Date(dateValue + 'T00:00:00Z');
  if (!selectedDate || Number.isNaN(selectedDate.getTime())) {
    return new Date().toISOString();
  }

  const now = new Date();
  selectedDate.setUTCHours(
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds()
  );
  return selectedDate.toISOString();
}

function renderTxAccountMeta(tx) {
  const account = findAccountForTransaction(tx);
  if (account) {
    return `
      <span class="tx-account-chip" title="${escapeHtml(account.name || 'Cuenta')}">
        ${getAccountBadgeMarkup(account, 'account-brand-badge--tx')}
        <span class="tx-account-name">${escapeHtml(account.name || 'Cuenta')}</span>
      </span>
    `;
  }

  const fallbackAccount = String(tx?.account_id || '').trim();
  if (!fallbackAccount) return '';
  return `<span class="tx-account-chip tx-account-chip--fallback"><span class="tx-account-name">${escapeHtml(fallbackAccount)}</span></span>`;
}

function renderTxItem(tx, includeNote = true, options = {}) {
  const cat = state.catsById.get(tx.category_id);
  const sub = tx.subcategory_id ? state.catsById.get(tx.subcategory_id) : null;
  const transferVisual = getTransferVisual(tx.category_id);
  const visual = transferVisual || getCategoryVisual(sub || cat);
  const date = new Date(tx.date).toLocaleDateString();
  const accountMeta = renderTxAccountMeta(tx);
  const note = (tx.note || '').trim();
  const sign = tx.type === 'expense' ? '-' : '+';
  const amount = Number(tx.amount || 0).toFixed(2);
  const title = transferVisual ? visual.name : cat?.name || visual.name;
  const runningBalanceAfter = Number(tx?.running_balance_after);
  const showRunningBalance = Number.isFinite(runningBalanceAfter);
  const isSelectable = Boolean(options.selectable);
  const isSelected = isSelectable && historySelectedTxIds.has(String(tx._id));
  const checkedAttribute = isSelected ? 'checked' : '';
  const quickEditButtonHtml = isSelectable
    ? `
      <button
        type="button"
        class="tx-inline-edit-btn"
        data-history-edit-id="${tx._id}"
        title="Editar movimiento"
        aria-label="Editar movimiento"
      >
        <i class="ph ph-pencil-simple"></i>
      </button>
    `
    : '';
  const selectorHtml = isSelectable
    ? `
      <label class="tx-select" aria-label="Seleccionar movimiento">
        <input
          type="checkbox"
          class="tx-select-input"
          data-history-select="${tx._id}"
          ${checkedAttribute}
        />
        <span class="tx-select-mark" aria-hidden="true"></span>
      </label>
    `
    : '';

  return `
    <div class="tx-item${isSelected ? ' is-selected' : ''}" data-id="${tx._id}">
      ${selectorHtml}
      <div class="tx-main">
        <div class="tx-icon-badge" style="${buildCategoryVisualStyle(visual)}">
          ${renderCategoryVisualContent(visual, 'visual-token-image visual-token-image--tx')}
        </div>
        <div class="tx-copy">
          <div class="tx-title">${escapeHtml(title)}</div>
          ${sub ? `<div class="tx-sub">${escapeHtml(sub.name)}</div>` : ''}
          ${includeNote && note ? `<div class="tx-note">${escapeHtml(note)}</div>` : ''}
          <div class="tx-meta-row">
            <div class="tx-meta">${date}</div>
            ${accountMeta}
          </div>
        </div>
      </div>
      <div class="tx-money ${tx.type === 'expense' ? 'is-expense' : 'is-income'}">
        ${quickEditButtonHtml}
        <div>${sign}${amount}<span class="euro-symbol">€</span></div>
        ${showRunningBalance ? `<div class="tx-running-balance">${runningBalanceAfter.toFixed(2)}€</div>` : ''}
      </div>
    </div>
  `;
}

function renderBreakdownItem(categoryId, amount, totalExpense = 0) {
  const category = state.catsById.get(categoryId);
  const visual = getCategoryVisual(category, '📊', '#818cf8');
  const percentage =
    totalExpense > 0 ? (Number(amount || 0) / totalExpense) * 100 : 0;
  const width = Math.max(0, Math.min(percentage, 100));
  return `
    <div class="summary-row summary-row--clickable" role="button" tabindex="0" data-cat-id="${escapeHtml(categoryId)}" title="Ver gastos de ${escapeHtml(visual.name)}">
      <div class="summary-main summary-main--stacked">
        <div class="summary-main-top">
          <div class="summary-icon" style="${buildCategoryVisualStyle(visual)}">${renderCategoryVisualContent(visual, 'visual-token-image visual-token-image--summary')}</div>
          <span class="summary-name">${escapeHtml(visual.name)}</span>
        </div>
        <div class="summary-bar" aria-hidden="true">
          <div class="summary-bar-fill" style="--cat-color:${visual.color}; width:${width.toFixed(1)}%"></div>
        </div>
      </div>
      <div class="summary-values">
        <span class="summary-value">${Number(amount || 0).toFixed(2)}€</span>
        <span class="summary-percent">${percentage.toFixed(1)}%</span>
      </div>
    </div>
  `;
}

function buildAccountSpendDistributionCard(transactions = [], options = {}) {
  const title = options.title || 'Gasto por categoría';
  const caption = options.caption || 'Esta cuenta';
  const emptyMessage =
    options.emptyMessage || 'No hay gastos en esta cuenta todavía.';
  const controlsHtml = options.controlsHtml || '';
  const expenseTransactions = (transactions || []).filter(
    (tx) => tx?.type === 'expense' && tx?.category_id !== 'transfer_out'
  );

  const totalsByCategory = new Map();
  for (const tx of expenseTransactions) {
    const categoryId = String(tx.category_id || '');
    if (!categoryId) continue;
    totalsByCategory.set(
      categoryId,
      (totalsByCategory.get(categoryId) || 0) + Number(tx.amount || 0)
    );
  }

  const items = Array.from(totalsByCategory.entries())
    .map(([categoryId, amount]) => {
      const category = state.catsById.get(categoryId);
      const visual = getCategoryVisual(category, '📊', '#818cf8');
      return {
        categoryId,
        amount: Number(amount || 0),
        color: visual.color,
        icon: visual.icon,
        name: visual.name
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const totalExpense = items.reduce((sum, item) => sum + item.amount, 0);

  if (totalExpense <= 0) {
    return `
      <div class="account-spend-card">
        <div class="account-spend-header">
          <span>${escapeHtml(title)}</span>
          <div class="account-spend-header-side">
            ${controlsHtml}
            <span class="account-spend-caption">${escapeHtml(caption)}</span>
          </div>
        </div>
        <p class="account-spend-empty">${escapeHtml(emptyMessage)}</p>
      </div>
    `;
  }

  let progress = 0;
  const ringGradient = items
    .map((item) => {
      const pct = (item.amount / totalExpense) * 100;
      const start = progress;
      progress += pct;
      return `${item.color} ${start.toFixed(2)}% ${progress.toFixed(2)}%`;
    })
    .join(', ');

  const legendHtml = items
    .map((item) => {
      const pct = (item.amount / totalExpense) * 100;
      return `
        <div class="account-spend-legend-item">
          <span class="account-spend-legend-main">
            <span class="account-spend-legend-icon" style="--cat-color:${item.color}">${escapeHtml(item.icon)}</span>
            <span class="account-spend-legend-copy">
              <span class="account-spend-legend-name">${escapeHtml(item.name)}</span>
              <span class="account-spend-legend-amount">${item.amount.toFixed(2)}€</span>
            </span>
          </span>
          <span class="account-spend-legend-pct">${pct.toFixed(1)}%</span>
        </div>
      `;
    })
    .join('');

  const breakdownHtml = items
    .map((item) =>
      renderBreakdownItem(item.categoryId, item.amount, totalExpense)
    )
    .join('');

  return `
    <div class="account-spend-card">
      <div class="account-spend-header">
        <span>${escapeHtml(title)}</span>
        <div class="account-spend-header-side">
          ${controlsHtml}
          <span class="account-spend-caption">${escapeHtml(caption)}</span>
        </div>
      </div>
      <div class="account-spend-overview">
        <div class="account-spend-ring" style="--ring-gradient:${ringGradient}">
          <div class="account-spend-ring-center">
            <span class="account-spend-total-label">Gastado</span>
            <span class="account-spend-total-value">${totalExpense.toFixed(2)}€</span>
          </div>
        </div>
        <div class="account-spend-legend">${legendHtml}</div>
      </div>
      <div class="account-spend-breakdown">${breakdownHtml}</div>
    </div>
  `;
}

function buildDashboardAccountSpendCard(accounts = [], transactions = []) {
  const selectableAccounts = (accounts || []).filter((acc) => acc?.id);

  if (!selectableAccounts.length) {
    return `
      <div class="account-spend-card account-spend-card--dashboard">
        <div class="account-spend-header">
          <span>Gasto por cuenta</span>
          <div class="account-spend-header-side">
            <span class="account-spend-caption">Resumen</span>
          </div>
        </div>
        <p class="account-spend-empty">No tienes cuentas disponibles.</p>
      </div>
    `;
  }

  const selectedAccount = selectableAccounts.find(
    (acc) => String(acc.id) === String(state.dashboardSelectedAccountId || '')
  );
  const isAllAccounts = !selectedAccount;

  const accountButtonsHtml = `
    <div class="account-spend-account-pills" aria-label="Seleccionar cuenta">
      <button type="button" class="account-spend-account-pill${
        isAllAccounts ? ' is-active' : ''
      }" data-dashboard-account-id="__all__">Todas</button>
      ${selectableAccounts
        .map(
          (acc) =>
            `<button type="button" class="account-spend-account-pill${
              String(acc.id) === String(selectedAccount?.id || '')
                ? ' is-active'
                : ''
            }" data-dashboard-account-id="${escapeHtml(acc.id)}">${escapeHtml(acc.name || 'Cuenta')}</button>`
        )
        .join('')}
    </div>
  `;

  if (isAllAccounts) {
    return buildAccountSpendDistributionCard(transactions || [], {
      title: 'Gasto por cuenta',
      caption: 'Todas las cuentas',
      emptyMessage: 'Aún no hay gastos registrados en este ciclo.',
      controlsHtml: accountButtonsHtml
    });
  }

  const filteredTransactions = (transactions || []).filter((tx) => {
    const accountRef = String(tx?.account_id || '');
    return (
      accountRef === String(selectedAccount.id) ||
      accountRef === String(selectedAccount.name || '')
    );
  });

  return buildAccountSpendDistributionCard(filteredTransactions, {
    title: 'Gasto por cuenta',
    caption: selectedAccount.name || 'Cuenta seleccionada',
    emptyMessage: 'Esta cuenta aún no tiene gastos registrados.',
    controlsHtml: accountButtonsHtml
  });
}

function formatDashboardCycle(summary = {}) {
  const start = summary.period_start ? new Date(summary.period_start) : null;
  const end = summary.period_end ? new Date(summary.period_end) : null;

  if (
    !start ||
    Number.isNaN(start.getTime()) ||
    !end ||
    Number.isNaN(end.getTime())
  ) {
    return 'Ciclo desde el día 26';
  }

  const options = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString('es-ES', options)} - ${end.toLocaleDateString('es-ES', options)}`;
}

function getDashboardDateInputValue(isoValue = '') {
  return String(isoValue || '').slice(0, 10);
}

function buildDashboardSummaryPath() {
  const params = new URLSearchParams();

  if (
    state.dashboardUseCustomRange &&
    state.dashboardDateStart &&
    state.dashboardDateEnd
  ) {
    params.set('start_date', state.dashboardDateStart);
    params.set('end_date', state.dashboardDateEnd);
  }

  const query = params.toString();
  return query ? `/summary/monthly?${query}` : '/summary/monthly';
}

async function fetchAllTransactions(filters = {}) {
  const allTransactions = [];
  const maxPages = 200;
  let skip = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      limit: String(TRANSACTIONS_PAGE_SIZE),
      skip: String(skip)
    });

    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      params.set(key, String(value));
    });

    const chunk = await api(`/transactions?${params.toString()}`);
    if (!Array.isArray(chunk) || chunk.length === 0) break;

    allTransactions.push(...chunk);
    if (chunk.length < TRANSACTIONS_PAGE_SIZE) break;
    skip += TRANSACTIONS_PAGE_SIZE;
  }

  return allTransactions;
}

function getDashboardTransactionFilters() {
  const filters = {};

  if (
    state.dashboardUseCustomRange &&
    state.dashboardDateStart &&
    state.dashboardDateEnd
  ) {
    filters.start_date = state.dashboardDateStart;
    filters.end_date = state.dashboardDateEnd;
  } else {
    filters.cycle = 'current';
  }

  return filters;
}

function syncDashboardRangeInputs(summary = {}) {
  const startValue = getDashboardDateInputValue(summary.period_start);
  const endValue = getDashboardDateInputValue(summary.period_end);
  const startInput = $('dashboardDateStart');
  const endInput = $('dashboardDateEnd');

  state.dashboardDateStart = startValue;
  state.dashboardDateEnd = endValue;

  if (startInput) startInput.value = startValue;
  if (endInput) endInput.value = endValue;
}

function filterTransactionsByDashboardCycle(transactions = [], summary = {}) {
  const start = summary.period_start ? new Date(summary.period_start) : null;
  const end = summary.period_end ? new Date(summary.period_end) : null;

  if (
    !start ||
    Number.isNaN(start.getTime()) ||
    !end ||
    Number.isNaN(end.getTime())
  ) {
    return transactions;
  }

  const inclusiveEnd = new Date(end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() + 1);

  return (transactions || []).filter((tx) => {
    const txDate = tx?.date ? new Date(tx.date) : null;
    if (!txDate || Number.isNaN(txDate.getTime())) return false;
    return txDate >= start && txDate < inclusiveEnd;
  });
}

function getSectionOptions() {
  return (state.tree || [])
    .map(
      (section) =>
        `<option value="${section.section_id}">${escapeHtml(section.section)}</option>`
    )
    .join('');
}

function getParentCategoryOptions(selectedParentId = '') {
  const parents = [];
  for (const section of state.tree || []) {
    for (const category of section.categories || []) {
      parents.push(category);
    }
  }

  return [
    '<option value="">Sin padre (categoría principal)</option>',
    ...parents.map((category) => {
      const visual = getCategoryVisual(category);
      const selected =
        String(selectedParentId) === String(category._id) ? ' selected' : '';
      const label = escapeHtml(visual.icon + ' ' + category.name);
      return `<option value="${category._id}"${selected}>${label}</option>`;
    })
  ].join('');
}

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isHistoryRangeActive() {
  return Boolean(state.historyRangeStart && state.historyRangeEnd);
}

function formatHistoryRangeLabel(startValue = '', endValue = '') {
  const start = new Date(`${startValue}T12:00:00`);
  const end = new Date(`${endValue}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '';
  }
  const fmt = new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

function syncHistoryRangeMonthInput(monthInput, active) {
  if (!monthInput) return;
  monthInput.disabled = active;
  monthInput.title = active ? 'Desactiva el rango para filtrar por mes' : '';
}

function syncHistoryRangeContextChip(context, active) {
  if (!context) return;
  const sourceLabel =
    state.historyRangeSource === 'dashboard' ? 'desde Resumen' : 'rango';
  const label = formatHistoryRangeLabel(
    state.historyRangeStart,
    state.historyRangeEnd
  );
  const fallbackLabel = `${state.historyRangeStart} - ${state.historyRangeEnd}`;

  context.style.display = active ? 'inline-flex' : 'none';
  if (!active) {
    context.textContent = '';
    return;
  }
  context.textContent = `${sourceLabel}: ${label || fallbackLabel}`;
}

function syncHistoryRangeButtons(resetRangeBtn, backBtn, active) {
  if (resetRangeBtn) {
    resetRangeBtn.style.display = active ? '' : 'none';
  }
  if (backBtn) {
    backBtn.style.display = active ? '' : 'none';
  }
}

function syncHistoryRangeUi() {
  const monthInput = $('historyMonth');
  const context = $('historyRangeContext');
  const resetRangeBtn = $('historyResetRangeBtn');
  const backBtn = $('historyBackDashboardBtn');
  const active = isHistoryRangeActive();
  syncHistoryRangeMonthInput(monthInput, active);
  syncHistoryRangeContextChip(context, active);
  syncHistoryRangeButtons(resetRangeBtn, backBtn, active);
}

function openHistoryFromDashboardCategory(categoryId, summary = {}) {
  const rangeStart = getDashboardDateInputValue(summary?.period_start || '');
  const rangeEnd = getDashboardDateInputValue(summary?.period_end || '');

  state.historyPendingCategoryId = String(categoryId || '').trim();
  state.historyRangeStart = rangeStart;
  state.historyRangeEnd = rangeEnd;
  state.historyRangeSource = 'dashboard';

  switchView('history', 'Historial');
}

function formatHistoryDayLabel(date) {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  }).format(date);
}

function renderHistoryGroup(dateKey, transactions = []) {
  const date = new Date(`${dateKey}T12:00:00`);
  const total = transactions.reduce((sum, tx) => {
    const amount = Number(tx.amount || 0);
    return sum + (tx.type === 'expense' ? -amount : amount);
  }, 0);
  const totalClass = total < 0 ? 'is-expense' : 'is-income';
  const totalLabel = `${total < 0 ? '-' : '+'}${Math.abs(total).toFixed(2)}€`;
  const itemsHtml = transactions
    .map((tx) => renderTxItem(tx, true, { selectable: true }))
    .join('');
  const isCollapsed = collapsedHistoryGroups.has(dateKey);

  return `
        <section class="history-group${isCollapsed ? ' is-collapsed' : ''}" data-history-date="${dateKey}">
          <button
            type="button"
            class="history-group-header history-group-toggle"
            data-history-toggle="${dateKey}"
            aria-expanded="${isCollapsed ? 'false' : 'true'}"
          >
            <div class="history-group-copy">
              <h4 class="history-group-title">${escapeHtml(formatHistoryDayLabel(date))}</h4>
              <p class="history-group-meta">${transactions.length} movimientos</p>
            </div>
            <div class="history-group-side">
              <span class="history-group-total ${totalClass}">${totalLabel}</span>
              <span class="history-group-chevron" aria-hidden="true">
                <i class="ph ph-caret-down"></i>
              </span>
            </div>
          </button>
          <div class="history-group-list">
            ${itemsHtml}
          </div>
        </section>
      `;
}

function applyHistoryGroupState(dateKey) {
  const group = document.querySelector(
    `[data-history-date="${CSS.escape(dateKey)}"]`
  );
  const toggle = document.querySelector(
    `[data-history-toggle="${CSS.escape(dateKey)}"]`
  );
  const isCollapsed = collapsedHistoryGroups.has(dateKey);

  if (group) {
    group.classList.toggle('is-collapsed', isCollapsed);
  }
  if (toggle) {
    toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  }
}

function getRenderedHistoryDates() {
  return Array.from(
    document.querySelectorAll('#txListFull [data-history-date]')
  )
    .map((element) => element.dataset.historyDate || '')
    .filter(Boolean);
}

function toggleHistoryGroup(dateKey) {
  if (!dateKey) return;

  if (collapsedHistoryGroups.has(dateKey)) {
    collapsedHistoryGroups.delete(dateKey);
  } else {
    collapsedHistoryGroups.add(dateKey);
  }

  applyHistoryGroupState(dateKey);
}

function setAllHistoryGroupsCollapsed(collapsed) {
  getRenderedHistoryDates().forEach((dateKey) => {
    if (collapsed) {
      collapsedHistoryGroups.add(dateKey);
    } else {
      collapsedHistoryGroups.delete(dateKey);
    }
    applyHistoryGroupState(dateKey);
  });
}

function resetHistoryFilters() {
  const accountFilter = $('historyAccountFilter');
  const categoryFilter = $('historyCategoryFilter');
  const minAmount = $('historyMinAmount');
  const maxAmount = $('historyMaxAmount');
  const searchInput = $('historySearchInput');

  setSelectedHistoryType('all');

  if (accountFilter) accountFilter.value = 'all';
  if (categoryFilter) categoryFilter.value = 'all';
  if (minAmount) minAmount.value = '';
  if (maxAmount) maxAmount.value = '';
  if (searchInput) searchInput.value = '';

  collapsedHistoryGroups.clear();
  loadHistoryView();
}

function getSelectedHistoryType() {
  const active = document.querySelector(
    '#historyTypeFilters .history-filter-btn.is-active'
  );
  return active?.dataset.historyType || 'all';
}

function setSelectedHistoryType(typeValue = 'all') {
  const typeFilters = $('historyTypeFilters');
  if (!typeFilters) return;

  typeFilters
    .querySelectorAll('.history-filter-btn')
    .forEach((item) => item.classList.remove('is-active'));

  const target = typeFilters.querySelector(
    `[data-history-type="${CSS.escape(typeValue)}"]`
  );
  const fallback = typeFilters.querySelector('[data-history-type="all"]');
  (target || fallback)?.classList.add('is-active');
}

function readHistoryFilterPresets() {
  try {
    const raw = localStorage.getItem(HISTORY_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string' && item.filters)
      .map((item) => ({
        name: String(item.name).trim(),
        filters: item.filters
      }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

function readHistoryRecentPresetNames() {
  try {
    const raw = localStorage.getItem(HISTORY_PRESET_RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function persistHistoryFilterPresets() {
  localStorage.setItem(
    HISTORY_PRESETS_STORAGE_KEY,
    JSON.stringify(historyFilterPresets)
  );
}

function persistHistoryRecentPresetNames() {
  localStorage.setItem(
    HISTORY_PRESET_RECENTS_STORAGE_KEY,
    JSON.stringify(historyRecentPresetNames)
  );
}

function readHistoryFavoritePresetName() {
  return String(
    localStorage.getItem(HISTORY_FAVORITE_PRESET_STORAGE_KEY) || ''
  ).trim();
}

function persistHistoryFavoritePresetName() {
  if (historyFavoritePresetName) {
    localStorage.setItem(
      HISTORY_FAVORITE_PRESET_STORAGE_KEY,
      historyFavoritePresetName
    );
    return;
  }
  localStorage.removeItem(HISTORY_FAVORITE_PRESET_STORAGE_KEY);
}

function readHistoryLastState() {
  try {
    const raw = localStorage.getItem(HISTORY_LAST_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      selectedMonth: String(parsed.selectedMonth || '').trim(),
      selectedType: String(parsed.selectedType || 'all').trim() || 'all',
      selectedAccountId: String(parsed.selectedAccountId || 'all').trim() || 'all',
      selectedCategoryId:
        String(parsed.selectedCategoryId || 'all').trim() || 'all',
      minAmount: String(parsed.minAmount || '').trim(),
      maxAmount: String(parsed.maxAmount || '').trim(),
      searchTerm: String(parsed.searchTerm || ''),
      rangeStart: String(parsed.rangeStart || '').trim(),
      rangeEnd: String(parsed.rangeEnd || '').trim(),
      rangeSource: String(parsed.rangeSource || '').trim(),
      selectedPresetName: String(parsed.selectedPresetName || '').trim()
    };
  } catch {
    return null;
  }
}

function buildHistoryLastState() {
  const snapshot = getCurrentHistoryFiltersSnapshot();
  let rangeSource = '';
  if (snapshot.rangeStart && snapshot.rangeEnd) {
    rangeSource = state.historyRangeSource || 'range';
    if (state.historyRangeSource === 'dashboard') {
      rangeSource = 'range';
    }
  }

  return {
    ...snapshot,
    selectedMonth: $('historyMonth')?.value || getCurrentMonthValue(),
    rangeSource,
    selectedPresetName: String($('historyPresetSelect')?.value || '').trim()
  };
}

function persistCurrentHistoryState() {
  localStorage.setItem(
    HISTORY_LAST_STATE_STORAGE_KEY,
    JSON.stringify(buildHistoryLastState())
  );
}

function restoreSavedHistoryState() {
  const saved = readHistoryLastState();
  if (!saved) return;

  const monthInput = $('historyMonth');
  if (monthInput && saved.selectedMonth) {
    monthInput.value = saved.selectedMonth;
  }

  applyHistoryFiltersSnapshot(saved);
  renderHistoryPresetSelect(saved.selectedPresetName || '');
  syncHistoryFilterActivityUi(saved);
}

function syncHistoryFavoritePresetButton() {
  const button = $('historyToggleFavoritePresetBtn');
  const selectedName = String($('historyPresetSelect')?.value || '').trim();
  if (!button) return;

  const hasSelection = Boolean(selectedName);
  button.disabled = !hasSelection;
  button.textContent =
    hasSelection && selectedName === historyFavoritePresetName
      ? 'Quitar favorito'
      : 'Marcar favorito';
}

function renderHistoryPresetChips() {
  const container = $('historyPresetChips');
  if (!container) return;

  const validNames = historyRecentPresetNames.filter((name) =>
    historyFilterPresets.some((preset) => preset.name === name)
  );
  historyRecentPresetNames = validNames;
  persistHistoryRecentPresetNames();

  if (!validNames.length) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  const chipsHtml = validNames
    .map(
      (name) => {
        const label =
          name === historyFavoritePresetName
            ? `[Favorito] ${escapeHtml(name)}`
            : escapeHtml(name);
        return `<button type="button" class="history-preset-chip" data-history-preset-chip="${escapeHtml(name)}">${label}</button>`;
      }
    )
    .join('');

  container.innerHTML = chipsHtml;
  container.style.display = '';
}

function touchRecentHistoryPreset(name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return;

  historyRecentPresetNames = historyRecentPresetNames.filter(
    (item) => item !== normalizedName
  );
  historyRecentPresetNames.unshift(normalizedName);
  historyRecentPresetNames = historyRecentPresetNames.slice(0, 8);
  persistHistoryRecentPresetNames();
  renderHistoryPresetChips();
}

function removeRecentHistoryPreset(name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return;
  historyRecentPresetNames = historyRecentPresetNames.filter(
    (item) => item !== normalizedName
  );
  persistHistoryRecentPresetNames();
  renderHistoryPresetChips();
}

function toggleFavoriteSelectedHistoryPreset() {
  const select = $('historyPresetSelect');
  if (!select) return;

  const selectedName = String(select.value || '').trim();
  if (!selectedName) {
    showAlert('Selecciona un filtro guardado', 'error');
    return;
  }

  historyFavoritePresetName =
    historyFavoritePresetName === selectedName ? '' : selectedName;
  persistHistoryFavoritePresetName();
  renderHistoryPresetSelect(selectedName);
  renderHistoryPresetChips();
  persistCurrentHistoryState();
  showAlert(
    historyFavoritePresetName === selectedName
      ? 'Filtro marcado como favorito'
      : 'Favorito eliminado',
    'success'
  );
}

function getCurrentHistoryFiltersSnapshot() {
  return {
    selectedType: getSelectedHistoryType(),
    selectedAccountId: $('historyAccountFilter')?.value || 'all',
    selectedCategoryId: $('historyCategoryFilter')?.value || 'all',
    minAmount: String($('historyMinAmount')?.value || '').trim(),
    maxAmount: String($('historyMaxAmount')?.value || '').trim(),
    searchTerm: String($('historySearchInput')?.value || ''),
    rangeStart: state.historyRangeStart || '',
    rangeEnd: state.historyRangeEnd || ''
  };
}

function countActiveHistoryFilters(snapshot = getCurrentHistoryFiltersSnapshot()) {
  let count = 0;
  if ((snapshot.selectedType || 'all') !== 'all') count += 1;
  if ((snapshot.selectedAccountId || 'all') !== 'all') count += 1;
  if ((snapshot.selectedCategoryId || 'all') !== 'all') count += 1;
  if (String(snapshot.minAmount || '').trim()) count += 1;
  if (String(snapshot.maxAmount || '').trim()) count += 1;
  if (String(snapshot.searchTerm || '').trim()) count += 1;
  if (snapshot.rangeStart && snapshot.rangeEnd) count += 1;
  return count;
}

function syncHistoryFilterActivityUi(snapshot = getCurrentHistoryFiltersSnapshot()) {
  const activeMeta = $('historyActiveFiltersMeta');
  const clearBtn = $('historyClearFiltersBtn');
  const activeCount = countActiveHistoryFilters(snapshot);

  if (activeMeta) {
    const pluralSuffix = activeCount === 1 ? '' : 's';
    activeMeta.style.display = activeCount > 0 ? '' : 'none';
    if (activeCount > 0) {
      activeMeta.textContent = `${activeCount} filtro${pluralSuffix} activo${pluralSuffix}`;
    } else {
      activeMeta.textContent = '';
    }
  }

  if (clearBtn) {
    clearBtn.classList.toggle('history-results-btn--attention', activeCount > 0);
    clearBtn.textContent =
      activeCount > 0 ? `Limpiar filtros (${activeCount})` : 'Limpiar filtros';
  }
}

function renderHistoryPresetSelect(selectedName = '') {
  const select = $('historyPresetSelect');
  if (!select) return;

  const options = ['<option value="">Filtros guardados</option>'];
  const orderedPresets = [...historyFilterPresets].sort((left, right) => {
    const leftFavorite = left.name === historyFavoritePresetName ? 1 : 0;
    const rightFavorite = right.name === historyFavoritePresetName ? 1 : 0;
    if (leftFavorite !== rightFavorite) return rightFavorite - leftFavorite;
    return left.name.localeCompare(right.name, 'es-ES');
  });

  orderedPresets.forEach((preset) => {
    const safeName = escapeHtml(preset.name);
    const label =
      preset.name === historyFavoritePresetName
        ? `[Favorito] ${safeName}`
        : safeName;
    options.push(`<option value="${safeName}">${label}</option>`);
  });
  select.innerHTML = options.join('');

  if (selectedName) {
    const hasOption = historyFilterPresets.some(
      (item) => item.name === selectedName
    );
    select.value = hasOption ? selectedName : '';
  }

  syncHistoryFavoritePresetButton();
}

function applyHistorySelectValue(select, candidateValue, pendingStateKey) {
  if (!select) return;

  const normalizedValue = String(candidateValue || 'all').trim() || 'all';
  const hasOption = select.querySelector(
    `option[value="${CSS.escape(normalizedValue)}"]`
  );
  select.value = hasOption ? normalizedValue : 'all';

  if (hasOption || normalizedValue === 'all') {
    state[pendingStateKey] = '';
    return;
  }
  state[pendingStateKey] = normalizedValue;
}

function applyHistoryFiltersSnapshot(snapshot = {}) {
  const monthInput = $('historyMonth');
  setSelectedHistoryType(snapshot.selectedType || 'all');

  const accountFilter = $('historyAccountFilter');
  const categoryFilter = $('historyCategoryFilter');
  const minAmount = $('historyMinAmount');
  const maxAmount = $('historyMaxAmount');
  const searchInput = $('historySearchInput');

  if (monthInput && snapshot.selectedMonth) {
    monthInput.value = snapshot.selectedMonth;
  }
  applyHistorySelectValue(
    accountFilter,
    snapshot.selectedAccountId,
    'historyPendingAccountId'
  );
  applyHistorySelectValue(
    categoryFilter,
    snapshot.selectedCategoryId,
    'historyPendingCategoryId'
  );
  if (minAmount) minAmount.value = snapshot.minAmount || '';
  if (maxAmount) maxAmount.value = snapshot.maxAmount || '';
  if (searchInput) searchInput.value = snapshot.searchTerm || '';

  const hasRange = Boolean(snapshot.rangeStart && snapshot.rangeEnd);
  if (hasRange) {
    state.historyRangeStart = snapshot.rangeStart;
    state.historyRangeEnd = snapshot.rangeEnd;
    state.historyRangeSource = snapshot.rangeSource || 'preset';
  } else {
    state.historyRangeStart = '';
    state.historyRangeEnd = '';
    state.historyRangeSource = '';
  }
  syncHistoryRangeUi();
}

function saveCurrentHistoryPreset() {
  const presetName = String(
    prompt('Nombre para este filtro guardado:') || ''
  ).trim();
  if (!presetName) return;

  saveHistoryPresetWithName(presetName, 'Filtro guardado');
}

function saveHistoryPresetWithName(presetName, successMessage = 'Filtro guardado') {
  const normalizedName = String(presetName || '').trim();
  if (!normalizedName) return;

  const snapshot = getCurrentHistoryFiltersSnapshot();
  const existingIndex = historyFilterPresets.findIndex(
    (item) => item.name.toLowerCase() === normalizedName.toLowerCase()
  );

  if (existingIndex >= 0) {
    historyFilterPresets[existingIndex] = {
      name: historyFilterPresets[existingIndex].name,
      filters: snapshot
    };
  } else {
    historyFilterPresets.push({ name: normalizedName, filters: snapshot });
    historyFilterPresets.sort((left, right) =>
      left.name.localeCompare(right.name, 'es-ES')
    );
  }

  persistHistoryFilterPresets();
  renderHistoryPresetSelect(normalizedName);
  touchRecentHistoryPreset(normalizedName);
  persistCurrentHistoryState();
  showAlert(successMessage, 'success');
}

function buildQuickHistoryPresetName() {
  const now = new Date();
  const datePart = now.toLocaleDateString('es-ES');
  const timePart = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `Filtro rápido ${datePart} ${timePart}`;
}

function saveQuickHistoryPreset() {
  let candidateName = buildQuickHistoryPresetName();
  let suffix = 2;
  while (
    historyFilterPresets.some((item) => item.name.toLowerCase() === candidateName.toLowerCase())
  ) {
    candidateName = `${buildQuickHistoryPresetName()} #${suffix}`;
    suffix += 1;
  }
  saveHistoryPresetWithName(candidateName, 'Filtro guardado rápido');
}

function applySelectedHistoryPreset() {
  const select = $('historyPresetSelect');
  if (!select) return;
  const selectedName = String(select.value || '').trim();
  if (!selectedName) return;

  const preset = historyFilterPresets.find((item) => item.name === selectedName);
  if (!preset?.filters) return;

  applyHistoryFiltersSnapshot(preset.filters);
  touchRecentHistoryPreset(selectedName);
  loadHistoryView();
}

function deleteSelectedHistoryPreset() {
  const select = $('historyPresetSelect');
  if (!select) return;
  const selectedName = String(select.value || '').trim();
  if (!selectedName) {
    showAlert('Selecciona un filtro guardado', 'error');
    return;
  }

  historyFilterPresets = historyFilterPresets.filter(
    (item) => item.name !== selectedName
  );
  persistHistoryFilterPresets();
  removeRecentHistoryPreset(selectedName);
  if (historyFavoritePresetName === selectedName) {
    historyFavoritePresetName = '';
    persistHistoryFavoritePresetName();
  }
  renderHistoryPresetSelect('');
  persistCurrentHistoryState();
  showAlert('Filtro borrado', 'success');
}

function renameSelectedHistoryPreset() {
  const select = $('historyPresetSelect');
  if (!select) return;

  const selectedName = String(select.value || '').trim();
  if (!selectedName) {
    showAlert('Selecciona un filtro guardado', 'error');
    return;
  }

  const newName = String(
    prompt('Nuevo nombre para el filtro:', selectedName) || ''
  ).trim();
  if (!newName || newName === selectedName) return;

  const duplicate = historyFilterPresets.some(
    (item) =>
      item.name.toLowerCase() === newName.toLowerCase() && item.name !== selectedName
  );
  if (duplicate) {
    showAlert('Ya existe un filtro con ese nombre', 'error');
    return;
  }

  historyFilterPresets = historyFilterPresets.map((item) => {
    if (item.name !== selectedName) return item;
    return {
      name: newName,
      filters: item.filters
    };
  });
  historyFilterPresets.sort((left, right) =>
    left.name.localeCompare(right.name, 'es-ES')
  );

  historyRecentPresetNames = historyRecentPresetNames.map((item) =>
    item === selectedName ? newName : item
  );
  if (historyFavoritePresetName === selectedName) {
    historyFavoritePresetName = newName;
  }

  persistHistoryFilterPresets();
  persistHistoryRecentPresetNames();
  persistHistoryFavoritePresetName();
  renderHistoryPresetSelect(newName);
  renderHistoryPresetChips();
  persistCurrentHistoryState();
  showAlert('Filtro renombrado', 'success');
}

function duplicateSelectedHistoryPreset() {
  const select = $('historyPresetSelect');
  if (!select) return;

  const selectedName = String(select.value || '').trim();
  if (!selectedName) {
    showAlert('Selecciona un filtro guardado', 'error');
    return;
  }

  const sourcePreset = historyFilterPresets.find(
    (item) => item.name === selectedName
  );
  if (!sourcePreset?.filters) return;

  let candidateName = `${selectedName} (copia)`;
  let suffix = 2;
  while (
    historyFilterPresets.some(
      (item) => item.name.toLowerCase() === candidateName.toLowerCase()
    )
  ) {
    candidateName = `${selectedName} (copia ${suffix})`;
    suffix += 1;
  }

  const copiedFilters = {
    ...sourcePreset.filters
  };
  historyFilterPresets.push({
    name: candidateName,
    filters: copiedFilters
  });
  historyFilterPresets.sort((left, right) =>
    left.name.localeCompare(right.name, 'es-ES')
  );

  persistHistoryFilterPresets();
  renderHistoryPresetSelect(candidateName);
  touchRecentHistoryPreset(candidateName);
  persistCurrentHistoryState();
  showAlert('Filtro duplicado', 'success');
}

async function exportSelectedHistoryPresetToCSV() {
  const select = $('historyPresetSelect');
  if (!select) return;

  const selectedName = String(select.value || '').trim();
  if (!selectedName) {
    showAlert('Selecciona un filtro guardado', 'error');
    return;
  }

  const preset = historyFilterPresets.find((item) => item.name === selectedName);
  const snapshot = preset?.filters;
  if (!snapshot) {
    showAlert('No se pudo cargar ese filtro guardado', 'error');
    return;
  }

  await Promise.all([ensureAccountsLoaded(), ensureCategoriesLoaded()]);

  const selectedMonth = snapshot.selectedMonth || getCurrentMonthValue();
  const hasRange = Boolean(snapshot.rangeStart && snapshot.rangeEnd);
  const rangeStart = hasRange
    ? new Date(`${snapshot.rangeStart}T00:00:00`)
    : null;
  const rangeEndExclusive = hasRange
    ? new Date(`${snapshot.rangeEnd}T00:00:00`)
    : null;
  if (rangeEndExclusive && !Number.isNaN(rangeEndExclusive.getTime())) {
    rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1);
  }

  const minAmount = String(snapshot.minAmount || '').trim()
    ? Number.parseFloat(String(snapshot.minAmount).trim())
    : null;
  const rawMaxAmount = String(snapshot.maxAmount || '').trim()
    ? Number.parseFloat(String(snapshot.maxAmount).trim())
    : null;
  const maxAmount =
    minAmount !== null && rawMaxAmount !== null && minAmount > rawMaxAmount
      ? minAmount
      : rawMaxAmount;

  const accountLookup = new Map();
  state.accounts.forEach((account) => {
    accountLookup.set(String(account.id), account.name);
    accountLookup.set(String(account.name), account.name);
  });

  const selectedAccountId = snapshot.selectedAccountId || 'all';
  const selectedAccount = state.accounts.find(
    (account) => account.id === selectedAccountId
  );
  const allTransactions = await fetchAllTransactions(
    hasRange
      ? {
          start_date: snapshot.rangeStart,
          end_date: snapshot.rangeEnd
        }
      : { month: selectedMonth }
  );

  const filters = {
    selectedMonth,
    rangeStart,
    rangeEndExclusive,
    selectedType: snapshot.selectedType || 'all',
    selectedAccountId,
    selectedAccountName: selectedAccount?.name || '',
    selectedCategoryId: snapshot.selectedCategoryId || 'all',
    minAmount,
    maxAmount,
    searchTerm: String(snapshot.searchTerm || '').trim().toLocaleLowerCase('es-ES'),
    accountLookup
  };

  const filtered = sortTransactionsByMostRecent(
    allTransactions.filter((tx) => matchesHistoryFilters(tx, filters))
  );

  exportHistoryToCSV(filtered, `preset-${selectedName}`);
  touchRecentHistoryPreset(selectedName);
}

async function copyTextToClipboard(text) {
  const normalizedText = String(text || '');
  if (!normalizedText) return false;

  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(normalizedText);
  return true;
}

async function readTextFromClipboardOrPrompt() {
  let clipboardText = '';
  if (navigator.clipboard?.readText) {
    try {
      clipboardText = String(await navigator.clipboard.readText() || '').trim();
    } catch {
      clipboardText = '';
    }
  }

  if (clipboardText) return clipboardText;
  return String(
    prompt('Pega aquí el texto del filtro:') || ''
  ).trim();
}

function getHistoryTypeLabel(typeValue = 'all') {
  if (typeValue === 'expense') return 'Gastos';
  if (typeValue === 'income') return 'Ingresos';
  return 'Todos';
}

function getHistoryAccountLabel(accountId = 'all') {
  if (!accountId || accountId === 'all') return 'Todas las cuentas';
  const account = state.accounts.find((item) => String(item.id) === String(accountId));
  return account?.name || accountId;
}

function getHistoryCategoryLabel(categoryId = 'all') {
  if (!categoryId || categoryId === 'all') return 'Todas las categorías';
  const category = state.catsById.get(categoryId);
  if (!category) return categoryId;
  const parent = category.parent_id ? state.catsById.get(category.parent_id) : null;
  return parent ? `${parent.name} > ${category.name}` : category.name;
}

function normalizeFilterLabelKey(key = '') {
  return String(key || '')
    .trim()
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolveHistoryTypeFromLabel(value = '') {
  const normalized = String(value || '').trim().toLocaleLowerCase('es-ES');
  if (normalized === 'gastos' || normalized === 'gasto') return 'expense';
  if (normalized === 'ingresos' || normalized === 'ingreso') return 'income';
  return 'all';
}

function resolveAccountIdFromLabel(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || normalizeFilterLabelKey(normalized) === 'todas las cuentas') {
    return 'all';
  }

  const exactMatch = state.accounts.find(
    (account) => String(account.name || '').trim() === normalized
  );
  if (exactMatch) return String(exactMatch.id || 'all');

  const lowerMatch = state.accounts.find(
    (account) =>
      String(account.name || '').trim().toLocaleLowerCase('es-ES') ===
      normalized.toLocaleLowerCase('es-ES')
  );
  return lowerMatch ? String(lowerMatch.id || 'all') : 'all';
}

function resolveCategoryIdFromLabel(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || normalizeFilterLabelKey(normalized) === 'todas las categorias') {
    return 'all';
  }

  const parts = normalized.split('>').map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const parentName = parts[0].toLocaleLowerCase('es-ES');
    const childName = parts[parts.length - 1].toLocaleLowerCase('es-ES');
    for (const category of state.catsById.values()) {
      const categoryName = String(category?.name || '').toLocaleLowerCase('es-ES');
      if (categoryName !== childName) continue;
      const parent = category.parent_id ? state.catsById.get(category.parent_id) : null;
      const parentLabel = String(parent?.name || '').toLocaleLowerCase('es-ES');
      if (parent && parentLabel === parentName) {
        return String(category._id || 'all');
      }
    }
  }

  for (const category of state.catsById.values()) {
    if (String(category?.name || '').trim() === normalized) {
      return String(category._id || 'all');
    }
  }

  const lower = normalized.toLocaleLowerCase('es-ES');
  for (const category of state.catsById.values()) {
    if (String(category?.name || '').toLocaleLowerCase('es-ES') === lower) {
      return String(category._id || 'all');
    }
  }

  return 'all';
}

function parseAmountFilterValue(rawValue = '') {
  const cleaned = String(rawValue || '')
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .trim();
  if (!cleaned) return '';
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? String(parsed) : '';
}

function parseHistoryFilterSummaryText(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const snapshot = {
    selectedMonth: getCurrentMonthValue(),
    selectedType: 'all',
    selectedAccountId: 'all',
    selectedCategoryId: 'all',
    minAmount: '',
    maxAmount: '',
    searchTerm: '',
    rangeStart: '',
    rangeEnd: '',
    rangeSource: ''
  };
  let presetName = '';
  const unresolved = [];

  lines.forEach((line) => {
    if (!line.includes(':')) {
      return;
    }

    const separatorIndex = line.indexOf(':');
    const key = normalizeFilterLabelKey(line.slice(0, separatorIndex));
    const value = String(line.slice(separatorIndex + 1) || '').trim();
    if (!value) return;

    if (key === 'preset') {
      presetName = value;
      return;
    }
    if (key === 'mes') {
      if (/^\d{4}-\d{2}$/.test(value)) {
        snapshot.selectedMonth = value;
      }
      return;
    }
    if (key === 'rango') {
      const match = value.match(/^(\d{4}-\d{2}-\d{2})\s+a\s+(\d{4}-\d{2}-\d{2})$/i);
      if (match) {
        snapshot.rangeStart = match[1];
        snapshot.rangeEnd = match[2];
        snapshot.rangeSource = 'pasted';
      }
      return;
    }
    if (key === 'tipo') {
      snapshot.selectedType = resolveHistoryTypeFromLabel(value);
      return;
    }
    if (key === 'cuenta') {
      const resolvedAccountId = resolveAccountIdFromLabel(value);
      const isAllAccounts =
        normalizeFilterLabelKey(value) === 'todas las cuentas';
      if (resolvedAccountId === 'all' && !isAllAccounts) {
        unresolved.push(`Cuenta no encontrada: ${value}`);
      }
      snapshot.selectedAccountId = resolvedAccountId;
      return;
    }
    if (key === 'categoria') {
      const resolvedCategoryId = resolveCategoryIdFromLabel(value);
      const isAllCategories =
        normalizeFilterLabelKey(value) === 'todas las categorias';
      if (resolvedCategoryId === 'all' && !isAllCategories) {
        unresolved.push(`Categoría no encontrada: ${value}`);
      }
      snapshot.selectedCategoryId = resolvedCategoryId;
      return;
    }
    if (key === 'importe minimo') {
      snapshot.minAmount = parseAmountFilterValue(value);
      return;
    }
    if (key === 'importe maximo') {
      snapshot.maxAmount = parseAmountFilterValue(value);
      return;
    }
    if (key === 'busqueda') {
      snapshot.searchTerm = value;
    }
  });

  return {
    snapshot,
    presetName,
    unresolved
  };
}

function buildHistoryFilterSummary(snapshot = {}, presetName = '') {
  const selectedMonth = snapshot.selectedMonth || $('historyMonth')?.value || getCurrentMonthValue();
  const hasRange = Boolean(snapshot.rangeStart && snapshot.rangeEnd);
  const baseLines = [
    presetName ? `Preset: ${presetName}` : 'Filtro actual del historial',
    hasRange
      ? `Rango: ${snapshot.rangeStart} a ${snapshot.rangeEnd}`
      : `Mes: ${selectedMonth}`,
    `Tipo: ${getHistoryTypeLabel(snapshot.selectedType || 'all')}`,
    `Cuenta: ${getHistoryAccountLabel(snapshot.selectedAccountId || 'all')}`,
    `Categoría: ${getHistoryCategoryLabel(snapshot.selectedCategoryId || 'all')}`
  ];
  const minLine = String(snapshot.minAmount || '').trim()
    ? [`Importe mínimo: ${String(snapshot.minAmount).trim()}€`]
    : [];
  const maxLine = String(snapshot.maxAmount || '').trim()
    ? [`Importe máximo: ${String(snapshot.maxAmount).trim()}€`]
    : [];
  const searchLine = String(snapshot.searchTerm || '').trim()
    ? [`Búsqueda: ${String(snapshot.searchTerm).trim()}`]
    : [];

  return [...baseLines, ...minLine, ...maxLine, ...searchLine].join('\n');
}

async function copyCurrentOrSelectedHistoryFilter() {
  await Promise.all([ensureAccountsLoaded(), ensureCategoriesLoaded()]);

  const selectedName = String($('historyPresetSelect')?.value || '').trim();
  const preset = selectedName
    ? historyFilterPresets.find((item) => item.name === selectedName)
    : null;

  const snapshot = preset?.filters
    ? {
        ...preset.filters,
        selectedMonth: preset.filters.selectedMonth || $('historyMonth')?.value || getCurrentMonthValue()
      }
    : buildHistoryLastState();
  const summary = buildHistoryFilterSummary(snapshot, preset?.name || '');
  const copied = await copyTextToClipboard(summary);

  if (!copied) {
    prompt('Tu navegador no permite copiar automáticamente. Copia este texto:', summary);
    showAlert('Copia manual mostrada', 'info');
    return;
  }

  if (preset?.name) {
    touchRecentHistoryPreset(preset.name);
  }
  showAlert('Filtro copiado', 'success');
}

async function pasteHistoryFilterFromText() {
  await Promise.all([
    ensureAccountsLoaded(),
    ensureCategoriesLoaded(),
    populateHistoryAccountFilter(),
    populateHistoryCategoryFilter()
  ]);

  const text = await readTextFromClipboardOrPrompt();
  if (!text) {
    showAlert('No hay texto para aplicar', 'error');
    return;
  }

  const parsed = parseHistoryFilterSummaryText(text);
  if (!parsed) {
    showAlert('Formato de filtro no válido', 'error');
    return;
  }

  const unresolved = [...(parsed.unresolved || [])];
  const presetMatch = parsed.presetName
    ? historyFilterPresets.find(
        (item) =>
          item.name.toLocaleLowerCase('es-ES') ===
          parsed.presetName.toLocaleLowerCase('es-ES')
      )
    : null;
  if (parsed.presetName && !presetMatch) {
    unresolved.push(`Preset no encontrado: ${parsed.presetName}`);
  }

  const preview = buildHistoryFilterSummary(
    parsed.snapshot,
    parsed.presetName || ''
  );
  const unresolvedBlock = unresolved.length
    ? `\n\nAvisos:\n- ${unresolved.join('\n- ')}`
    : '';
  const accepted = confirm(
    `Se aplicará este filtro:\n\n${preview}${unresolvedBlock}\n\n¿Continuar?`
  );
  if (!accepted) {
    showAlert('Pegado cancelado', 'info');
    return;
  }

  applyHistoryFiltersSnapshot(parsed.snapshot);
  renderHistoryPresetSelect(presetMatch?.name || '');
  if (presetMatch?.name) {
    touchRecentHistoryPreset(presetMatch.name);
  }

  persistCurrentHistoryState();
  syncHistoryFilterActivityUi(parsed.snapshot);
  loadHistoryView();
  showAlert('Filtro pegado', 'success');
}

function applyHistoryPresetByName(name) {
  const select = $('historyPresetSelect');
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return;
  if (select) select.value = normalizedName;
  applySelectedHistoryPreset();
}

function getHistorySearchTerm() {
  return String($('historySearchInput')?.value || '')
    .trim()
    .toLocaleLowerCase('es-ES');
}

function getHistoryAmountValue(id) {
  const rawValue = String($(id)?.value || '').trim();
  if (!rawValue) return null;

  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function scheduleHistoryReload() {
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    loadHistoryView();
  }, 140);
}

async function ensureAccountsLoaded() {
  if (state.accounts.length > 0) return state.accounts;
  const accounts = await api('/accounts');
  state.accounts = accounts || [];
  return state.accounts;
}

async function ensureCategoriesLoaded() {
  if (state.tree.length > 0 && state.catsById.size > 0) return;
  await loadCategoryTree();
}

async function populateHistoryAccountFilter() {
  const select = $('historyAccountFilter');
  if (!select) return;

  const currentValue = state.historyPendingAccountId || select.value || 'all';
  const accounts = await ensureAccountsLoaded();
  select.innerHTML = '<option value="all">Todas las cuentas</option>';
  accounts.forEach((account) => {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = account.name;
    select.appendChild(option);
  });
  select.value = accounts.some((account) => account.id === currentValue)
    ? currentValue
    : 'all';
  state.historyPendingAccountId = '';
}

async function populateHistoryCategoryFilter() {
  const select = $('historyCategoryFilter');
  if (!select) return;

  const currentValue = state.historyPendingCategoryId || select.value || 'all';
  await ensureCategoriesLoaded();

  const options = ['<option value="all">Todas las categorías</option>'];
  for (const section of state.tree || []) {
    for (const category of section.categories || []) {
      const visual = getCategoryVisual(category);
      const categoryLabel = `${visual.icon} ${visual.name}`;
      options.push(
        `<option value="${category._id}">${escapeHtml(categoryLabel)}</option>`
      );
      for (const subcategory of category.subcategories || []) {
        const subVisual = getCategoryVisual(
          subcategory,
          visual.icon,
          visual.color
        );
        const subcategoryLabel = `↳ ${subVisual.icon} ${subcategory.name}`;
        options.push(
          `<option value="${subcategory._id}">${escapeHtml(subcategoryLabel)}</option>`
        );
      }
    }
  }

  select.innerHTML = options.join('');
  select.value = select.querySelector(
    `option[value="${CSS.escape(currentValue)}"]`
  )
    ? currentValue
    : 'all';
  state.historyPendingCategoryId = '';
}

function matchesHistoryCategory(tx, selectedCategoryId) {
  if (selectedCategoryId === 'all') return true;
  if (tx.category_id === selectedCategoryId) return true;
  if (tx.subcategory_id === selectedCategoryId) return true;

  const subcategory = tx.subcategory_id
    ? state.catsById.get(tx.subcategory_id)
    : null;
  return String(subcategory?.parent_id || '') === String(selectedCategoryId);
}

function matchesHistoryAccount(
  tx,
  selectedAccountId,
  selectedAccountName = ''
) {
  if (selectedAccountId === 'all') return true;
  const accountId = tx.account_id || '';
  return accountId === selectedAccountId || accountId === selectedAccountName;
}

function matchesHistorySearch(tx, searchTerm, accountLookup) {
  if (!searchTerm) return true;

  const category = state.catsById.get(tx.category_id);
  const subcategory = tx.subcategory_id
    ? state.catsById.get(tx.subcategory_id)
    : null;
  const haystack = [
    tx.note || '',
    category?.name || '',
    subcategory?.name || '',
    accountLookup.get(String(tx.account_id || '')) || '',
    tx.type === 'expense' ? 'gasto' : 'ingreso',
    Number(tx.amount || 0).toFixed(2)
  ]
    .join(' ')
    .toLocaleLowerCase('es-ES');

  return haystack.includes(searchTerm);
}

function matchesHistoryAmount(tx, minAmount, maxAmount) {
  const amount = Number(tx.amount || 0);
  if (minAmount !== null && amount < minAmount) return false;
  if (maxAmount !== null && amount > maxAmount) return false;
  return true;
}

function matchesHistoryFilters(tx, filters) {
  const date = new Date(tx.date);
  if (Number.isNaN(date.getTime())) return false;

  if (filters.rangeStart && filters.rangeEndExclusive) {
    if (date < filters.rangeStart || date >= filters.rangeEndExclusive) {
      return false;
    }
  } else {
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (yearMonth !== filters.selectedMonth) return false;
  }

  if (filters.selectedType !== 'all' && tx.type !== filters.selectedType) {
    return false;
  }
  if (
    !matchesHistoryAccount(
      tx,
      filters.selectedAccountId,
      filters.selectedAccountName
    )
  ) {
    return false;
  }
  if (!matchesHistoryCategory(tx, filters.selectedCategoryId)) return false;
  if (!matchesHistoryAmount(tx, filters.minAmount, filters.maxAmount)) {
    return false;
  }
  return matchesHistorySearch(tx, filters.searchTerm, filters.accountLookup);
}

function updateHistoryResultsMeta(transactions = [], selectedMonth = '') {
  const meta = $('historyResultsMeta');
  const selectionMeta = $('historySelectionMeta');
  if (!meta) return;

  const categoryCount = new Set(
    transactions.map((tx) => String(tx.subcategory_id || tx.category_id || ''))
  ).size;
  const monthDate = selectedMonth
    ? new Date(`${selectedMonth}-01T12:00:00`)
    : null;
  let monthLabel =
    monthDate && !Number.isNaN(monthDate.getTime())
      ? monthDate.toLocaleDateString('es-ES', {
          month: 'long',
          year: 'numeric'
        })
      : 'este periodo';

  if (isHistoryRangeActive()) {
    monthLabel = formatHistoryRangeLabel(
      state.historyRangeStart,
      state.historyRangeEnd
    );
  }

  meta.textContent = `${transactions.length} movimientos · ${categoryCount} categorías · ${monthLabel}`;
  if (selectionMeta) {
    const selectedCount = getSelectedHistoryTransactions().length;
    selectionMeta.style.display = selectedCount > 0 ? '' : 'none';
    selectionMeta.textContent = selectedCount > 0 ? `${selectedCount} seleccionados` : '';
  }
  syncHistoryFilterActivityUi();
}

function pruneHistorySelection(transactions = []) {
  const availableIds = new Set(transactions.map((tx) => String(tx._id || '')));
  Array.from(historySelectedTxIds).forEach((id) => {
    if (!availableIds.has(id)) historySelectedTxIds.delete(id);
  });
}

function getSelectedHistoryTransactions() {
  return historyFilteredTxns.filter((tx) => historySelectedTxIds.has(String(tx._id)));
}

function clearHistorySelection() {
  historySelectedTxIds.clear();
  updateHistoryResultsMeta(
    historyFilteredTxns,
    $('historyMonth')?.value || getCurrentMonthValue()
  );
  renderHistoryPage();
}

function toggleHistorySelection(txId, isSelected) {
  const normalizedId = String(txId || '').trim();
  if (!normalizedId) return;
  if (isSelected) {
    historySelectedTxIds.add(normalizedId);
  } else {
    historySelectedTxIds.delete(normalizedId);
  }
  updateHistoryResultsMeta(
    historyFilteredTxns,
    $('historyMonth')?.value || getCurrentMonthValue()
  );
}

function resetHistoryRangeAndReload() {
  state.historyRangeStart = '';
  state.historyRangeEnd = '';
  state.historyRangeSource = '';
  syncHistoryRangeUi();
  loadHistoryView();
}

function bindHistorySelectionActions({
  historySelectVisibleBtn,
  historyClearSelectionBtn,
  historyExportSelectionBtn
}) {
  if (historySelectVisibleBtn) {
    historySelectVisibleBtn.addEventListener('click', () => {
      selectVisibleHistoryTransactions();
    });
  }
  if (historyClearSelectionBtn) {
    historyClearSelectionBtn.addEventListener('click', () => {
      clearHistorySelection();
    });
  }
  if (historyExportSelectionBtn) {
    historyExportSelectionBtn.addEventListener('click', () => {
      const selectedTransactions = getSelectedHistoryTransactions();
      const monthLabel = $('historyMonth')?.value || getCurrentMonthValue();
      if (!selectedTransactions.length) {
        showAlert('Selecciona al menos un movimiento', 'error');
        return;
      }
      exportHistoryToCSV(selectedTransactions, `${monthLabel}-seleccion`);
    });
  }
}

function bindHistoryRangeActions({
  historyResetRangeBtn,
  historyBackDashboardBtn
}) {
  if (historyResetRangeBtn) {
    historyResetRangeBtn.addEventListener('click', () => {
      resetHistoryRangeAndReload();
    });
  }
  if (historyBackDashboardBtn) {
    historyBackDashboardBtn.addEventListener('click', () => {
      switchView('dashboard', 'Resumen');
    });
  }
}

function bindHistoryFilterInputs({
  historyMonth,
  historyAccountFilter,
  historyCategoryFilter,
  historyMinAmount,
  historyMaxAmount,
  historySearchInput,
  historyClearFiltersBtn,
  historyCollapseAllBtn,
  historyExpandAllBtn
}) {
  if (historyMonth) {
    historyMonth.addEventListener('change', () => {
      if (isHistoryRangeActive()) return;
      loadHistoryView();
    });
  }
  if (historyAccountFilter) {
    historyAccountFilter.addEventListener('change', () => {
      loadHistoryView();
    });
  }
  if (historyCategoryFilter) {
    historyCategoryFilter.addEventListener('change', () => {
      loadHistoryView();
    });
  }
  if (historyMinAmount) {
    historyMinAmount.addEventListener('input', () => {
      scheduleHistoryReload();
    });
  }
  if (historyMaxAmount) {
    historyMaxAmount.addEventListener('input', () => {
      scheduleHistoryReload();
    });
  }
  if (historySearchInput) {
    historySearchInput.addEventListener('input', () => {
      scheduleHistoryReload();
    });
  }
  if (historyClearFiltersBtn) {
    historyClearFiltersBtn.addEventListener('click', () => {
      resetHistoryFilters();
    });
  }
  if (historyCollapseAllBtn) {
    historyCollapseAllBtn.addEventListener('click', () => {
      setAllHistoryGroupsCollapsed(true);
    });
  }
  if (historyExpandAllBtn) {
    historyExpandAllBtn.addEventListener('click', () => {
      setAllHistoryGroupsCollapsed(false);
    });
  }
}

function handleHistoryListClick(event) {
  const selector = event.target.closest('.tx-select, .tx-select-input');
  if (selector) return;

  const quickEditBtn = event.target.closest('[data-history-edit-id]');
  if (quickEditBtn) {
    const txId = quickEditBtn.dataset.historyEditId || '';
    if (txId) {
      openViewTx(txId).then(() => {
        const btnEdit = $('btnEditTx');
        if (btnEdit && btnEdit.style.display !== 'none') {
          btnEdit.click();
        }
      });
    }
    return;
  }

  const loadMoreBtn = event.target.closest('#historyLoadMoreBtn');
  if (loadMoreBtn) {
    historyVisibleCount += HISTORY_PAGE_SIZE;
    renderHistoryPage();
    return;
  }

  const clearEmptyBtn = event.target.closest('[data-history-empty-clear]');
  if (clearEmptyBtn) {
    resetHistoryFilters();
    return;
  }

  const resetRangeEmptyBtn = event.target.closest('[data-history-reset-range]');
  if (resetRangeEmptyBtn) {
    resetHistoryRangeAndReload();
    return;
  }

  const toggleBtn = event.target.closest('[data-history-toggle]');
  if (toggleBtn) {
    toggleHistoryGroup(toggleBtn.dataset.historyToggle || '');
    return;
  }

  const txItem = event.target.closest('.tx-item');
  if (txItem) {
    const id = txItem.dataset.id;
    openViewTx(id);
  }
}

function handleHistoryListChange(event) {
  const input = event.target.closest('[data-history-select]');
  if (!input) return;
  toggleHistorySelection(input.dataset.historySelect || '', input.checked);
  const txItem = input.closest('.tx-item');
  if (txItem) {
    txItem.classList.toggle('is-selected', input.checked);
  }
}

function selectVisibleHistoryTransactions() {
  const visibleIds = Array.from(
    document.querySelectorAll('#txListFull .tx-item[data-id]')
  ).map((item) => String(item.dataset.id || '').trim()).filter(Boolean);

  visibleIds.forEach((id) => historySelectedTxIds.add(id));
  updateHistoryResultsMeta(
    historyFilteredTxns,
    $('historyMonth')?.value || getCurrentMonthValue()
  );
  renderHistoryPage();
}

function updateHistorySummary(transactions = []) {
  const income = transactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const expense = transactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const balance = income - expense;
  const totalMovements = transactions.length;
  const totalAmount = transactions.reduce(
    (sum, tx) => sum + Number(tx.amount || 0),
    0
  );
  const averageMovement = totalMovements > 0 ? totalAmount / totalMovements : 0;
  const maxExpense = transactions
    .filter((tx) => tx.type === 'expense')
    .reduce((max, tx) => Math.max(max, Number(tx.amount || 0)), 0);

  const elBal = $('historySummaryBalance');
  const elInc = $('historySummaryIncome');
  const elExp = $('historySummaryExpense');
  const elCnt = $('historySummaryCount');
  const elAvg = $('historySummaryAvg');
  const elMaxExpense = $('historySummaryMaxExpense');
  const elFilteredTotal = $('historySummaryFilteredTotal');
  if (elBal) elBal.textContent = `${balance.toFixed(2)}€`;
  if (elInc) elInc.textContent = `${income.toFixed(2)}€`;
  if (elExp) elExp.textContent = `${expense.toFixed(2)}€`;
  if (elCnt) elCnt.textContent = String(transactions.length);
  if (elAvg) elAvg.textContent = `${averageMovement.toFixed(2)}€`;
  if (elMaxExpense) elMaxExpense.textContent = `${maxExpense.toFixed(2)}€`;
  if (elFilteredTotal) elFilteredTotal.textContent = `${totalAmount.toFixed(2)}€`;
}

async function loadHistoryView() {
  const txListFull = $('txListFull');
  const monthInput = $('historyMonth');
  const accountFilter = $('historyAccountFilter');
  const categoryFilter = $('historyCategoryFilter');
  const minAmountInput = $('historyMinAmount');
  const maxAmountInput = $('historyMaxAmount');
  if (!txListFull) return;

  if (monthInput && !monthInput.value) {
    monthInput.value = getCurrentMonthValue();
  }

  await Promise.all([
    populateHistoryAccountFilter(),
    populateHistoryCategoryFilter()
  ]);

  if (categoryFilter && state.historyPendingCategoryId) {
    const pending = state.historyPendingCategoryId;
    const hasOption = categoryFilter.querySelector(
      `option[value="${CSS.escape(pending)}"]`
    );
    categoryFilter.value = hasOption ? pending : 'all';
    state.historyPendingCategoryId = '';
  }
  if (accountFilter && state.historyPendingAccountId) {
    const pending = state.historyPendingAccountId;
    const hasOption = accountFilter.querySelector(
      `option[value="${CSS.escape(pending)}"]`
    );
    accountFilter.value = hasOption ? pending : 'all';
    state.historyPendingAccountId = '';
  }

  syncHistoryRangeUi();

  const selectedMonth = monthInput?.value || getCurrentMonthValue();
  const rangeActive = isHistoryRangeActive();
  const rangeStart = rangeActive
    ? new Date(`${state.historyRangeStart}T00:00:00`)
    : null;
  const rangeEndExclusive = rangeActive
    ? new Date(`${state.historyRangeEnd}T00:00:00`)
    : null;
  if (rangeEndExclusive && !Number.isNaN(rangeEndExclusive.getTime())) {
    rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1);
  }

  const selectedType = getSelectedHistoryType();
  const selectedAccountId = accountFilter?.value || 'all';
  const selectedCategoryId = categoryFilter?.value || 'all';
  const minAmount = getHistoryAmountValue('historyMinAmount');
  const maxAmount = getHistoryAmountValue('historyMaxAmount');
  const searchTerm = getHistorySearchTerm();
  if (
    minAmountInput &&
    maxAmountInput &&
    minAmount !== null &&
    maxAmount !== null
  ) {
    if (minAmount > maxAmount) {
      maxAmountInput.value = minAmount.toFixed(2);
    }
  }
  persistCurrentHistoryState();
  const accounts = await ensureAccountsLoaded();
  const accountLookup = new Map();
  accounts.forEach((account) => {
    accountLookup.set(String(account.id), account.name);
    accountLookup.set(String(account.name), account.name);
  });
  const selectedAccount = accounts.find(
    (account) => account.id === selectedAccountId
  );
  const allTransactions = await fetchAllTransactions(
    rangeActive
      ? {
          start_date: state.historyRangeStart,
          end_date: state.historyRangeEnd
        }
      : { month: selectedMonth }
  );

  const filters = {
    selectedMonth,
    rangeStart,
    rangeEndExclusive,
    selectedType,
    selectedAccountId,
    selectedAccountName: selectedAccount?.name || '',
    selectedCategoryId,
    minAmount,
    maxAmount:
      minAmount !== null && maxAmount !== null && minAmount > maxAmount
        ? minAmount
        : maxAmount,
    searchTerm,
    accountLookup
  };
  const filtered = annotateTransactionsWithRunningBalances(
    sortTransactionsByMostRecent(
      allTransactions.filter((tx) => matchesHistoryFilters(tx, filters))
    )
  );

  pruneHistorySelection(filtered);

  updateHistorySummary(filtered);
  updateHistoryResultsMeta(filtered, selectedMonth);

  if (filtered.length === 0) {
    const hasExtraFilters =
      selectedType !== 'all' ||
      selectedAccountId !== 'all' ||
      selectedCategoryId !== 'all' ||
      minAmount !== null ||
      maxAmount !== null ||
      Boolean(searchTerm);
    let emptyMessage = 'No hay movimientos para ese mes.';
    if (hasExtraFilters) {
      emptyMessage = 'No hay movimientos con esos filtros.';
    } else if (rangeActive) {
      emptyMessage = 'No hay movimientos en este rango.';
    }

    let emptyActions = '';
    if (hasExtraFilters) {
      emptyActions = '<button type="button" class="history-empty-action" data-history-empty-clear="1">Quitar filtros</button>';
    } else if (rangeActive) {
      emptyActions = '<button type="button" class="history-empty-action" data-history-reset-range="1">Ver por mes</button>';
    }

    txListFull.innerHTML = `
      <div class="history-empty-state">
        <div class="muted" style="text-align:center;">${emptyMessage}</div>
        ${emptyActions}
      </div>
    `;
    historyFilteredTxns = [];
    return;
  }

  historyFilteredTxns = filtered;
  historyVisibleCount = HISTORY_PAGE_SIZE;
  renderHistoryPage();
}

function renderHistoryPage() {
  const txListFull = $('txListFull');
  if (!txListFull) return;

  const visible = historyFilteredTxns.slice(0, historyVisibleCount);
  const remaining = historyFilteredTxns.length - visible.length;

  const groups = new Map();
  visible.forEach((tx) => {
    const key = String(tx.date || '').slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  });

  const groupsHtml = Array.from(groups.entries())
    .map(([dateKey, transactions]) => renderHistoryGroup(dateKey, transactions))
    .join('');

  const loadMoreHtml =
    remaining > 0
      ? `<button type="button" id="historyLoadMoreBtn" class="history-load-more-btn">Ver ${Math.min(HISTORY_PAGE_SIZE, remaining)} más · ${remaining} restantes</button>`
      : '';

  txListFull.innerHTML = groupsHtml + loadMoreHtml;
}

function renderCategoryManager() {
  const treeEl = $('categoriesTree');
  if (!treeEl) return;

  const html = (state.tree || [])
    .map((section) => {
      const categories = sortCategoriesByOrder(section.categories || [])
        .map((category) => {
          const visual = getCategoryVisual(category);
          const subs = sortCategoriesByOrder(category.subcategories || [])
            .map((subcategory) => {
              const subVisual = getCategoryVisual(
                subcategory,
                '•',
                visual.color
              );
              return `
                <div class="tree-subcat tree-row tree-row--draggable" draggable="true" data-id="${subcategory._id}" data-kind="subcategory" data-drag-group="parent:${category._id}">
                  <div class="tree-row-main">
                    <span class="tree-drag-handle" aria-hidden="true" title="Arrastrar para ordenar">
                      <i class="ph ph-dots-six-vertical"></i>
                    </span>
                    <span class="tree-subcat-icon" style="${buildCategoryVisualStyle(subVisual)}">${renderCategoryVisualContent(subVisual, 'visual-token-image visual-token-image--tree')}</span>
                    <span>${escapeHtml(subcategory.name)}</span>
                  </div>
                  <div class="tree-row-actions">
                    <button class="mini-icon-btn" data-action="move-category-up" data-id="${subcategory._id}" type="button" title="Subir subcategoría">
                      <i class="ph ph-arrow-up"></i>
                    </button>
                    <button class="mini-icon-btn" data-action="move-category-down" data-id="${subcategory._id}" type="button" title="Bajar subcategoría">
                      <i class="ph ph-arrow-down"></i>
                    </button>
                    <button class="mini-icon-btn" data-action="edit-category" data-id="${subcategory._id}" type="button" title="Editar subcategoría">
                      <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="mini-icon-btn danger" data-action="delete-category" data-id="${subcategory._id}" type="button" title="Eliminar subcategoría">
                      <i class="ph ph-trash"></i>
                    </button>
                  </div>
                </div>
              `;
            })
            .join('');

          return `
            <div class="tree-cat-card tree-row tree-row--draggable" draggable="true" data-id="${category._id}" data-kind="category" data-drag-group="section:${section.section_id}">
              <div class="tree-cat-header">
                <div class="tree-row-main">
                  <span class="tree-drag-handle" aria-hidden="true" title="Arrastrar para ordenar">
                    <i class="ph ph-dots-six-vertical"></i>
                  </span>
                  <div class="tree-cat-icon" style="${buildCategoryVisualStyle(visual)}">${renderCategoryVisualContent(visual, 'visual-token-image visual-token-image--tree')}</div>
                  <div>
                    <div class="tree-cat-name">${escapeHtml(category.name)}</div>
                    <div class="tree-cat-meta">${escapeHtml(section.section)}</div>
                  </div>
                </div>
                <div class="tree-row-actions">
                  <button class="mini-icon-btn" data-action="move-category-up" data-id="${category._id}" type="button" title="Subir categoría">
                    <i class="ph ph-arrow-up"></i>
                  </button>
                  <button class="mini-icon-btn" data-action="move-category-down" data-id="${category._id}" type="button" title="Bajar categoría">
                    <i class="ph ph-arrow-down"></i>
                  </button>
                  <button class="mini-icon-btn" data-action="add-subcategory" data-id="${category._id}" type="button" title="Añadir subcategoría">
                    <i class="ph ph-plus"></i>
                  </button>
                  <button class="mini-icon-btn" data-action="edit-category" data-id="${category._id}" type="button" title="Editar categoría">
                    <i class="ph ph-pencil-simple"></i>
                  </button>
                  <button class="mini-icon-btn danger" data-action="delete-category" data-id="${category._id}" type="button" title="Eliminar categoría">
                    <i class="ph ph-trash"></i>
                  </button>
                </div>
              </div>
              ${subs ? `<div class="tree-subcats">${subs}</div>` : ''}
            </div>
          `;
        })
        .join('');

      return `
        <div class="tree-section">
          <h4 class="tree-section-title">${escapeHtml(section.section)}</h4>
          <div class="tree-cats">${categories || '<div class="muted">Sin categorías</div>'}</div>
        </div>
      `;
    })
    .join('');

  treeEl.innerHTML =
    html || '<div class="muted">No hay categorías disponibles.</div>';
}

function renderCategoryIconPicker() {
  const picker = $('categoryIconPicker');
  if (!picker) return;

  const selected = ($('categoryFormIcon')?.value || '').trim();
  const groupedHtml = CATEGORY_ICON_GROUPS.map((group) => {
    const buttons = group.icons
      .map((icon) => {
        const isActive = selected === icon ? ' is-active' : '';
        return `
          <button class="icon-choice${isActive}" type="button" data-icon="${escapeHtml(icon)}" title="${escapeHtml(icon)}">
            <span>${escapeHtml(icon)}</span>
          </button>
        `;
      })
      .join('');

    return `
      <div class="icon-picker-group">
        <p class="icon-picker-group-title">${escapeHtml(group.label)}</p>
        <div class="icon-picker-grid">${buttons}</div>
      </div>
    `;
  }).join('');

  const customSelectedBlock =
    selected && !CATEGORY_ICON_SET.has(selected)
      ? `
      <div class="icon-picker-group">
        <p class="icon-picker-group-title">Personalizado</p>
        <div class="icon-picker-grid">
          <button class="icon-choice is-active" type="button" data-icon="${escapeHtml(selected)}" title="${escapeHtml(selected)}">
            <span>${escapeHtml(selected)}</span>
          </button>
        </div>
      </div>
    `
      : '';

  picker.innerHTML = `${customSelectedBlock}${groupedHtml}`;
}

function syncCategoryIconSelection() {
  renderCategoryIconPicker();
}

function getCategoryFormTitle(isEditing, parentId) {
  if (isEditing && parentId) return 'Editar subcategoría';
  if (isEditing) return 'Editar categoría';
  if (parentId) return 'Nueva subcategoría';
  return 'Nueva categoría';
}

function setValueIfElement(element, value) {
  if (!element) return;
  element.value = value;
}

function getParentCategoryBackground(parentId, fallback = '#eef2ff') {
  if (!parentId) return fallback;
  const parentCategory = state.catsById.get(parentId);
  return normalizeColorValue(parentCategory?.bg_color, fallback);
}

function syncSubcategoryBackgroundWithParent({ force = false } = {}) {
  const parentId = $('categoryFormParent')?.value || '';
  if (!parentId) return;
  if (!force && categoryBgColorOverridden) return;

  const bgInput = $('categoryFormBgColor');
  if (!bgInput) return;
  bgInput.value = getParentCategoryBackground(parentId, '#eef2ff');
}

function resetCategoryForm(defaults = {}) {
  state.editingCategoryId = defaults.id || null;
  categoryFormImageData = defaults.image_data || null;
  categoryBgColorOverridden = Boolean(defaults.preserveSubcategoryBackground);
  const title = $('categoryFormTitle');
  const name = $('categoryFormName');
  const icon = $('categoryFormIcon');
  const color = $('categoryFormColor');
  const bgColor = $('categoryFormBgColor');
  const borderColor = $('categoryFormBorderColor');
  const section = $('categoryFormSection');
  const parent = $('categoryFormParent');

  if (title) {
    title.textContent = getCategoryFormTitle(
      Boolean(state.editingCategoryId),
      defaults.parent_id
    );
  }

  if (section) {
    section.innerHTML = getSectionOptions();
    section.value = defaults.section_id || state.tree?.[0]?.section_id || '';
  }
  if (parent) {
    parent.innerHTML = getParentCategoryOptions(defaults.parent_id || '');
    parent.value = defaults.parent_id || '';
  }

  setValueIfElement(name, defaults.name || '');
  setValueIfElement(icon, defaults.icon || '');
  setValueIfElement(color, defaults.color || '#4f46e5');
  setValueIfElement(bgColor, normalizeColorValue(defaults.bg_color, '#eef2ff'));
  setValueIfElement(
    borderColor,
    normalizeColorValue(defaults.border_color, '#c7d2fe')
  );

  clearFileInput('categoryFormImage');
  renderVisualPreview(
    'categoryFormPreview',
    categoryFormImageData,
    defaults.icon || '',
    '🧾'
  );

  syncCategoryFormState();
  syncCategoryIconSelection();
}

function syncCategoryFormState() {
  const section = $('categoryFormSection');
  const parent = $('categoryFormParent');
  const parentCategory = parent?.value
    ? state.catsById.get(parent.value)
    : null;
  if (section && parentCategory) {
    section.value = parentCategory.section_id;
    section.disabled = true;
    syncSubcategoryBackgroundWithParent();
  } else if (section) {
    section.disabled = false;
  }

  const iconInput = $('categoryFormIcon');
  const nameInput = $('categoryFormName');
  if (
    iconInput &&
    !iconInput.value &&
    !categoryFormImageData &&
    nameInput?.value
  ) {
    iconInput.value = inferIconFromCategoryName(nameInput.value, '🧾');
  }

  renderVisualPreview(
    'categoryFormPreview',
    categoryFormImageData,
    iconInput?.value || '',
    '🧾'
  );
  syncCategoryIconSelection();
}

function showCategoryFormCard() {
  const card = $('categoryFormCard');
  if (card) {
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function hideCategoryFormCard() {
  const card = $('categoryFormCard');
  if (card) card.style.display = 'none';
}

function openNewCategoryForm() {
  resetCategoryForm({});
  showCategoryFormCard();
}

function openNewSubcategoryForm(parentId = '') {
  const parentCategory = parentId ? state.catsById.get(parentId) : null;
  const parentVisual = getCategoryVisual(parentCategory, '🧾', '#94a3b8');
  resetCategoryForm({
    parent_id: parentId || '',
    section_id: parentCategory?.section_id || state.tree?.[0]?.section_id || '',
    color: parentVisual.color,
    bg_color: getParentCategoryBackground(parentId, '#eef2ff')
  });
  showCategoryFormCard();
}

function openEditCategoryForm(categoryId) {
  const category = state.catsById.get(categoryId);
  if (!category) return;
  const parentCategory = category.parent_id
    ? state.catsById.get(category.parent_id)
    : null;
  const parentBackground = normalizeColorValue(parentCategory?.bg_color, '');
  const categoryBackground = normalizeColorValue(
    category.bg_color,
    parentBackground
  );
  const hasOwnBackground =
    category.parent_id && String(category.bg_color || '').trim().length > 0;
  resetCategoryForm({
    id: categoryId,
    name: category.name,
    icon: category.icon,
    color: category.color,
    image_data: category.image_data || null,
    bg_color: category.parent_id ? categoryBackground : category.bg_color || '',
    border_color: category.border_color || '',
    section_id: category.section_id,
    parent_id: category.parent_id || '',
    preserveSubcategoryBackground: hasOwnBackground
  });
  showCategoryFormCard();
}

function sortCategoriesByOrder(items = []) {
  return [...items].sort((a, b) => {
    const aOrder = Number.isInteger(a?.order)
      ? a.order
      : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isInteger(b?.order)
      ? b.order
      : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'es', {
      sensitivity: 'base'
    });
  });
}

function getCategorySiblingsInfo(categoryId) {
  const id = String(categoryId || '');
  if (!id) return null;

  for (const section of state.tree || []) {
    const categories = sortCategoriesByOrder(section.categories || []);
    const categoryIndex = categories.findIndex(
      (item) => String(item?._id || '') === id
    );
    if (categoryIndex >= 0) {
      return { siblings: categories, index: categoryIndex };
    }

    for (const category of categories) {
      const subcategories = sortCategoriesByOrder(category.subcategories || []);
      const subIndex = subcategories.findIndex(
        (item) => String(item?._id || '') === id
      );
      if (subIndex >= 0) {
        return { siblings: subcategories, index: subIndex };
      }
    }
  }

  return null;
}

function getCategorySiblingContext(categoryId) {
  const id = String(categoryId || '');
  if (!id) return null;

  for (const section of state.tree || []) {
    const categories = sortCategoriesByOrder(section.categories || []);
    const categoryIndex = categories.findIndex(
      (item) => String(item?._id || '') === id
    );
    if (categoryIndex >= 0) {
      return {
        siblings: categories,
        index: categoryIndex,
        kind: 'category',
        group: `section:${section.section_id}`
      };
    }

    for (const category of categories) {
      const subcategories = sortCategoriesByOrder(category.subcategories || []);
      const subIndex = subcategories.findIndex(
        (item) => String(item?._id || '') === id
      );
      if (subIndex >= 0) {
        return {
          siblings: subcategories,
          index: subIndex,
          kind: 'subcategory',
          group: `parent:${category._id}`
        };
      }
    }
  }

  return null;
}

async function persistCategorySiblingOrder(siblings = []) {
  const updates = siblings.map((item, index) => {
    const itemId = String(item?._id || '');
    return api(`/categories/${itemId}`, {
      method: 'PATCH',
      json: true,
      body: JSON.stringify({ order: index })
    });
  });

  await Promise.all(updates);
}

async function moveCategoryItem(categoryId, direction) {
  const info = getCategorySiblingsInfo(categoryId);
  if (!info) {
    showAlert('No se pudo localizar la categoría para mover', 'error');
    return;
  }

  const step = direction === 'up' ? -1 : 1;
  const targetIndex = info.index + step;
  if (targetIndex < 0 || targetIndex >= info.siblings.length) return;

  const reordered = [...info.siblings];
  const [moved] = reordered.splice(info.index, 1);
  reordered.splice(targetIndex, 0, moved);

  try {
    await persistCategorySiblingOrder(reordered);
    await loadCategoryTree();
    showAlert('Orden actualizado', 'info');
  } catch (err) {
    showAlert(
      'No se pudo actualizar el orden: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function clearCategoryDragStyles() {
  document
    .querySelectorAll(
      '#categoriesTree .is-dragging, #categoriesTree .is-drop-target-before, #categoriesTree .is-drop-target-after'
    )
    .forEach((element) => {
      element.classList.remove(
        'is-dragging',
        'is-drop-target-before',
        'is-drop-target-after'
      );
    });
}

function getDragPlacement(targetElement, clientY) {
  const rect = targetElement.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  return clientY > midY ? 'after' : 'before';
}

async function moveCategoryItemByDrop(draggedId, targetId, placement) {
  const draggedContext = getCategorySiblingContext(draggedId);
  const targetContext = getCategorySiblingContext(targetId);
  if (!draggedContext || !targetContext) return;
  if (
    draggedContext.kind !== targetContext.kind ||
    draggedContext.group !== targetContext.group
  ) {
    return;
  }

  const reordered = [...draggedContext.siblings];
  const draggedIndex = reordered.findIndex(
    (item) => String(item?._id || '') === String(draggedId)
  );
  if (draggedIndex < 0) return;

  const [draggedItem] = reordered.splice(draggedIndex, 1);
  const targetIndex = reordered.findIndex(
    (item) => String(item?._id || '') === String(targetId)
  );
  if (targetIndex < 0) return;

  const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
  reordered.splice(insertIndex, 0, draggedItem);

  await persistCategorySiblingOrder(reordered);
  await loadCategoryTree();
  showAlert('Orden actualizado', 'info');
}

async function saveCategoryForm() {
  const name = $('categoryFormName')?.value?.trim() || '';
  const icon = $('categoryFormIcon')?.value?.trim() || '';
  const color = $('categoryFormColor')?.value || '#4f46e5';
  const bgInput = $('categoryFormBgColor');
  const bg_color = bgInput?.value || '#eef2ff';
  const border_color = $('categoryFormBorderColor')?.value || '#c7d2fe';
  const section_id = $('categoryFormSection')?.value || '';
  const parent_id = $('categoryFormParent')?.value || null;
  const inheritedBgColor = parent_id
    ? getParentCategoryBackground(parent_id, '')
    : bg_color;
  const isCreatingSubcategory = !state.editingCategoryId && Boolean(parent_id);
  const parentVisualColor = parent_id
    ? getCategoryVisual(state.catsById.get(parent_id), '🧾', '#94a3b8').color
    : color;

  if (!name) {
    showAlert('Introduce un nombre para la categoría', 'error');
    return;
  }
  if (!section_id) {
    showAlert('Selecciona una sección', 'error');
    return;
  }

  const resolvedBgColor =
    isCreatingSubcategory || (parent_id && !categoryBgColorOverridden)
      ? inheritedBgColor
      : bg_color;
  const resolvedColor = isCreatingSubcategory ? parentVisualColor : color;

  const resolvedIcon = icon || inferIconFromCategoryName(name, '🧾');

  const payload = {
    name,
    icon: resolvedIcon,
    color: resolvedColor,
    image_data: categoryFormImageData,
    bg_color: resolvedBgColor,
    border_color,
    section_id,
    parent_id,
    order: 0
  };

  try {
    if (state.editingCategoryId) {
      await api(`/categories/${state.editingCategoryId}`, {
        method: 'PATCH',
        json: true,
        body: JSON.stringify(payload)
      });
    } else {
      await api('/categories', {
        method: 'POST',
        json: true,
        body: JSON.stringify(payload)
      });
    }

    hideCategoryFormCard();
    resetCategoryForm({});
    await loadCategoryTree();
  } catch (err) {
    showAlert(
      'Error guardando categoría: ' + (err?.message || String(err)),
      'error'
    );
  }
}

async function deleteCategoryItem(categoryId) {
  if (!confirm('¿Eliminar esta categoría o subcategoría?')) return;
  try {
    await api(`/categories/${categoryId}`, { method: 'DELETE' });
    if (state.editingCategoryId === categoryId) {
      hideCategoryFormCard();
      resetCategoryForm({});
    }
    await loadCategoryTree();
  } catch (err) {
    showAlert(
      'Error eliminando categoría: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function showAlert(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    if (type === 'error') console.error('[showAlert]', message);
    else console.info('[showAlert]', message);
    return;
  }
  let icon = 'ℹ';
  let typeClass = '';
  if (type === 'error') {
    icon = '✕';
    typeClass = ' is-error';
  } else if (type === 'success') {
    icon = '✓';
    typeClass = ' is-success';
  }
  const toast = document.createElement('div');
  toast.className = `toast${typeClass}`;
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span class="toast-msg">${escapeHtml(String(message))}</span>`;
  toast.setAttribute('role', 'alert');
  container.appendChild(toast);

  let removed = false;
  const removeToast = () => {
    if (removed) return;
    removed = true;
    toast.remove();
  };

  const dismiss = () => {
    if (removed) return;
    toast.classList.add('is-out');

    const styles = globalThis.getComputedStyle
      ? globalThis.getComputedStyle(toast)
      : null;
    const duration = styles ? Number.parseFloat(styles.animationDuration) : 0;
    const animationName = styles?.animationName || 'none';
    const hasAnimation = duration > 0 && animationName !== 'none';

    if (hasAnimation) {
      toast.addEventListener('animationend', removeToast, { once: true });
      // Fallback in case visibilitychange event fails to fire in some browsers
      setTimeout(removeToast, 450);
      return;
    }

    setTimeout(removeToast, 0);
  };

  const timer = setTimeout(dismiss, 2200);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}

/**
 * Realizar llamada a API con manejo de errores y autenticación
 * @param {string} path - Ruta de la API
 * @param {Object} opts - Opciones de fetch
 * @returns {Promise} Respuesta parseada
 */
async function api(path, opts = {}) {
  if (!path.startsWith('/')) {
    console.error('❌ Path debe comenzar con /');
    throw new Error('Path inválido');
  }

  const headers = opts.headers || {};
  const requestToken = token;
  if (requestToken) headers['Authorization'] = `Bearer ${requestToken}`;
  if (opts.json) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers,
      // CORS security
      credentials: 'include',
      mode: 'cors'
    });

    // Check if token expired
    if (res.status === 401) {
      if (requestToken && requestToken !== token) {
        const staleAuthError = new Error('Petición antigua ignorada');
        staleAuthError.code = 'STALE_AUTH_REQUEST';
        throw staleAuthError;
      }

      if (requestToken) {
        // Token was valid but server rejected it - likely expired
        logout();
        const expiredErr = new Error(
          'Sesión caducada. Vuelve a iniciar sesión.'
        );
        expiredErr.code = 'SESSION_EXPIRED';
        throw expiredErr;
      }

      // No active token: silently reject without showing "expired" message
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
      // Ignoring stale auth response from previous session
      throw error;
    }

    console.error('❌ API Error:', error.message);
    showAlert(error.message, 'error');
    throw error;
  }
}

function extractApiErrorMessage(payload, fallback = 'Error en la petición') {
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

async function readErrorMessage(response, fallback) {
  const text = await response.text();
  if (!text) return fallback;

  try {
    const payload = JSON.parse(text);
    return extractApiErrorMessage(payload, fallback);
  } catch {
    return text;
  }
}

/**
 * Cerrar sesión del usuario
 */
function logout() {
  flushRemoteSettingsSync();
  localStorage.removeItem('token');
  if (appSettingsSyncTimer) {
    clearTimeout(appSettingsSyncTimer);
    appSettingsSyncTimer = null;
  }
  token = '';
  state.user = null;
  renderProfileIdentity();
  // Show login screen
  switchView('login', 'Inicio de sesión');
}

window.addEventListener('pagehide', () => {
  flushRemoteSettingsSync();
});

async function hasValidStoredSession() {
  if (!token) return false;

  try {
    const res = await fetch(`${API}/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      credentials: 'include',
      mode: 'cors'
    });

    if (res.ok) {
      const me = await res.json().catch(() => null);
      state.user = me;
      await ensureBackendCapabilities();
      await fetchRemoteAppSettings();
      renderProfileIdentity();
      return true;
    }

    // Invalid/expired token: clean up silently during startup
    if (res.status === 401) {
      localStorage.removeItem('token');
      token = '';
      state.user = null;
      renderProfileIdentity();
      return false;
    }

    return false;
  } catch (err) {
    // Backend unavailable: don't force session errors on login
    renderProfileIdentity();
    return false;
  }
}

// ---------- Modal ----------
let modal = null;

function openModal(modalId = 'modalAddTx') {
  const m = $(modalId);
  if (!m) return;
  modal = m;
  m.style.display = 'flex';
  history.pushState({ modalOpen: true }, '');
  setTimeout(() => m.classList.add('active'), 10);
}

function closeModal(modalId = 'modalAddTx', skipHistoryBack = false) {
  const m = $(modalId);
  if (!m) return;
  m.classList.remove('active');
  if (!skipHistoryBack && history.state?.modalOpen) {
    history.back();
  }
  setTimeout(() => {
    m.style.display = 'none';
    if (modal === m) modal = null;
  }, 250);
}

// Close modal when clicking outside
function attachModalOutsideClose() {
  globalThis.addEventListener('click', (ev) => {
    const txModal = $('modalAddTx');
    const accModal = $('modalAddAccount');
    const transferModal = $('modalTransfer');

    if (txModal && ev.target === txModal) closeModal('modalAddTx');
    if (accModal && ev.target === accModal) closeModal('modalAddAccount');
    if (transferModal && ev.target === transferModal)
      closeModal('modalTransfer');
  });
}

// Handle browser back button when modal is open
globalThis.addEventListener('popstate', () => {
  if (modal?.style.display === 'flex') {
    closeModal(modal.id, true);
  }
});

// ---------- Categorías ----------
async function loadCategoryTree() {
  const tree = await api('/categories/tree');
  state.tree = dedupeCategoryTree(tree);

  // Construimos mapa plano de categorías por id
  state.catsById = new Map();
  for (const section of tree) {
    for (const cat of section.categories || []) {
      state.catsById.set(cat._id, cat);
      for (const sc of cat.subcategories || []) {
        state.catsById.set(sc._id, sc);
      }
    }
  }

  // Cargar categorías filtradas según el tipo actual
  updateCategoriesForType();
  renderCategoryManager();

  // Populate subcategories selector if it exists
  const subSel = $('txSubcategory');
  if (subSel) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
  }
}

function updateCategoriesForType() {
  const type = $('txType')?.value || 'expense';
  const categoryMap = {
    expense: ['Gastos', 'Ahorro e Inversión'],
    income: ['Ingresos', 'Ahorro e Inversión']
  };

  const allowedSections = categoryMap[type] || [];
  const flatCats = [];

  for (const section of state.tree) {
    if (allowedSections.includes(section.section)) {
      for (const cat of section.categories || []) {
        flatCats.push(cat);
      }
    }
  }

  // Rellena select categoría con las filtradas
  const catSel = $('txCategory');
  if (catSel) {
    catSel.innerHTML =
      `<option value="">Seleccionar Categoría</option>` +
      flatCats.map((c) => buildCategoryOption(c)).join('');
    catSel.value = ''; // Reset subcategories
  }

  // Reset subcategories
  const subSel = $('txSubcategory');
  if (subSel) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
  }
}

function onTypeChange() {
  updateCategoriesForType();
}

function onCategoryChange() {
  const catId = $('txCategory')?.value;
  const subSel = $('txSubcategory');
  if (!subSel) return;

  if (!catId) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
    return;
  }

  // Get the parent category from the flat map
  const parent = state.catsById.get(catId);
  const subs = parent?.subcategories || [];

  if (!subs.length) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
    return;
  }

  subSel.disabled = false;
  subSel.innerHTML =
    `<option value="">(Opcional) Subcategoría</option>` +
    subs.map((sc) => buildSubcategoryOption(sc)).join('');
}

function getAllParentCategories() {
  const parents = [];
  for (const section of state.tree || []) {
    for (const cat of section.categories || []) {
      parents.push(cat);
    }
  }
  return parents;
}

function renderRecurringSubcategories(parentId) {
  const sel = $('recurringSubcategory');
  if (!sel) return;
  const parent = parentId ? state.catsById.get(parentId) : null;
  const subs = parent?.subcategories || [];
  sel.innerHTML =
    `<option value="">Sin subcategoría</option>` +
    subs.map((item) => buildSubcategoryOption(item)).join('');
}

function renderRuleSubcategories(parentId) {
  const sel = $('ruleSubcategory');
  if (!sel) return;
  const parent = parentId ? state.catsById.get(parentId) : null;
  const subs = parent?.subcategories || [];
  sel.innerHTML =
    `<option value="">Sin subcategoría</option>` +
    subs.map((item) => buildSubcategoryOption(item)).join('');
}

function fillAutomationSelectors() {
  const parentCategories = getAllParentCategories();
  const accounts = state.accounts || [];

  const recurringCategory = $('recurringCategory');
  const ruleCategory = $('ruleCategory');
  const recurringAccount = $('recurringAccount');
  const ruleAccount = $('ruleAccount');

  if (recurringCategory) {
    recurringCategory.innerHTML =
      `<option value="">Seleccionar categoría</option>` +
      parentCategories.map((item) => buildCategoryOption(item)).join('');
  }
  if (ruleCategory) {
    ruleCategory.innerHTML =
      `<option value="">Sin cambio de categoría</option>` +
      parentCategories.map((item) => buildCategoryOption(item)).join('');
  }
  if (recurringAccount) {
    recurringAccount.innerHTML =
      `<option value="">Sin cuenta (global)</option>` +
      accounts
        .map(
          (acc) =>
            `<option value="${escapeHtml(acc.id || '')}">${escapeHtml(acc.name || 'Cuenta')}</option>`
        )
        .join('');
  }
  if (ruleAccount) {
    ruleAccount.innerHTML =
      `<option value="">Sin cambio de cuenta</option>` +
      accounts
        .map(
          (acc) =>
            `<option value="${escapeHtml(acc.id || '')}">${escapeHtml(acc.name || 'Cuenta')}</option>`
        )
        .join('');
  }

  renderRecurringSubcategories(recurringCategory?.value || '');
  renderRuleSubcategories(ruleCategory?.value || '');
}

function clearRecurringForm() {
  editingRecurringId = null;
  const today = new Date().toISOString().slice(0, 10);
  if ($('recurringName')) $('recurringName').value = '';
  if ($('recurringType')) $('recurringType').value = 'expense';
  if ($('recurringAmount')) $('recurringAmount').value = '';
  if ($('recurringCadence')) $('recurringCadence').value = 'monthly';
  if ($('recurringCategory')) $('recurringCategory').value = '';
  renderRecurringSubcategories('');
  if ($('recurringSubcategory')) $('recurringSubcategory').value = '';
  if ($('recurringAccount')) $('recurringAccount').value = '';
  if ($('recurringDay')) $('recurringDay').value = '1';
  if ($('recurringMonth'))
    $('recurringMonth').value = String(new Date().getMonth() + 1);
  if ($('recurringNote')) $('recurringNote').value = '';
  if ($('recurringStart')) $('recurringStart').value = today;
  if ($('recurringEnd')) $('recurringEnd').value = '';
  if ($('recurringActive')) $('recurringActive').checked = true;
}

function clearRuleForm() {
  editingRuleId = null;
  if ($('ruleName')) $('ruleName').value = '';
  if ($('ruleKeyword')) $('ruleKeyword').value = '';
  if ($('ruleMatchMode')) $('ruleMatchMode').value = 'contains';
  if ($('ruleType')) $('ruleType').value = '';
  if ($('ruleCategory')) $('ruleCategory').value = '';
  renderRuleSubcategories('');
  if ($('ruleSubcategory')) $('ruleSubcategory').value = '';
  if ($('ruleAccount')) $('ruleAccount').value = '';
  if ($('rulePriority')) $('rulePriority').value = '100';
  if ($('ruleNotePrefix')) $('ruleNotePrefix').value = '';
  if ($('ruleActive')) $('ruleActive').checked = true;
}

function renderRecurringTemplates() {
  const container = $('recurringList');
  if (!container) return;
  const items = state.recurringTemplates || [];
  if (!items.length) {
    container.innerHTML = `<div class="muted">No hay plantillas recurrentes.</div>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const cadence = item.cadence === 'yearly' ? 'Anual' : 'Mensual';
      const status = item.is_active ? 'Activa' : 'Pausada';
      return `
        <article class="automation-item">
          <div class="automation-item-head">
            <h5 class="automation-item-title">${escapeHtml(item.name || 'Recurrente')}</h5>
            <div class="automation-item-actions">
              <button class="automation-action-btn" data-automation-action="edit-recurring" data-id="${escapeHtml(item.id || item._id || '')}" title="Editar"><i class="ph ph-pencil"></i></button>
              <button class="automation-action-btn" data-automation-action="delete-recurring" data-id="${escapeHtml(item.id || item._id || '')}" title="Eliminar"><i class="ph ph-trash"></i></button>
            </div>
          </div>
          <p class="automation-item-meta">${escapeHtml(cadence)} · Día ${escapeHtml(String(item.day_of_month || 1))} · ${escapeHtml(status)} · ${escapeHtml(String(item.amount || 0))}€</p>
        </article>
      `;
    })
    .join('');
}

function renderAutomationRules() {
  const container = $('ruleList');
  if (!container) return;
  const items = state.automationRules || [];
  if (!items.length) {
    container.innerHTML = `<div class="muted">No hay reglas todavía.</div>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const status = item.is_active ? 'Activa' : 'Pausada';
      return `
        <article class="automation-item">
          <div class="automation-item-head">
            <h5 class="automation-item-title">${escapeHtml(item.name || 'Regla')}</h5>
            <div class="automation-item-actions">
              <button class="automation-action-btn" data-automation-action="edit-rule" data-id="${escapeHtml(item.id || item._id || '')}" title="Editar"><i class="ph ph-pencil"></i></button>
              <button class="automation-action-btn" data-automation-action="delete-rule" data-id="${escapeHtml(item.id || item._id || '')}" title="Eliminar"><i class="ph ph-trash"></i></button>
            </div>
          </div>
          <p class="automation-item-meta">${escapeHtml(item.match_mode || 'contains')} "${escapeHtml(item.keyword || '')}" · Prioridad ${escapeHtml(String(item.priority || 100))} · ${escapeHtml(status)}</p>
        </article>
      `;
    })
    .join('');
}

function renderForecastSummary() {
  const container = $('forecastSummary');
  if (!container) return;
  const data = state.forecast;
  if (!data) {
    container.innerHTML = `<div class="muted">Sin datos de proyección.</div>`;
    return;
  }

  const current = Number(data.global_current_balance || 0).toFixed(2);
  const projected = Number(data.global_projected_balance || 0).toFixed(2);
  const cards = (data.accounts || [])
    .map(
      (item) => `
        <article class="automation-item">
          <div class="automation-item-head">
            <h5 class="automation-item-title">${escapeHtml(item.account_name || 'Cuenta')}</h5>
          </div>
          <p class="automation-item-meta">Actual: ${escapeHtml(Number(item.current_balance || 0).toFixed(2))}€ · Proyectado: ${escapeHtml(Number(item.projected_balance || 0).toFixed(2))}€</p>
        </article>
      `
    )
    .join('');

  container.innerHTML = `
    <article class="automation-item">
      <div class="automation-item-head">
        <h5 class="automation-item-title">Total ${escapeHtml(String(data.days || 30))} días</h5>
      </div>
      <p class="automation-item-meta">Actual: ${escapeHtml(current)}€ · Proyectado: ${escapeHtml(projected)}€</p>
    </article>
    ${cards}
  `;
}

async function loadRecurringTemplates() {
  if (!supportsAutomationApi) {
    state.recurringTemplates = [];
    renderRecurringTemplates();
    return;
  }

  const res = await fetchJsonSilent('/automation/recurring');
  if (res.status === 404) {
    supportsAutomationApi = false;
    applyAutomationApiAvailability();
    state.recurringTemplates = [];
    renderRecurringTemplates();
    return;
  }
  if (!res.ok) {
    throw new Error(res.data?.detail || 'No se pudieron cargar recurrentes');
  }

  state.recurringTemplates = Array.isArray(res.data) ? res.data : [];
  renderRecurringTemplates();
}

async function loadAutomationRules() {
  if (!supportsAutomationApi) {
    state.automationRules = [];
    renderAutomationRules();
    return;
  }

  const res = await fetchJsonSilent('/automation/rules');
  if (res.status === 404) {
    supportsAutomationApi = false;
    applyAutomationApiAvailability();
    state.automationRules = [];
    renderAutomationRules();
    return;
  }
  if (!res.ok) {
    throw new Error(res.data?.detail || 'No se pudieron cargar reglas');
  }

  state.automationRules = Array.isArray(res.data) ? res.data : [];
  renderAutomationRules();
}

async function loadForecast() {
  if (!supportsAutomationApi) {
    state.forecast = null;
    renderForecastSummary();
    return;
  }

  const days = Number.parseInt($('forecastDays')?.value || '30', 10) || 30;
  const res = await fetchJsonSilent(`/forecast?days=${days}`);
  if (res.status === 404) {
    supportsAutomationApi = false;
    applyAutomationApiAvailability();
    state.forecast = null;
    renderForecastSummary();
    return;
  }
  if (!res.ok) {
    throw new Error(res.data?.detail || 'No se pudo cargar la proyección');
  }

  state.forecast = res.data;
  renderForecastSummary();
}

async function runAutomationNow() {
  if (!token || !supportsAutomationApi) return;

  const now = Date.now();
  if (now - automationLastRunAt < 60_000) return;
  automationLastRunAt = now;
  try {
    const res = await fetchJsonSilent('/automation/run', { method: 'POST' });
    if (res.status === 404) {
      supportsAutomationApi = false;
      applyAutomationApiAvailability();
    }
  } catch (err) {
    // Automation execution failed - continuing normally
  }
}

async function loadAutomationWorkspace() {
  await ensureBackendCapabilities();

  if (!supportsAutomationApi) {
    applyAutomationApiAvailability();
    return;
  }

  fillAutomationSelectors();
  await Promise.all([
    loadRecurringTemplates(),
    loadAutomationRules(),
    loadForecast()
  ]);
}

function getRecurringPayloadFromForm() {
  return {
    name: String($('recurringName')?.value || '').trim(),
    type: $('recurringType')?.value || 'expense',
    amount: Number.parseFloat($('recurringAmount')?.value || '0'),
    category_id: $('recurringCategory')?.value || '',
    subcategory_id: $('recurringSubcategory')?.value || null,
    account_id: $('recurringAccount')?.value || null,
    note: String($('recurringNote')?.value || '').trim() || null,
    cadence: $('recurringCadence')?.value || 'monthly',
    day_of_month: Number.parseInt($('recurringDay')?.value || '1', 10),
    month_of_year: Number.parseInt($('recurringMonth')?.value || '1', 10),
    start_date: $('recurringStart')?.value
      ? new Date($('recurringStart').value + 'T12:00:00').toISOString()
      : null,
    end_date: $('recurringEnd')?.value
      ? new Date($('recurringEnd').value + 'T12:00:00').toISOString()
      : null,
    is_active: Boolean($('recurringActive')?.checked)
  };
}

async function saveRecurringTemplate() {
  const payload = getRecurringPayloadFromForm();
  if (
    !payload.name ||
    !payload.category_id ||
    !Number.isFinite(payload.amount) ||
    payload.amount <= 0
  ) {
    showAlert('Completa nombre, categoría e importe', 'error');
    return;
  }

  const method = editingRecurringId ? 'PATCH' : 'POST';
  const path = editingRecurringId
    ? `/automation/recurring/${editingRecurringId}`
    : '/automation/recurring';

  await api(path, {
    method,
    json: true,
    body: JSON.stringify(payload)
  });
  clearRecurringForm();
  await loadRecurringTemplates();
  await runAutomationNow();
  showAlert('Recurrente guardada', 'success');
}

async function deleteRecurringTemplate(id) {
  if (!confirm('¿Eliminar esta plantilla recurrente?')) return;
  await api(`/automation/recurring/${id}`, { method: 'DELETE' });
  if (editingRecurringId === id) clearRecurringForm();
  await loadRecurringTemplates();
}

function editRecurringTemplate(id) {
  const item = (state.recurringTemplates || []).find(
    (entry) => String(entry.id || entry._id) === String(id)
  );
  if (!item) return;
  editingRecurringId = String(item.id || item._id);
  $('recurringName').value = item.name || '';
  $('recurringType').value = item.type || 'expense';
  $('recurringAmount').value = item.amount || '';
  $('recurringCadence').value = item.cadence || 'monthly';
  $('recurringCategory').value = item.category_id || '';
  renderRecurringSubcategories(item.category_id || '');
  $('recurringSubcategory').value = item.subcategory_id || '';
  $('recurringAccount').value = item.account_id || '';
  $('recurringDay').value = String(item.day_of_month || 1);
  $('recurringMonth').value = String(item.month_of_year || 1);
  $('recurringNote').value = item.note || '';
  $('recurringStart').value = item.start_date
    ? String(item.start_date).slice(0, 10)
    : '';
  $('recurringEnd').value = item.end_date
    ? String(item.end_date).slice(0, 10)
    : '';
  $('recurringActive').checked = Boolean(item.is_active);
}

function getRulePayloadFromForm() {
  return {
    name: String($('ruleName')?.value || '').trim(),
    keyword: String($('ruleKeyword')?.value || '').trim(),
    match_mode: $('ruleMatchMode')?.value || 'contains',
    type: $('ruleType')?.value || null,
    category_id: $('ruleCategory')?.value || null,
    subcategory_id: $('ruleSubcategory')?.value || null,
    account_id: $('ruleAccount')?.value || null,
    note_prefix: String($('ruleNotePrefix')?.value || '').trim() || null,
    priority: Number.parseInt($('rulePriority')?.value || '100', 10) || 100,
    is_active: Boolean($('ruleActive')?.checked)
  };
}

async function saveAutomationRule() {
  const payload = getRulePayloadFromForm();
  if (!payload.name || !payload.keyword) {
    showAlert('Completa nombre y palabra clave de la regla', 'error');
    return;
  }

  const method = editingRuleId ? 'PATCH' : 'POST';
  const path = editingRuleId
    ? `/automation/rules/${editingRuleId}`
    : '/automation/rules';
  await api(path, {
    method,
    json: true,
    body: JSON.stringify(payload)
  });
  clearRuleForm();
  await loadAutomationRules();
  showAlert('Regla guardada', 'success');
}

async function deleteAutomationRule(id) {
  if (!confirm('¿Eliminar esta regla?')) return;
  await api(`/automation/rules/${id}`, { method: 'DELETE' });
  if (editingRuleId === id) clearRuleForm();
  await loadAutomationRules();
}

function editAutomationRule(id) {
  const item = (state.automationRules || []).find(
    (entry) => String(entry.id || entry._id) === String(id)
  );
  if (!item) return;
  editingRuleId = String(item.id || item._id);
  $('ruleName').value = item.name || '';
  $('ruleKeyword').value = item.keyword || '';
  $('ruleMatchMode').value = item.match_mode || 'contains';
  $('ruleType').value = item.type || '';
  $('ruleCategory').value = item.category_id || '';
  renderRuleSubcategories(item.category_id || '');
  $('ruleSubcategory').value = item.subcategory_id || '';
  $('ruleAccount').value = item.account_id || '';
  $('rulePriority').value = String(item.priority || 100);
  $('ruleNotePrefix').value = item.note_prefix || '';
  $('ruleActive').checked = Boolean(item.is_active);
}

async function exportAllTransactionsCsv() {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/transactions/export.csv`, {
    method: 'GET',
    headers,
    credentials: 'include',
    mode: 'cors'
  });
  if (!res.ok) {
    throw new Error('No se pudo exportar CSV');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movimientos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importTransactionsCsv() {
  const csvText = String($('csvImportText')?.value || '').trim();
  if (!csvText) {
    showAlert('Pega o carga un CSV antes de importar', 'error');
    return;
  }
  const hasHeader = Boolean($('csvImportHasHeader')?.checked);
  const result = await api('/transactions/import-csv', {
    method: 'POST',
    json: true,
    body: JSON.stringify({
      csv_text: csvText,
      has_header: hasHeader,
      apply_rules: true
    })
  });
  const imported = Number(result?.imported || 0);
  const skipped = Number(result?.skipped || 0);
  showAlert(
    `Importación completada: ${imported} importadas, ${skipped} omitidas`,
    'success'
  );
  await runAutomationNow();
  loadViewContent(state.currentViewId);
}

async function onCsvImportFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  if ($('csvImportText')) $('csvImportText').value = text;
}

function initAutomationListeners() {
  const recurringCategory = $('recurringCategory');
  const ruleCategory = $('ruleCategory');
  const recurringList = $('recurringList');
  const ruleList = $('ruleList');
  const btnSaveRecurring = $('btnSaveRecurring');
  const btnClearRecurring = $('btnClearRecurring');
  const btnSaveRule = $('btnSaveRule');
  const btnClearRule = $('btnClearRule');
  const btnRefreshForecast = $('btnRefreshForecast');
  const btnExportAllCsv = $('btnExportAllCsv');
  const btnImportCsv = $('btnImportCsv');
  const csvImportFile = $('csvImportFile');

  if (recurringCategory)
    recurringCategory.addEventListener('change', () => {
      renderRecurringSubcategories(recurringCategory.value || '');
    });

  if (ruleCategory)
    ruleCategory.addEventListener('change', () => {
      renderRuleSubcategories(ruleCategory.value || '');
    });

  if (btnSaveRecurring)
    btnSaveRecurring.addEventListener('click', () => {
      saveRecurringTemplate().catch((err) => {
        showAlert(err?.message || 'No se pudo guardar la recurrente', 'error');
      });
    });

  if (btnClearRecurring)
    btnClearRecurring.addEventListener('click', () => {
      clearRecurringForm();
    });

  if (btnSaveRule)
    btnSaveRule.addEventListener('click', () => {
      saveAutomationRule().catch((err) => {
        showAlert(err?.message || 'No se pudo guardar la regla', 'error');
      });
    });

  if (btnClearRule)
    btnClearRule.addEventListener('click', () => {
      clearRuleForm();
    });

  if (btnRefreshForecast)
    btnRefreshForecast.addEventListener('click', () => {
      loadForecast().catch((err) => {
        showAlert(err?.message || 'No se pudo cargar la proyección', 'error');
      });
    });

  if (btnExportAllCsv)
    btnExportAllCsv.addEventListener('click', () => {
      exportAllTransactionsCsv().catch((err) => {
        showAlert(err?.message || 'No se pudo exportar CSV', 'error');
      });
    });

  if (btnImportCsv)
    btnImportCsv.addEventListener('click', () => {
      importTransactionsCsv().catch((err) => {
        showAlert(err?.message || 'No se pudo importar CSV', 'error');
      });
    });

  if (csvImportFile)
    csvImportFile.addEventListener('change', (event) => {
      onCsvImportFileChange(event).catch((err) => {
        showAlert(err?.message || 'No se pudo leer el archivo CSV', 'error');
      });
    });

  if (recurringList)
    recurringList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-automation-action][data-id]');
      if (!button) return;
      const id = button.dataset.id || '';
      const action = button.dataset.automationAction;
      if (action === 'edit-recurring') editRecurringTemplate(id);
      if (action === 'delete-recurring') {
        deleteRecurringTemplate(id).catch((err) => {
          showAlert(
            err?.message || 'No se pudo eliminar la plantilla',
            'error'
          );
        });
      }
    });

  if (ruleList)
    ruleList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-automation-action][data-id]');
      if (!button) return;
      const id = button.dataset.id || '';
      const action = button.dataset.automationAction;
      if (action === 'edit-rule') editAutomationRule(id);
      if (action === 'delete-rule') {
        deleteAutomationRule(id).catch((err) => {
          showAlert(err?.message || 'No se pudo eliminar la regla', 'error');
        });
      }
    });

  clearRecurringForm();
  clearRuleForm();
}

// ---------- Transacciones ----------
async function saveTx() {
  const amount = Number.parseFloat($('txAmount')?.value || '');
  const type = $('txType')?.value || 'expense';
  const category_id = $('txCategory')?.value || '';
  const subcategory_id = $('txSubcategory')?.value || null;
  const note = $('txDesc')?.value?.trim() || null;
  const account_id = ($('txAccount')?.value || '').trim() || null;
  const dateValue = ($('txDate')?.value || '').trim();

  // Validación mejorada
  if (!category_id) {
    showAlert('Selecciona una categoría', 'error');
    return;
  }
  if (!amount || amount <= 0) {
    showAlert('Introduce un importe válido (mayor que 0)', 'error');
    return;
  }
  if (!account_id) {
    showAlert('Selecciona una cuenta', 'error');
    return;
  }

  const payload = {
    type,
    amount,
    category_id,
    subcategory_id: subcategory_id || null,
    note,
    account_id,
    date: buildTransactionIsoDate(dateValue)
  };

  try {
    if (editingTxId) {
      await api(`/transactions/${editingTxId}`, {
        method: 'PATCH',
        json: true,
        body: JSON.stringify(payload)
      });
    } else {
      await api('/transactions', {
        method: 'POST',
        json: true,
        body: JSON.stringify(payload)
      });
    }

    const form = $('txForm');
    if (form) form.reset();
    editingTxId = null;
    closeModal();
    await refreshAfterTransactionChange(account_id);
  } catch (err) {
    showAlert('Error al guardar: ' + (err?.message || String(err)), 'error');
  }
}

async function refreshAfterTransactionChange(accountId = null) {
  // Load accounts and home in parallel, not sequentially
  await Promise.all([loadAccounts(), loadHomeAccount()]);

  if (state.currentViewId === 'account-detail') {
    const targetAccountId = state.currentAccountId || accountId;
    if (targetAccountId) {
      await openViewAccount(targetAccountId);
      return;
    }
  }

  if (state.currentViewId === 'accounts' || state.currentViewId === 'home') {
    return;
  }

  loadViewContent(state.currentViewId);
}

async function deleteTx(txId) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  try {
    const currentAccountId = ($('txAccount')?.value || '').trim() || null;
    await api(`/transactions/${txId}`, { method: 'DELETE' });
    await refreshAfterTransactionChange(currentAccountId);
  } catch (err) {
    showAlert('Error al eliminar: ' + (err?.message || String(err)), 'error');
  }
}

// ---------- Auth (frontend) ----------
function setAuthSubmitLoading(mode = 'login', isLoading = false) {
  const loginBtn = $('btnLogin');
  const registerBtn = $('btnRegister');

  if (loginBtn) {
    if (!loginBtn.dataset.defaultLabel) {
      loginBtn.dataset.defaultLabel = loginBtn.textContent || 'Entrar';
    }
    loginBtn.disabled = isLoading;
    loginBtn.classList.toggle('is-loading', isLoading && mode === 'login');
    loginBtn.textContent =
      isLoading && mode === 'login'
        ? 'Entrando...'
        : loginBtn.dataset.defaultLabel;
  }

  if (registerBtn) {
    if (!registerBtn.dataset.defaultLabel) {
      registerBtn.dataset.defaultLabel =
        registerBtn.textContent || 'Crear cuenta';
    }
    registerBtn.disabled = isLoading;
    registerBtn.classList.toggle(
      'is-loading',
      isLoading && mode === 'register'
    );
    registerBtn.textContent =
      isLoading && mode === 'register'
        ? 'Creando cuenta...'
        : registerBtn.dataset.defaultLabel;
  }
}

async function login() {
  const email = $('loginEmail')?.value?.trim();
  const password = $('loginPassword')?.value || '';
  if (!email || !password) {
    showAlert('Introduce email y contraseña', 'error');
    return;
  }

  setAuthSubmitLoading('login', true);

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password })
    });

    if (!res.ok)
      throw new Error(await readErrorMessage(res, 'Error al autenticar'));

    const data = await res.json();
    token = data.access_token;
    localStorage.setItem('token', token);
    if ($('loginPassword')) $('loginPassword').value = '';
    await hasValidStoredSession();

    // hasValidStoredSession may clear token if /me fails
    if (!token) {
      showAlert('No se pudo verificar la sesión. Intenta de nuevo.', 'error');
      return;
    }

    // Show app immediately; load data in parallel background
    const startupView = getConfiguredStartView();
    switchView(startupView.id, startupView.title);
    Promise.all([loadCategoryTree(), loadAccounts()]).catch(() => {});
  } catch (err) {
    // SESSION_EXPIRED y NO_AUTH ya fueron manejados por api() — no mostrar segundo toast
    if (err?.code === 'SESSION_EXPIRED' || err?.code === 'NO_AUTH') return;
    const msg = err?.message ?? String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      showAlert(
        `No se puede conectar con la API (${API}). Verifica que esté levantada.`,
        'error'
      );
      return;
    }
    showAlert('Login fallido: ' + msg, 'error');
  } finally {
    setAuthSubmitLoading('login', false);
  }
}

async function register() {
  const email = $('registerEmail')?.value?.trim();
  const password = $('registerPassword')?.value || '';
  if (!email || !password) {
    showAlert('Introduce email y contraseña', 'error');
    return;
  }

  setAuthSubmitLoading('register', true);
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok)
      throw new Error(await readErrorMessage(res, 'Registro fallido'));

    // El endpoint de registro ya devuelve access_token.
    const data = await res.json();
    token = data.access_token;
    localStorage.setItem('token', token);
    if ($('registerPassword')) $('registerPassword').value = '';
    await hasValidStoredSession();

    if (!token) {
      showAlert('No se pudo verificar la sesión. Intenta de nuevo.', 'error');
      return;
    }

    // Show app immediately; load data in parallel background
    const startupView = getConfiguredStartView();
    switchView(startupView.id, startupView.title);
    Promise.all([loadCategoryTree(), loadAccounts()]).catch(() => {});
  } catch (err) {
    if (err?.code === 'SESSION_EXPIRED' || err?.code === 'NO_AUTH') return;
    showAlert('Registro fallido: ' + (err?.message ?? String(err)), 'error');
  } finally {
    setAuthSubmitLoading('register', false);
  }
}

// ---------- Dashboard ----------
async function loadHomeAccount() {
  try {
    const homeCard = document.querySelector('.home-account-card');
    const homeTransferBtn = $('btnHomeTransfer');
    const homeResetBtn = $('btnHomeResetAccount');
    const homeSpendDistribution = $('homeSpendDistribution');
    const accounts = getSortedAccounts(await api('/accounts'));
    state.accounts = accounts;
    const principalAccount = accounts[0] || null;

    if (!principalAccount) {
      applyEmptyHomeAccountState(
        homeCard,
        homeTransferBtn,
        homeResetBtn,
        homeSpendDistribution
      );
      return;
    }

    // Mostrar datos de la cuenta
    const typeLabel =
      {
        bank: '🏦 Banco',
        cash: '💵 Efectivo',
        credit: '💳 Tarjeta crédito'
      }[principalAccount.type] || principalAccount.type;

    $('homeAccountType').textContent = typeLabel;
    const [mainName, subtitle = 'Principal'] = String(
      principalAccount.name || ''
    )
      .split('·')
      .map((part) => part.trim())
      .filter(Boolean);
    applyAccountTheme(homeCard, principalAccount);
    const homeBadge = $('homeAccountBadge');
    if (homeBadge) {
      homeBadge.innerHTML = getAccountBadgeMarkup(
        principalAccount,
        'account-brand-badge--hero'
      );
    }
    $('homeAccountName').textContent = mainName || principalAccount.name;
    $('homeAccountSubtitle').textContent = subtitle;
    $('homeAccountSubtitle').classList.toggle(
      'account-subtitle-muted',
      /ahorro|hucha/i.test(subtitle)
    );
    const balance = Number(principalAccount.current_balance || 0).toFixed(2);
    $('homeAccountBalance').textContent = `${balance}€`;
    enableHomeCardNavigation(homeCard, principalAccount.id);

    syncHomeTransferButton(homeTransferBtn, principalAccount);
    syncHomeResetButton(homeResetBtn, principalAccount);

    // Cargar movimientos de esta cuenta
    const list = await fetchAllTransactions();
    const filtered = list.filter((t) => {
      const acc_id = t.account_id || null;
      return acc_id === principalAccount.id || acc_id === principalAccount.name;
    });

    if (homeSpendDistribution) {
      homeSpendDistribution.innerHTML =
        buildAccountSpendDistributionCard(filtered);
    }

    // Render home account transactions sorted by most recent
    const sortedTransactions = annotateTransactionsWithRunningBalances(
      sortTransactionsByMostRecent(filtered)
    );
    const html = sortedTransactions.map((t) => renderTxItem(t, true)).join('');

    const txList = $('homeAccountTxList');
    if (txList) {
      txList.innerHTML =
        html ||
        '<div class="muted" style="text-align:center; margin: 20px 0;">No hay movimientos aún.</div>';

      // Click handlers
      txList.querySelectorAll('.tx-item').forEach((el) => {
        el.addEventListener('click', (e) => {
          const id = el.dataset.id;
          openViewTx(id);
        });
      });
    }
  } catch (err) {
    if (
      err?.code === 'STALE_AUTH_REQUEST' ||
      err?.message === 'Sesión caducada. Vuelve a iniciar sesión.'
    ) {
      return;
    }
    console.error('Error cargando cuenta principal:', err);
  }
}

async function loadDashboardView() {
  try {
    const [ms, accounts, transactions] = await Promise.all([
      api(buildDashboardSummaryPath()),
      api('/accounts'),
      fetchAllTransactions(getDashboardTransactionFilters())
    ]);
    syncDashboardRangeInputs(ms || {});
    const rangeTransactions = filterTransactionsByDashboardCycle(
      transactions || [],
      ms
    );
    const cycleLabel = formatDashboardCycle(ms);
    const summaryMode =
      state.dashboardSummaryMode === 'compact' ? 'compact' : 'full';
    const periodLabel = state.dashboardUseCustomRange ? 'rango' : 'ciclo';

    // Mostrar balance del mes
    const dashEl = $('dashboardBalance');
    if (dashEl) dashEl.textContent = (ms.balance || 0).toFixed(2) + '€';

    const adviceEl = $('dashboardAdvice');
    if (adviceEl) {
      adviceEl.textContent = `${cycleLabel} · Ingresos: ${Number(ms.total_income || 0).toFixed(2)}€ · Gastos: ${Number(ms.total_expense || 0).toFixed(2)}€`;
    }

    document
      .querySelectorAll('[data-dashboard-summary-mode]')
      .forEach((button) => {
        const mode = button.dataset.dashboardSummaryMode || 'full';
        button.classList.toggle('is-active', mode === summaryMode);
        button.onclick = () => {
          state.dashboardSummaryMode = mode;
          loadDashboardView();
        };
      });

    // Mostrar detalles por categoría
    const details = $('dashboardDetails');
    const breakdownCard = document.querySelector(
      '#view-dashboard .dashboard-breakdown-card'
    );
    if (breakdownCard) {
      breakdownCard.style.display = summaryMode === 'compact' ? 'none' : '';
    }

    if (details && Object.keys(ms.category_breakdown || {}).length > 0) {
      const breakdown = Object.entries(ms.category_breakdown || {})
        .sort(
          ([, amountA], [, amountB]) =>
            Number(amountB || 0) - Number(amountA || 0)
        )
        .map(([catId, amount]) =>
          renderBreakdownItem(catId, amount, Number(ms.total_expense || 0))
        )
        .join('');
      details.innerHTML = breakdown;
      details.querySelectorAll('.summary-row--clickable').forEach((row) => {
        const handler = () => {
          const catId = row.dataset.catId || '';
          if (!catId) return;
          openHistoryFromDashboardCategory(catId, ms);
        };
        row.addEventListener('click', handler);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
      });
    } else if (details) {
      details.innerHTML = `<div class="muted" style="text-align:center; margin: 16px 0;">Aún no hay gastos en este ${periodLabel}.</div>`;
    }

    const accountsDistribution = $('dashboardAccountsDistribution');
    if (accountsDistribution) {
      accountsDistribution.style.display =
        summaryMode === 'compact' ? 'none' : '';
      accountsDistribution.innerHTML = buildDashboardAccountSpendCard(
        accounts || [],
        rangeTransactions
      );

      accountsDistribution
        .querySelectorAll('[data-dashboard-account-id]')
        .forEach((button) => {
          button.addEventListener('click', () => {
            const selectedAccountId = button.dataset.dashboardAccountId || '';
            state.dashboardSelectedAccountId =
              selectedAccountId === '__all__' ? null : selectedAccountId;
            state.dashboardAccountSpendMode = 'all';
            loadDashboardView();
          });
        });
    }
  } catch (err) {
    console.error('Error cargando dashboard:', err);
  }
}

function initDashboardListeners() {
  const startInput = $('dashboardDateStart');
  const endInput = $('dashboardDateEnd');
  const applyBtn = $('dashboardApplyRangeBtn');
  const resetBtn = $('dashboardResetRangeBtn');

  const submitRange = async () => {
    const startValue = (startInput?.value || '').trim();
    const endValue = (endInput?.value || '').trim();

    if (!startValue || !endValue) {
      showAlert('Selecciona una fecha inicial y otra final', 'error');
      return;
    }

    if (endValue < startValue) {
      showAlert('La fecha final no puede ser anterior a la inicial', 'error');
      return;
    }

    state.dashboardDateStart = startValue;
    state.dashboardDateEnd = endValue;
    state.dashboardUseCustomRange = true;
    await loadDashboardView();
  };

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      submitRange();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      state.dashboardDateStart = '';
      state.dashboardDateEnd = '';
      state.dashboardUseCustomRange = false;
      await loadDashboardView();
    });
  }

  [startInput, endInput].forEach((input) => {
    if (!input) return;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitRange();
      }
    });
  });
}

function getBudgetParentCategories() {
  const allowedSections = new Set(['Gastos', 'Ahorro e Inversión']);
  const categories = [];

  for (const section of state.tree || []) {
    if (!allowedSections.has(section.section)) continue;
    for (const category of section.categories || []) {
      categories.push(category);
    }
  }

  return categories;
}

function renderBudgetStatusCard(item) {
  const limit = Number(item.limit || 0);
  const spent = Number(item.spent || 0);
  const remaining = Number(item.remaining || 0);
  const ratio = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
  const isExceeded = remaining < 0;
  const cardStateClass = isExceeded ? 'is-danger' : 'is-ok';
  const budgetId = String(item.budget_id || '');
  const categoryId = String(item.category_id || '');

  return `
    <article class="budget-card ${cardStateClass}">
      <div class="budget-card-top">
        <p class="budget-card-name">${escapeHtml(item.category || 'Categoría')}</p>
        <div class="budget-card-head-actions">
          <span class="budget-card-status">${escapeHtml(item.status || '')}</span>
          <button type="button" class="budget-mini-btn" data-action="edit-budget" data-budget-id="${escapeHtml(budgetId)}" data-category-id="${escapeHtml(categoryId)}" data-limit="${limit.toFixed(2)}" title="Editar presupuesto">
            <i class="ph ph-pencil-simple"></i>
          </button>
          <button type="button" class="budget-mini-btn danger" data-action="delete-budget" data-budget-id="${escapeHtml(budgetId)}" title="Eliminar presupuesto">
            <i class="ph ph-trash"></i>
          </button>
        </div>
      </div>
      <div class="budget-card-values">
        <span>Gastado: <strong>${spent.toFixed(2)}€</strong></span>
        <span>Límite: <strong>${limit.toFixed(2)}€</strong></span>
        <span>Restante: <strong>${remaining.toFixed(2)}€</strong></span>
      </div>
      <div class="budget-progress" aria-hidden="true">
        <div class="budget-progress-fill" style="width:${ratio.toFixed(1)}%"></div>
      </div>
    </article>
  `;
}

function getSelectedBudgetStatusFilter() {
  const active = document.querySelector(
    '#budgetStatusFilters [data-budget-filter].is-active'
  );
  if (!active) return state.budgetStatusFilter || 'all';

  const selected = active?.dataset.budgetFilter || 'all';
  state.budgetStatusFilter = selected;
  return selected;
}

function setBudgetStatusFilter(filterValue = 'all') {
  const normalized = ['all', 'risk', 'exceeded'].includes(filterValue)
    ? filterValue
    : 'all';
  state.budgetStatusFilter = normalized;
  localStorage.setItem(BUDGET_FILTER_STORAGE_KEY, normalized);

  const budgetStatusFilters = $('budgetStatusFilters');
  if (!budgetStatusFilters) return;

  budgetStatusFilters
    .querySelectorAll('[data-budget-filter]')
    .forEach((item) => item.classList.remove('is-active'));
  const target = budgetStatusFilters.querySelector(
    `[data-budget-filter="${CSS.escape(normalized)}"]`
  );
  if (target) {
    target.classList.add('is-active');
  }
}

function getBudgetScopeLabel(selectedFilter = 'all') {
  if (selectedFilter === 'risk') return 'en riesgo';
  if (selectedFilter === 'exceeded') return 'excedidos';
  return 'totales';
}

function applyBudgetStatusFilter(items = [], selectedFilter = 'all') {
  if (selectedFilter === 'exceeded') {
    return items.filter((item) => Number(item.remaining || 0) < 0);
  }
  if (selectedFilter === 'risk') {
    return items.filter((item) => {
      const limit = Number(item.limit || 0);
      const spent = Number(item.spent || 0);
      const ratio = limit > 0 ? (spent / limit) * 100 : 0;
      return ratio >= 80 && Number(item.remaining || 0) >= 0;
    });
  }
  return items;
}

function resetBudgetForm() {
  state.editingBudgetId = null;
  const categorySelect = $('budgetCategorySelect');
  const limitInput = $('budgetLimitInput');
  const saveBtn = $('budgetSaveBtn');
  const cancelBtn = $('budgetCancelEditBtn');

  if (categorySelect) {
    categorySelect.value = '';
    categorySelect.disabled = false;
  }
  if (limitInput) limitInput.value = '';
  if (saveBtn) saveBtn.textContent = 'Guardar presupuesto';
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function startEditBudget(item) {
  state.editingBudgetId = String(item?.budget_id || '');
  const categorySelect = $('budgetCategorySelect');
  const limitInput = $('budgetLimitInput');
  const saveBtn = $('budgetSaveBtn');
  const cancelBtn = $('budgetCancelEditBtn');

  if (categorySelect) {
    categorySelect.value = String(item?.category_id || '');
    categorySelect.disabled = true;
  }
  if (limitInput) {
    limitInput.value = Number(item?.limit || 0).toFixed(2);
    limitInput.focus();
    limitInput.select();
  }
  if (saveBtn) saveBtn.textContent = 'Actualizar presupuesto';
  if (cancelBtn) cancelBtn.style.display = '';
}

async function deleteBudgetFromView(budgetId) {
  if (!budgetId) return;
  if (!confirm('¿Eliminar este presupuesto del ciclo actual?')) return;

  try {
    await api(`/budgets/${budgetId}`, { method: 'DELETE' });
    showAlert('Presupuesto eliminado', 'info');
    if (state.editingBudgetId === budgetId) {
      resetBudgetForm();
    }
    await loadBudgetsView();
  } catch (err) {
    showAlert(
      'No se pudo eliminar el presupuesto: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function renderBudgetOverviewChart(items = []) {
  const container = $('chartContainer');
  if (!container) return;

  if (!items.length) {
    container.innerHTML =
      '<div class="muted" style="text-align:center;">Define presupuestos para ver su progreso.</div>';
    return;
  }

  const html = items
    .slice()
    .sort((a, b) => {
      const ratioA =
        Number(a.limit || 0) > 0
          ? Number(a.spent || 0) / Number(a.limit || 1)
          : 0;
      const ratioB =
        Number(b.limit || 0) > 0
          ? Number(b.spent || 0) / Number(b.limit || 1)
          : 0;
      return ratioB - ratioA;
    })
    .slice(0, 6)
    .map((item) => {
      const limit = Number(item.limit || 0);
      const spent = Number(item.spent || 0);
      const ratio = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
      const className = Number(item.remaining || 0) < 0 ? 'is-danger' : 'is-ok';
      return `
        <div class="budget-chart-row ${className}">
          <div class="budget-chart-copy">
            <span class="budget-chart-name">${escapeHtml(item.category || 'Categoría')}</span>
            <span class="budget-chart-percent">${ratio.toFixed(0)}%</span>
          </div>
          <div class="budget-chart-track" aria-hidden="true">
            <div class="budget-chart-fill" style="width:${ratio.toFixed(1)}%"></div>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <p class="budget-chart-title">Categorías más comprometidas</p>
    <div class="budget-chart-list">${html}</div>
  `;
}

async function populateBudgetCategorySelect() {
  const select = $('budgetCategorySelect');
  if (!select) return;

  await ensureCategoriesLoaded();
  const currentValue = select.value || '';
  const categories = getBudgetParentCategories();

  const options = [
    '<option value="">Selecciona categoría</option>',
    ...categories.map((category) => {
      const visual = getCategoryVisual(category);
      const label = `${visual.icon} ${visual.name}`;
      return `<option value="${category._id}">${escapeHtml(label)}</option>`;
    })
  ];

  select.innerHTML = options.join('');
  select.value = categories.some((category) => category._id === currentValue)
    ? currentValue
    : '';
}

async function saveBudgetFromView() {
  const categoryId = $('budgetCategorySelect')?.value || '';
  const limitAmount = Number.parseFloat($('budgetLimitInput')?.value || '');

  if (!categoryId) {
    showAlert('Selecciona una categoría para el presupuesto', 'error');
    return;
  }
  if (!Number.isFinite(limitAmount) || limitAmount <= 0) {
    showAlert('El límite debe ser mayor que 0', 'error');
    return;
  }

  try {
    const summary = await api('/summary/monthly');
    const cycleStart = summary?.period_start
      ? new Date(summary.period_start)
      : new Date();

    await api('/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: categoryId,
        limit_amount: Number(limitAmount.toFixed(2)),
        month: cycleStart.getMonth() + 1,
        year: cycleStart.getFullYear()
      })
    });

    showAlert('Presupuesto guardado', 'info');
    resetBudgetForm();
    await loadBudgetsView();
  } catch (err) {
    showAlert(
      'No se pudo guardar el presupuesto: ' + (err?.message || String(err)),
      'error'
    );
  }
}

async function loadBudgetsView() {
  const statusList = $('budgetStatusList');
  const summaryMeta = $('budgetStatusSummary');
  const cycleLabel = $('budgetCycleLabel');

  if (!statusList) return;

  try {
    await populateBudgetCategorySelect();

    const [summary, budgetsStatus] = await Promise.all([
      api('/summary/monthly'),
      api('/budgets/check')
    ]);

    if (cycleLabel) {
      cycleLabel.textContent = formatDashboardCycle(summary || {});
    }

    const items = Array.isArray(budgetsStatus) ? budgetsStatus : [];
    const selectedFilter = getSelectedBudgetStatusFilter();
    const filteredItems = applyBudgetStatusFilter(items, selectedFilter);
    const exceededCount = items.filter(
      (item) => Number(item.remaining || 0) < 0
    ).length;

    if (summaryMeta) {
      const scopeLabel = getBudgetScopeLabel(selectedFilter);
      summaryMeta.textContent = `${filteredItems.length} ${scopeLabel} · ${items.length} presupuestos · ${exceededCount} excedidos`;
    }

    if (!items.length) {
      resetBudgetForm();
      statusList.innerHTML =
        '<div class="muted" style="text-align:center;">Aún no tienes presupuestos definidos para este ciclo.</div>';
      renderBudgetOverviewChart([]);
      return;
    }

    if (!filteredItems.length) {
      statusList.innerHTML =
        '<div class="muted" style="text-align:center;">No hay presupuestos para ese filtro.</div>';
      renderBudgetOverviewChart([]);
      return;
    }

    statusList.innerHTML = filteredItems
      .map((item) => renderBudgetStatusCard(item))
      .join('');
    statusList
      .querySelectorAll('[data-action="edit-budget"]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const budgetId = button.dataset.budgetId || '';
          const categoryId = button.dataset.categoryId || '';
          const limit = Number.parseFloat(button.dataset.limit || '0');
          const selected = filteredItems.find(
            (item) => String(item.budget_id || '') === String(budgetId)
          ) || {
            budget_id: budgetId,
            category_id: categoryId,
            limit
          };
          startEditBudget(selected);
        });
      });
    statusList
      .querySelectorAll('[data-action="delete-budget"]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          deleteBudgetFromView(button.dataset.budgetId || '');
        });
      });

    if (state.editingBudgetId) {
      const currentEditing = items.find(
        (item) => String(item.budget_id || '') === String(state.editingBudgetId)
      );
      if (currentEditing) {
        startEditBudget(currentEditing);
      } else {
        resetBudgetForm();
      }
    }

    renderBudgetOverviewChart(filteredItems);
  } catch (err) {
    statusList.innerHTML = `<div class="muted" style="text-align:center;">Error cargando presupuestos: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function setFormControlsDisabled(form, disabled) {
  Array.from(form.querySelectorAll('input,select,textarea')).forEach(
    (i) => (i.disabled = disabled)
  );
}

function applyCreateModalMode() {
  const title = document.querySelector('.modal-title');
  const btnSave = $('btnSaveTx');
  const btnEdit = $('btnEditTx');
  const btnDelete = $('btnDeleteTx');
  const form = $('txForm');
  if (title) title.textContent = 'Añadir movimiento';
  if (btnSave) btnSave.style.display = '';
  if (btnEdit) btnEdit.style.display = 'none';
  if (btnDelete) btnDelete.style.display = 'none';
  setFormControlsDisabled(form, false);
  if (form) form.reset();
  const txDate = $('txDate');
  if (txDate) txDate.value = new Date().toISOString().slice(0, 10);
  editingTxId = null;
  updateCategoriesForType();
}

function applyViewModalMode(txId) {
  const title = document.querySelector('.modal-title');
  const btnSave = $('btnSaveTx');
  const btnEdit = $('btnEditTx');
  const btnDelete = $('btnDeleteTx');
  const form = $('txForm');
  if (title) title.textContent = 'Movimiento';
  if (btnSave) btnSave.style.display = 'none';
  if (btnEdit) btnEdit.style.display = '';
  if (btnDelete) btnDelete.style.display = '';
  setFormControlsDisabled(form, true);
  editingTxId = null;
  if (btnDelete) {
    btnDelete.onclick = async () => {
      await deleteTx(txId);
      closeModal();
    };
  }
  if (btnEdit) {
    btnEdit.onclick = () => {
      setFormControlsDisabled(form, false);
      if (btnSave) btnSave.style.display = '';
      btnEdit.style.display = 'none';
      editingTxId = txId;
    };
  }
}

function setModalMode(mode, txId = null) {
  if (mode === 'create') {
    applyCreateModalMode();
  } else if (mode === 'view') {
    applyViewModalMode(txId);
  }
}

async function resolveDefaultTxAccountId() {
  if (state.currentViewId === 'account-detail' && state.currentAccountId) {
    return state.currentAccountId;
  }

  if (state.currentViewId === 'home') {
    let accounts = getSortedAccounts(state.accounts || []);
    if (!accounts.length) {
      accounts = getSortedAccounts(await api('/accounts'));
      state.accounts = accounts;
    }
    return accounts[0]?.id || null;
  }

  return null;
}

async function openCreateTxModal(preselectedAccountId = null) {
  setModalMode('create');
  const defaultAccountId =
    preselectedAccountId || (await resolveDefaultTxAccountId());
  await populateTxAccountSelect(defaultAccountId);
  openModal('modalAddTx');
}

// Cargar cuentas en el selector del modal de transacción
async function populateTxAccountSelect(selectedAccountId = null) {
  const sel = $('txAccount');
  if (!sel) return;
  try {
    // Use cached accounts from state instead of API call
    let accounts = state.accounts || [];
    if (!accounts.length) {
      // Only call API if cache is empty
      accounts = await api('/accounts');
      state.accounts = accounts;
    }

    sel.innerHTML = '<option value="">(Opcional) Cuenta</option>';
    accounts.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.name}`;
      sel.appendChild(opt);
    });

    if (selectedAccountId) {
      sel.value = String(selectedAccountId);
    }
  } catch (err) {
    // Account select population failed - using empty options
    sel.innerHTML = '<option value="">(Opcional) Cuenta</option>';
  }
}

function syncHomeTransferButton(button, account) {
  if (!button) return;
  const canTransfer = Boolean(account?.id);
  button.disabled = !canTransfer;
  button.onclick = canTransfer
    ? async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await openTransferModal(account.id);
      }
    : null;
}

function syncHomeResetButton(button, account) {
  if (!button) return;
  const canReset = Boolean(account?.id);
  button.disabled = !canReset;
  button.onclick = canReset
    ? async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await confirmAndResetAccount(account.id, account.name, false);
      }
    : null;
}

function disableHomeCardNavigation(homeCard) {
  if (!homeCard) return;
  homeCard.classList.remove('home-account-card--clickable');
  homeCard.removeAttribute('role');
  homeCard.removeAttribute('tabindex');
  homeCard.onclick = null;
  homeCard.onkeydown = null;
}

function enableHomeCardNavigation(homeCard, accountId) {
  if (!homeCard || !accountId) return;
  homeCard.classList.add('home-account-card--clickable');
  homeCard.setAttribute('role', 'button');
  homeCard.setAttribute('tabindex', '0');
  homeCard.onclick = () => openViewAccount(accountId);
  homeCard.onkeydown = (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      openViewAccount(accountId);
    }
  };
}

function applyEmptyHomeAccountState(
  homeCard,
  homeTransferBtn,
  homeResetBtn,
  homeSpendDistribution
) {
  applyAccountTheme(homeCard, { name: 'Cuenta', type: 'bank' });
  $('homeAccountName').textContent = 'Sin cuenta';
  $('homeAccountSubtitle').textContent = 'Cuenta principal';
  $('homeAccountBalance').textContent = '0.00€';
  $('homeAccountType').textContent = 'Cuenta';

  disableHomeCardNavigation(homeCard);
  syncHomeTransferButton(homeTransferBtn, null);
  syncHomeResetButton(homeResetBtn, null);

  const homeBadge = $('homeAccountBadge');
  if (homeBadge) {
    homeBadge.innerHTML = getAccountBadgeMarkup(
      { name: 'Cuenta', type: 'bank' },
      'account-brand-badge--hero'
    );
  }

  const txList = $('homeAccountTxList');
  if (txList) {
    txList.innerHTML =
      '<div class="muted" style="text-align:center; margin: 20px 0;">No hay movimientos aún.</div>';
  }
  if (homeSpendDistribution) {
    homeSpendDistribution.innerHTML = buildAccountSpendDistributionCard([]);
  }
}

function getTransferFormValues() {
  const source = $('transferSourceAccount')?.value || '';
  const destination = $('transferDestinationAccount')?.value || '';
  const amountValue = $('transferAmount')?.value || '';
  const amount = Number.parseFloat(amountValue || '0');
  return { source, destination, amount, amountValue };
}

function syncTransferFormState() {
  const btnSaveTransfer = $('btnSaveTransfer');
  const hint = $('transferValidationHint');
  const { source, destination, amount, amountValue } = getTransferFormValues();

  let message = 'Selecciona origen, destino e importe.';
  if (source && !destination) message = 'Selecciona la cuenta destino.';
  if (!source && destination) message = 'Selecciona la cuenta origen.';
  if (source && destination && source === destination) {
    message = 'Origen y destino deben ser distintos.';
  }
  if (
    source &&
    destination &&
    source !== destination &&
    amountValue &&
    amount <= 0
  ) {
    message = 'El importe debe ser mayor que cero.';
  }

  const isValid =
    Boolean(source) &&
    Boolean(destination) &&
    source !== destination &&
    Boolean(amountValue) &&
    amount > 0;

  if (hint) {
    hint.textContent = isValid ? 'Formulario listo para transferir.' : message;
  }
  if (btnSaveTransfer) {
    btnSaveTransfer.disabled = !isValid;
  }

  return isValid;
}

function swapTransferAccounts() {
  const sourceSel = $('transferSourceAccount');
  const destinationSel = $('transferDestinationAccount');
  if (!sourceSel || !destinationSel) return;

  const sourceValue = sourceSel.value;
  sourceSel.value = destinationSel.value;
  destinationSel.value = sourceValue;
  syncTransferFormState();
}

async function populateTransferAccountSelects(sourceAccountId = null) {
  const sourceSel = $('transferSourceAccount');
  const destinationSel = $('transferDestinationAccount');
  if (!sourceSel || !destinationSel) return;

  try {
    // Use cached accounts from state instead of API call
    let accounts = state.accounts || [];
    if (!accounts.length) {
      // Only call API if cache is empty
      accounts = await api('/accounts');
      state.accounts = accounts;
    }
    accounts = getSortedAccounts(accounts);

    const currentSourceId = String(sourceAccountId || sourceSel.value || '');
    sourceSel.innerHTML = '<option value="">Cuenta origen</option>';
    destinationSel.innerHTML = '<option value="">Cuenta destino</option>';

    accounts.forEach((account) => {
      const sourceOption = document.createElement('option');
      sourceOption.value = account.id;
      sourceOption.textContent = account.name;
      sourceSel.appendChild(sourceOption);

      const destinationOption = document.createElement('option');
      destinationOption.value = account.id;
      destinationOption.textContent = account.name;
      destinationSel.appendChild(destinationOption);
    });

    if (currentSourceId) {
      sourceSel.value = currentSourceId;
      if (destinationSel.value === currentSourceId) destinationSel.value = '';
    }
    syncTransferFormState();
  } catch (err) {
    // Transfer selects population failed - continuing
  }
}

async function openTransferModal(sourceAccountId = null) {
  const form = $('transferForm');
  if (form) form.reset();
  await populateTransferAccountSelects(
    sourceAccountId || state.currentAccountId
  );
  syncTransferFormState();
  openModal('modalTransfer');
}

async function saveTransfer() {
  if (!syncTransferFormState()) return;

  const source_account_id = $('transferSourceAccount')?.value || '';
  const destination_account_id = $('transferDestinationAccount')?.value || '';
  const amount = Number.parseFloat($('transferAmount')?.value || '0');
  const description = ($('transferDescription')?.value || '').trim();

  try {
    await api('/transfers', {
      method: 'POST',
      json: true,
      body: JSON.stringify({
        source_account_id,
        destination_account_id,
        amount,
        description: description || 'Transferencia entre cuentas',
        date: new Date().toISOString()
      })
    });

    closeModal('modalTransfer');
    // Load accounts and home in parallel, not sequentially
    await Promise.all([loadAccounts(), loadHomeAccount()]);
    if (state.currentViewId === 'account-detail' && state.currentAccountId) {
      await openViewAccount(state.currentAccountId);
    } else {
      loadViewContent(state.currentViewId);
    }
    showAlert('Transferencia registrada', 'success');
  } catch (err) {
    showAlert(
      'Error registrando transferencia: ' + (err?.message || String(err)),
      'error'
    );
  }
}

async function openViewTx(txId) {
  try {
    const tx = await api(`/transactions/${txId}`);
    if (!tx) throw new Error('Transacción no encontrada');

    // Prefill form (same fields as edit)
    $('txAmount').value = tx.amount || '';
    $('txType').value = tx.type || 'expense';
    updateCategoriesForType(); // Filtrar categorías según el tipo
    $('txCategory').value = tx.category_id || '';
    onCategoryChange();
    setTimeout(() => {
      if (tx.subcategory_id) $('txSubcategory').value = tx.subcategory_id;
    }, 50);
    $('txDesc').value = tx.note || '';
    if ($('txDate') && tx.date) {
      $('txDate').value = new Date(tx.date).toISOString().slice(0, 10);
    }
    if ($('txAccount')) {
      await populateTxAccountSelect();
      $('txAccount').value = tx.account_id || '';
    }

    setModalMode('view', txId);
    openModal();
  } catch (err) {
    showAlert(
      'No se pudo cargar la transacción: ' + (err?.message || String(err)),
      'error'
    );
  }
}

// ---------- CUENTA MANAGEMENT ----------
function buildAccountsDistributionCard(accounts) {
  const items = (accounts || [])
    .map((acc) => {
      const positive = Math.max(Number(acc.current_balance || 0), 0);
      return {
        name: String(acc.name || 'Cuenta'),
        amount: positive,
        accent: getAccountAccent(acc)
      };
    })
    .filter((item) => item.amount > 0);

  const total = items.reduce((sum, item) => sum + item.amount, 0);

  if (total <= 0) {
    return `
      <div class="accounts-distribution-card">
        <p class="accounts-distribution-title">Distribución entre cuentas</p>
        <p class="accounts-distribution-empty">No hay saldo positivo para calcular porcentajes.</p>
      </div>
    `;
  }

  let progress = 0;
  const gradientParts = items.map((item) => {
    const pct = (item.amount / total) * 100;
    const start = progress;
    progress += pct;
    return `${item.accent} ${start.toFixed(2)}% ${progress.toFixed(2)}%`;
  });
  const ringGradient = gradientParts.join(', ');

  const legendHtml = items
    .map((item) => {
      const pct = (item.amount / total) * 100;
      return `
        <div class="accounts-distribution-item">
          <span class="accounts-distribution-dot" style="--dot-color:${item.accent}"></span>
          <span class="accounts-distribution-copy">
            <span class="accounts-distribution-name">${escapeHtml(item.name)}</span>
            <span class="accounts-distribution-amount">${item.amount.toFixed(2)}€</span>
          </span>
          <span class="accounts-distribution-pct">${pct.toFixed(1)}%</span>
        </div>
      `;
    })
    .join('');

  return `
    <div class="accounts-distribution-card">
      <p class="accounts-distribution-title">Distribución entre cuentas</p>
      <div class="accounts-distribution-wrap">
        <div class="accounts-distribution-ring" style="--ring-gradient:${ringGradient}">
          <div class="accounts-distribution-ring-center">
            <span class="accounts-distribution-total-label">Total</span>
            <span class="accounts-distribution-total-value">${total.toFixed(2)}€</span>
          </div>
        </div>
        <div class="accounts-distribution-legend">${legendHtml}</div>
      </div>
    </div>
  `;
}

function getSortedAccounts(accounts = []) {
  return [...(accounts || [])].sort((a, b) => {
    const aHasOrder = Number.isInteger(a?.order);
    const bHasOrder = Number.isInteger(b?.order);
    if (aHasOrder && bHasOrder) return a.order - b.order;
    if (aHasOrder) return -1;
    if (bHasOrder) return 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'es');
  });
}

async function persistAccountsOrder(orderedAccounts = []) {
  const accountIds = orderedAccounts.map((acc) => acc?.id).filter(Boolean);
  if (!accountIds.length) return;
  await api('/accounts/reorder', {
    method: 'POST',
    json: true,
    body: JSON.stringify({ account_ids: accountIds })
  });
}

async function moveAccountByDirection(accountId, direction) {
  const sortedAccounts = getSortedAccounts(state.accounts || []);
  const currentIndex = sortedAccounts.findIndex(
    (acc) => String(acc.id) === String(accountId)
  );
  if (currentIndex < 0) return;

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sortedAccounts.length) return;

  const [moved] = sortedAccounts.splice(currentIndex, 1);
  sortedAccounts.splice(targetIndex, 0, moved);

  try {
    await persistAccountsOrder(sortedAccounts);
    await Promise.all([loadAccounts(), loadHomeAccount()]);
    showAlert('Orden de cuentas actualizado', 'info');
  } catch (err) {
    showAlert(err?.message || 'No se pudo actualizar el orden', 'error');
  }
}

async function setAccountAsPrincipal(accountId) {
  const sortedAccounts = getSortedAccounts(state.accounts || []);
  const currentIndex = sortedAccounts.findIndex(
    (acc) => String(acc.id) === String(accountId)
  );
  if (currentIndex <= 0) return;

  const [selected] = sortedAccounts.splice(currentIndex, 1);
  sortedAccounts.unshift(selected);

  try {
    await persistAccountsOrder(sortedAccounts);
    await Promise.all([loadAccounts(), loadHomeAccount()]);
    showAlert('Cuenta principal actualizada', 'info');
  } catch (err) {
    showAlert(err?.message || 'No se pudo fijar la cuenta principal', 'error');
  }
}

function getAccountsFromOrderedIds(orderedIds = [], accounts = []) {
  const accountById = new Map(
    (accounts || []).map((acc) => [String(acc.id), acc])
  );
  return orderedIds
    .map((accountId) => accountById.get(String(accountId)))
    .filter(Boolean);
}

function isAccountOpenLocked() {
  return Date.now() < Number(state.accountsDragLockUntil || 0);
}

function attachAccountCardsInteractions(container) {
  if (!container) return;

  const cards = Array.from(container.querySelectorAll('.account-card'));
  if (!cards.length) return;

  cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      if (isAccountOpenLocked()) return;
      if (event.target.closest('.account-card-actions')) return;
      const accountId = card.dataset.accountId || '';
      if (accountId) openViewAccount(accountId);
    });
  });

  let draggingId = null;
  let initialOrder = cards
    .map((card) => card.dataset.accountId || '')
    .join('|');

  const getCardById = (accountId) =>
    cards.find(
      (card) => String(card.dataset.accountId || '') === String(accountId)
    );

  const saveDragOrderIfChanged = async () => {
    const orderedIds = Array.from(container.querySelectorAll('.account-card'))
      .map((card) => card.dataset.accountId || '')
      .filter(Boolean);
    const nextOrder = orderedIds.join('|');
    if (!orderedIds.length || nextOrder === initialOrder) return;

    const reorderedAccounts = getAccountsFromOrderedIds(
      orderedIds,
      state.accounts || []
    );
    if (!reorderedAccounts.length) return;

    try {
      await persistAccountsOrder(reorderedAccounts);
      state.accounts = reorderedAccounts;
      initialOrder = nextOrder;
      await Promise.all([loadAccounts(), loadHomeAccount()]);
      showAlert('Orden de cuentas actualizado', 'info');
    } catch (err) {
      showAlert(err?.message || 'No se pudo actualizar el orden', 'error');
      await loadAccounts();
    }
  };

  cards.forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      draggingId = card.dataset.accountId || null;
      state.accountsDragLockUntil = Date.now() + 900;
      card.classList.add('is-dragging');
      container.classList.add('is-reordering');
      if (event.dataTransfer && draggingId) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggingId);
      }
    });

    card.addEventListener('dragover', (event) => {
      if (!draggingId) return;
      const targetId = card.dataset.accountId || '';
      if (!targetId || targetId === draggingId) return;

      event.preventDefault();
      const draggingCard = getCardById(draggingId);
      if (!draggingCard || draggingCard === card) return;

      const rect = card.getBoundingClientRect();
      const placeBefore = event.clientY < rect.top + rect.height / 2;
      if (placeBefore) {
        card.before(draggingCard);
      } else {
        card.after(draggingCard);
      }
    });

    card.addEventListener('drop', (event) => {
      event.preventDefault();
    });

    card.addEventListener('dragend', async () => {
      card.classList.remove('is-dragging');
      container.classList.remove('is-reordering');
      state.accountsDragLockUntil = Date.now() + 280;
      draggingId = null;
      await saveDragOrderIfChanged();
    });
  });
}

async function loadAccounts() {
  try {
    const accounts = getSortedAccounts(await api('/accounts'));
    state.accounts = accounts || [];
    const container = $('accountsList');
    if (!container) return;

    if (!accounts || accounts.length === 0) {
      container.innerHTML =
        '<div class="muted" style="margin: 30px 0; text-align: center;">No tienes cuentas aún. Añade una para empezar.</div>';
      return;
    }

    const cardsHtml = accounts
      .map((acc, index) => {
        const typeLabel =
          {
            bank: '🏦 Banco',
            cash: '💵 Efectivo',
            credit: '💳 Tarjeta crédito'
          }[acc.type] || acc.type;

        const balance = Number(acc.current_balance || 0).toFixed(2);
        const [mainName, subtitle = 'Cuenta'] = String(acc.name || '')
          .split('·')
          .map((part) => part.trim())
          .filter(Boolean);
        const accent = getAccountAccent(acc);
        const surface = getAccountSurface(acc);
        const border = getAccountBorder(acc);
        const isNegativeBalance = Number(acc.current_balance || 0) < 0;
        const subtitleClass = /ahorro|hucha/i.test(subtitle)
          ? 'account-card-subtitle account-card-subtitle--muted'
          : 'account-card-subtitle';
        const balanceClass = isNegativeBalance
          ? 'account-card-balance-value account-card-balance-value--negative'
          : 'account-card-balance-value account-card-balance-value--positive';
        return `
          <div class="account-card" data-account-id="${acc.id}" draggable="true" style="margin-bottom: 12px; --account-accent: ${accent}; --account-surface: ${surface}; --account-border: ${border};">
            <div class="account-card-top">
              <div class="account-card-top-main">
                ${getAccountBadgeMarkup(acc, 'account-brand-badge--small')}
                <div class="account-card-copy">
                  <h2 class="account-card-title">${mainName || acc.name}</h2>
                  <p class="${subtitleClass}">${subtitle}</p>
                </div>
              </div>
              <div class="account-card-actions">
                <button class="account-card-transfer-btn" data-account-id="${acc.id}" type="button" title="Transferir desde esta cuenta">
                  <i class="ph ph-arrows-left-right"></i>
                </button>
                <button class="account-card-pin-btn" data-account-id="${acc.id}" type="button" title="Fijar como principal" ${index === 0 ? 'disabled' : ''}>
                  <i class="ph ph-push-pin-simple"></i>
                </button>
                <button class="account-card-order-btn" data-account-id="${acc.id}" data-direction="up" type="button" title="Subir" ${index === 0 ? 'disabled' : ''}>
                  <i class="ph ph-arrow-up"></i>
                </button>
                <button class="account-card-order-btn" data-account-id="${acc.id}" data-direction="down" type="button" title="Bajar" ${index === accounts.length - 1 ? 'disabled' : ''}>
                  <i class="ph ph-arrow-down"></i>
                </button>
                <button class="account-card-reset-btn" data-account-id="${acc.id}" data-account-name="${escapeHtml(acc.name || '')}" type="button" title="Reiniciar cuenta">
                  <i class="ph ph-arrow-counter-clockwise"></i>
                </button>
              </div>
            </div>
            <div class="account-card-meta">
              <span class="account-card-type">${typeLabel}</span>
              <div class="account-card-balance">
                <p class="account-card-balance-label">Saldo</p>
                <p class="${balanceClass}">${balance}€</p>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    container.innerHTML = cardsHtml;
    container.querySelectorAll('.account-card-reset-btn').forEach((button) => {
      button.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const accountId = button.dataset.accountId || '';
        const accountName = button.dataset.accountName || 'cuenta';
        if (!accountId) return;
        await confirmAndResetAccount(accountId, accountName, false);
      });
    });
    container
      .querySelectorAll('.account-card-transfer-btn')
      .forEach((button) => {
        button.addEventListener('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const accountId = button.dataset.accountId || '';
          if (!accountId) return;
          await openTransferModal(accountId);
        });
      });
    container.querySelectorAll('.account-card-order-btn').forEach((button) => {
      button.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (button.disabled) return;
        const accountId = button.dataset.accountId || '';
        const direction = button.dataset.direction || 'up';
        if (!accountId) return;
        await moveAccountByDirection(accountId, direction);
      });
    });
    container.querySelectorAll('.account-card-pin-btn').forEach((button) => {
      button.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (button.disabled) return;
        const accountId = button.dataset.accountId || '';
        if (!accountId) return;
        await setAccountAsPrincipal(accountId);
      });
    });
    attachAccountCardsInteractions(container);
  } catch (err) {
    $('accountsList').innerHTML =
      `<div class="muted">Error cargando cuentas: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

function syncAccountFormPreview() {
  renderVisualPreview(
    'accountImagePreview',
    accountFormImageData,
    $('accountIcon')?.value || '',
    '🏦'
  );
}

async function openEditAccountModal(accountId) {
  if (!accountId) return;

  try {
    const account = await api(`/accounts/${accountId}`);
    const form = $('accountForm');
    if (form) form.reset();

    const accountNameParts = String(account.name || '')
      .split('·')
      .map((part) => part.trim());
    const accountMainName = accountNameParts[0] || account.name || '';
    const accountSubtitle = accountNameParts.slice(1).join(' · ');

    $('accountName').value = accountMainName;
    if ($('accountSubtitle')) $('accountSubtitle').value = accountSubtitle;
    $('accountType').value = account.type || 'bank';
    $('accountBalance').value = String(account.balance_inicial ?? 0);
    $('accountIcon').value = account.icon || '';
    $('accountBgColor').value = account.bg_color || '#eef2ff';
    $('accountBorderColor').value = account.border_color || '#c7d2fe';
    accountFormImageData = account.image_data || null;
    if ($('accountImageUrl')) {
      $('accountImageUrl').value =
        account.image_data && /^https?:\/\//i.test(account.image_data)
          ? account.image_data
          : '';
    }
    clearFileInput('accountImage');
    syncAccountFormPreview();

    const title = document.querySelector('#modalAddAccount .modal-title');
    if (title) title.textContent = 'Editar cuenta';

    const btnSave = $('btnSaveAccount');
    if (btnSave)
      btnSave.innerHTML = '<i class="ph ph-check"></i> Guardar cambios';

    const btnDelete = $('btnDeleteAccount');
    if (btnDelete) {
      btnDelete.style.display = '';
      btnDelete.onclick = async () => {
        if (
          confirm(
            `¿Eliminar la cuenta "${account.name}"? No podrás recuperarla.`
          )
        ) {
          await deleteAccount(accountId);
          closeModal('modalAddAccount');
          if (state.currentViewId === 'account-detail') {
            backToAccounts();
          }
        }
      };
    }

    state.editingAccountId = accountId;
    openModal('modalAddAccount');
  } catch (err) {
    showAlert(
      'Error cargando cuenta para editar: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function openAddAccountModal() {
  const form = $('accountForm');
  if (form) {
    form.reset();
    $('accountName').value = '';
    if ($('accountSubtitle')) $('accountSubtitle').value = 'Principal';
    $('accountType').value = 'bank';
    $('accountBalance').value = '0.00';
  }
  accountFormImageData = null;
  if ($('accountIcon')) $('accountIcon').value = '';
  if ($('accountImageUrl')) $('accountImageUrl').value = '';
  if ($('accountBgColor')) $('accountBgColor').value = '#eef2ff';
  if ($('accountBorderColor')) $('accountBorderColor').value = '#c7d2fe';
  clearFileInput('accountImage');
  syncAccountFormPreview();

  const title = document.querySelector('#modalAddAccount .modal-title');
  if (title) title.textContent = 'Añadir cuenta';

  const btnDelete = $('btnDeleteAccount');
  if (btnDelete) btnDelete.style.display = 'none';

  const btnSave = $('btnSaveAccount');
  if (btnSave) {
    btnSave.style.display = '';
    btnSave.innerHTML = '<i class="ph ph-check"></i> Guardar';
  }

  if (btnDelete) {
    btnDelete.onclick = null;
  }

  const allInputs = document.querySelectorAll(
    '#modalAddAccount input, #modalAddAccount select'
  );
  allInputs.forEach((i) => (i.disabled = false));

  state.editingAccountId = null;
  openModal('modalAddAccount');
}

async function openViewAccount(accountId) {
  try {
    const originViewId =
      state.currentViewId && state.currentViewId !== 'account-detail'
        ? state.currentViewId
        : state.accountDetailOriginViewId || 'accounts';
    state.accountDetailOriginViewId = originViewId;

    const acc = await api(`/accounts/${accountId}`);
    if (!acc) throw new Error('Cuenta no encontrada');
    const detailCard = document.querySelector('.account-detail-card');
    let sortedAccounts = getSortedAccounts(state.accounts || []);
    if (!sortedAccounts.length) {
      sortedAccounts = getSortedAccounts(await api('/accounts'));
      state.accounts = sortedAccounts;
    }

    // Show account details in the detail view
    const typeLabel =
      {
        bank: '🏦 Banco',
        cash: '💵 Efectivo',
        credit: '💳 Tarjeta crédito'
      }[acc.type] || acc.type;

    $('accountDetailType').textContent = typeLabel;
    const [detailName, detailSubtitle = 'Cuenta'] = String(acc.name || '')
      .split('·')
      .map((part) => part.trim())
      .filter(Boolean);
    $('accountDetailName').textContent = detailName || acc.name;
    $('accountDetailSubtitle').textContent = detailSubtitle;
    $('accountDetailSubtitle').classList.toggle(
      'account-subtitle-muted',
      /ahorro|hucha/i.test(detailSubtitle)
    );
    const balance = Number(acc.current_balance || 0).toFixed(2);
    $('accountDetailBalance').textContent = `${balance}€`;
    applyAccountTheme(detailCard, acc);
    const detailBadge = $('accountDetailBadge');
    if (detailBadge) detailBadge.innerHTML = getAccountBadgeMarkup(acc);

    // Load transactions for this account
    await loadAccountTransactions(accountId);

    // Setup delete button
    const btnDelete = $('btnDeleteAccountDetail');
    if (btnDelete) {
      btnDelete.onclick = async () => {
        if (
          confirm(`¿Eliminar la cuenta "${acc.name}"? No podrás recuperarla.`)
        ) {
          await deleteAccount(accountId);
          backToAccounts();
        }
      };
    }

    const btnEdit = $('btnEditAccountDetail');
    if (btnEdit) {
      btnEdit.onclick = async () => {
        await openEditAccountModal(accountId);
      };
    }

    const btnTransfer = $('btnTransferAccountDetail');
    if (btnTransfer) {
      btnTransfer.onclick = async () => {
        await openTransferModal(accountId);
      };
    }

    const btnReset = $('btnResetAccountDetail');
    if (btnReset) {
      btnReset.onclick = async () => {
        await confirmAndResetAccount(accountId, acc.name, true);
      };
    }

    const btnPin = $('btnPinAccountDetail');
    if (btnPin) {
      const isPrincipal =
        String(sortedAccounts[0]?.id || '') === String(accountId || '');
      btnPin.disabled = isPrincipal;
      btnPin.title = isPrincipal
        ? 'Esta cuenta ya es la principal'
        : 'Fijar como principal';
      btnPin.onclick = async () => {
        if (btnPin.disabled) return;
        await setAccountAsPrincipal(accountId);
        const refreshed = getSortedAccounts(await api('/accounts'));
        state.accounts = refreshed;
        const nowPrincipal =
          String(refreshed[0]?.id || '') === String(accountId || '');
        btnPin.disabled = nowPrincipal;
        btnPin.title = nowPrincipal
          ? 'Esta cuenta ya es la principal'
          : 'Fijar como principal';
      };
    }

    const btnExport = $('btnExportAccountDetail');
    if (btnExport) {
      btnExport.onclick = () => {
        const txs = Array.isArray(state.currentAccountTransactions)
          ? state.currentAccountTransactions
          : [];
        if (!txs.length) {
          showAlert('No hay movimientos para exportar en esta cuenta', 'error');
          return;
        }
        const normalizedName = String(acc.name || 'cuenta')
          .toLowerCase()
          .split(/\s+/)
          .join('-');
        const fileLabel = [...normalizedName]
          .filter((char) => {
            const isLetter = char >= 'a' && char <= 'z';
            const isNumber = char >= '0' && char <= '9';
            return isLetter || isNumber || char === '-';
          })
          .join('');
        exportHistoryToCSV(txs, fileLabel || 'cuenta');
      };
    }

    // Store current account and navigate to detail view
    state.currentAccountId = accountId;
    switchView('account-detail', acc.name);
  } catch (err) {
    showAlert(
      'Error cargando cuenta: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function getAccountAccent(account) {
  const customAccent = normalizeColorValue(account?.bg_color);
  if (customAccent) return customAccent;

  const name = String(account?.name || '').toLowerCase();
  const type = String(account?.type || '').toLowerCase();

  if (name.includes('trade republic')) return '#86efac';
  if (name.includes('hucha') || name.includes('ahorro')) return '#ec4899';
  if (name.includes('santander')) return '#fecaca';
  if (name.includes('imagin')) return '#93c5fd';
  if (type === 'credit') return '#c4b5fd';
  if (type === 'cash') return '#fde68a';

  return 'rgba(255, 255, 255, 0.78)';
}

function getAccountSurface(account) {
  const customAccent = normalizeColorValue(account?.bg_color);
  if (customAccent) {
    return `color-mix(in srgb, ${customAccent} 18%, white)`;
  }

  const name = String(account?.name || '').toLowerCase();
  const type = String(account?.type || '').toLowerCase();

  if (name.includes('trade republic')) return 'rgba(17, 24, 39, 0.06)';
  if (name.includes('hucha') || name.includes('ahorro'))
    return 'rgba(236, 72, 153, 0.12)';
  if (name.includes('santander')) return 'rgba(254, 202, 202, 0.16)';
  if (name.includes('imagin')) return 'rgba(96, 165, 250, 0.12)';
  if (type === 'credit') return 'rgba(167, 139, 250, 0.12)';
  if (type === 'cash') return 'rgba(251, 191, 36, 0.12)';

  return 'rgba(203, 213, 225, 0.12)';
}

function getAccountBorder(account) {
  const customBorder = normalizeColorValue(account?.border_color);
  if (customBorder) return customBorder;

  const name = String(account?.name || '').toLowerCase();

  if (name.includes('trade republic')) return '#111111';
  if (name.includes('imagin')) return '#60a5fa';
  if (name.includes('santander')) return '#fecaca';

  return 'color-mix(in srgb, var(--account-accent) 44%, white)';
}

function getAccountBrand(account) {
  const customIcon = String(account?.icon || '').trim();
  const customImage = String(account?.image_data || '').trim();
  const customAccent = normalizeColorValue(account?.bg_color);
  const customBorder = normalizeColorValue(account?.border_color);

  if (customIcon || customImage) {
    return {
      brand: 'custom',
      icon: customIcon || '🏦',
      label: String(account?.name || 'Cuenta'),
      imageData: customImage || null,
      accent: customAccent,
      border: customBorder
    };
  }

  const name = String(account?.name || '').toLowerCase();
  const type = String(account?.type || '').toLowerCase();

  if (name.includes('trade republic')) {
    return {
      brand: 'trade-republic',
      icon: 'ph-chart-line-up',
      label: 'Trade Republic',
      logoPath: '../media/unnamed (2).png'
    };
  }

  if (name.includes('hucha') || name.includes('ahorro')) {
    return {
      brand: 'savings',
      icon: 'ph-piggy-bank',
      label: 'Ahorro',
      logoPath: '../media/hucha.png'
    };
  }

  if (name.includes('santander')) {
    return {
      brand: 'santander',
      icon: 'ph-flame',
      label: 'Santander',
      logoPath: '../media/santander(2).png'
    };
  }

  if (name.includes('imagin')) {
    return {
      brand: 'imagin',
      icon: 'ph-star-four',
      label: 'Imagin',
      logoPath: '../media/unnamed (1).png'
    };
  }

  if (type === 'credit') {
    return { brand: 'credit', icon: 'ph-credit-card', label: 'Crédito' };
  }

  if (type === 'cash') {
    return { brand: 'cash', icon: 'ph-wallet', label: 'Efectivo' };
  }

  return { brand: 'default', icon: 'ph-bank', label: 'Cuenta' };
}

function getAccountBadgeMarkup(account, sizeClass = '') {
  const brand = getAccountBrand(account);
  const sizeClassName = sizeClass ? ` ${sizeClass}` : '';
  const styleParts = [];
  if (brand.accent) styleParts.push(`--account-badge-accent:${brand.accent}`);
  if (brand.border) styleParts.push(`--account-badge-border:${brand.border}`);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
  if (brand.imageData) {
    return `<span class="account-brand-badge account-brand-badge--custom account-brand-badge--image${sizeClassName}" data-brand="${brand.brand}" title="${brand.label}"${styleAttr}><img class="account-brand-logo" src="${brand.imageData}" alt="${brand.label}" loading="lazy" decoding="async" /></span>`;
  }
  if (brand.logoPath) {
    return `<span class="account-brand-badge account-brand-badge--logo${sizeClassName}" data-brand="${brand.brand}" title="${brand.label}"${styleAttr}><img class="account-brand-logo" src="${brand.logoPath}" alt="${brand.label}" loading="lazy" decoding="async" /></span>`;
  }

  if (brand.brand === 'custom') {
    return `<span class="account-brand-badge account-brand-badge--custom${sizeClassName}" data-brand="${brand.brand}" title="${brand.label}"${styleAttr}>${brand.icon}</span>`;
  }

  return `<span class="account-brand-badge${sizeClassName}" data-brand="${brand.brand}" title="${brand.label}"><i class="ph ${brand.icon}"></i></span>`;
}

function applyAccountTheme(element, account) {
  if (!element) return;
  element.style.setProperty('--account-accent', getAccountAccent(account));
  element.style.setProperty('--account-surface', getAccountSurface(account));
  element.style.setProperty('--account-border', getAccountBorder(account));
}

async function loadAccountTransactions(accountId) {
  try {
    // Get account name from cache (state.accounts) instead of extra API call
    let accountName = null;
    const cachedAccount = (state.accounts || []).find(
      (acc) => String(acc.id) === String(accountId)
    );
    if (cachedAccount) {
      accountName = cachedAccount.name || null;
    }

    // Load all transactions for this user and filter client-side
    const list = await fetchAllTransactions();

    // Filter by account_id (match by id OR by account name for legacy txs)
    const filtered = list.filter((t) => {
      const acc_id = t.account_id || null;
      if (!acc_id) return false;
      return acc_id === accountId || (accountName && acc_id === accountName);
    });

    const txList = $('accountTxList');
    const spendDistribution = $('accountSpendDistribution');
    if (!txList) return;

    if (spendDistribution) {
      spendDistribution.innerHTML = buildAccountSpendDistributionCard(filtered);
    }

    state.currentAccountTransactions = annotateTransactionsWithRunningBalances(
      sortTransactionsByMostRecent(filtered)
    );

    if (filtered.length === 0) {
      txList.innerHTML =
        '<div class="muted" style="margin: 20px 0; text-align: center;">No hay movimientos en esta cuenta.</div>';
      return;
    }

    const html = state.currentAccountTransactions
      .map((t) => renderTxItem(t, true))
      .join('');

    txList.innerHTML = html;

    // Click handler
    txList.querySelectorAll('.tx-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        const id = el.dataset.id;
        openViewTx(id);
      });
    });
  } catch (err) {
    state.currentAccountTransactions = [];
    $('accountTxList').innerHTML =
      `<div class="muted">Error cargando transacciones: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}
async function saveAccount() {
  const name = ($('accountName').value || '').trim();
  const subtitle = ($('accountSubtitle')?.value || '').trim();
  const type = $('accountType')?.value || 'bank';
  const balance = Number.parseFloat($('accountBalance').value || '0');
  const icon = ($('accountIcon')?.value || '').trim();
  const imageUrlInput = $('accountImageUrl')?.value || '';
  const bg_color = $('accountBgColor')?.value || '#eef2ff';
  const border_color = $('accountBorderColor')?.value || '#c7d2fe';

  if (!name) {
    showAlert('Introduce un nombre para la cuenta', 'error');
    return;
  }

  try {
    const composedName = subtitle ? `${name} · ${subtitle}` : name;
    const remoteImageUrl = normalizeRemoteImageUrl(imageUrlInput);
    const payload = {
      name: composedName,
      type,
      balance_inicial: balance,
      icon: icon || null,
      image_data: remoteImageUrl || accountFormImageData,
      bg_color,
      border_color
    };

    if (state.editingAccountId) {
      await api(`/accounts/${state.editingAccountId}`, {
        method: 'PATCH',
        json: true,
        body: JSON.stringify(payload)
      });
    } else {
      await api('/accounts', {
        method: 'POST',
        json: true,
        body: JSON.stringify(payload)
      });
    }

    closeModal('modalAddAccount');
    await Promise.all([loadAccounts(), loadHomeAccount()]);
    if (
      state.editingAccountId &&
      state.currentAccountId === state.editingAccountId
    ) {
      await openViewAccount(state.editingAccountId);
    }
    state.editingAccountId = null;
  } catch (err) {
    showAlert(
      'Error guardando cuenta: ' + (err?.message || String(err)),
      'error'
    );
  }
}

async function deleteAccount(accountId) {
  try {
    await api(`/accounts/${accountId}`, { method: 'DELETE' });
    await loadAccounts();
  } catch (err) {
    showAlert(
      'Error eliminando cuenta: ' + (err?.message || String(err)),
      'error'
    );
  }
}

async function confirmAndResetAccount(
  accountId,
  accountName = 'cuenta',
  reopenDetail = false
) {
  const ok = confirm(
    `¿Reiniciar la cuenta "${accountName}"? Se borrarán solo sus movimientos y su saldo inicial pasará a 0,00€.`
  );
  if (!ok) return;

  const done = await resetAccount(accountId, accountName);
  if (!done) return;

  if (reopenDetail) {
    await openViewAccount(accountId);
    return;
  }

  loadViewContent(state.currentViewId);
}

async function resetAccount(accountId, accountName = 'cuenta') {
  try {
    await api(`/accounts/${accountId}/reset`, { method: 'POST' });
    await loadAccounts();
    showAlert(`Cuenta "${accountName}" reiniciada`, 'success');
    return true;
  } catch (err) {
    showAlert(
      'Error reiniciando cuenta: ' + (err?.message || String(err)),
      'error'
    );
    return false;
  }
}

// ---------- Navegación ----------
function loadViewContent(viewId) {
  if (viewId === 'accounts') return void loadAccounts();
  if (viewId === 'home') {
    return void loadHomeAccount();
  }
  if (viewId === 'dashboard') return void loadDashboardView();
  if (viewId === 'history') return void loadHistoryView();
  if (viewId === 'stats') return void loadBudgetsView();
  if (viewId === 'reminders')
    return void loadReminders({ notifyAdvance: true });
  if (viewId !== 'config') return;
  syncAppSettingsControls();
  if (token && !state.user) {
    hasValidStoredSession();
  } else {
    renderProfileIdentity();
  }
  loadCategoryTree();
  loadAccounts()
    .then(() => loadAutomationWorkspace())
    .catch((err) => {
      // Failed to load automations - continuing
    });
}

function applyViewChrome(viewId, ev) {
  const isLogin = viewId === 'login';
  const showTxFab = new Set(['home', 'history', 'account-detail']).has(viewId);
  const top = document.querySelector('.top-bar');
  const tab = document.querySelector('.tab-bar');
  const fab = $('openAddModal');
  if (top) top.style.display = isLogin ? 'none' : '';
  if (tab) tab.style.display = isLogin ? 'none' : '';
  if (fab) fab.style.display = !isLogin && showTxFab ? '' : 'none';
  document
    .querySelectorAll('.tab-item')
    .forEach((btn) => btn.classList.remove('active'));
  if (ev?.currentTarget) ev.currentTarget.classList.add('active');
}

function switchView(viewId, title, ev) {
  document.querySelectorAll('.view').forEach((v) => (v.style.display = 'none'));
  const view = $(`view-${viewId}`);
  if (view) view.style.display = viewId === 'login' ? 'flex' : 'block';
  const appContainer = document.querySelector('.app-container');
  if (appContainer) {
    appContainer.classList.toggle('auth-layout', viewId === 'login');
  }
  $('viewTitle').textContent = title;
  state.currentViewId = viewId;
  applyViewChrome(viewId, ev);
  loadViewContent(viewId);
}

function getAccountDetailReturnConfig() {
  const originViewId = state.accountDetailOriginViewId || 'accounts';
  return START_VIEW_CONFIG[originViewId] || START_VIEW_CONFIG.accounts;
}

// Navigate back from account-detail to the real origin view
function backToAccounts() {
  const target = getAccountDetailReturnConfig();
  switchView(target.id, target.title);
}
globalThis.switchView = switchView;
globalThis.backToAccounts = backToAccounts;

// ---------- Init helpers ----------
function exportHistoryToCSV(transactions, monthLabel) {
  if (!transactions.length) {
    showAlert('No hay movimientos para exportar', 'error');
    return;
  }
  const headers = [
    'Fecha',
    'Tipo',
    'Categoría',
    'Subcategoría',
    'Cuenta',
    'Nota',
    'Importe'
  ];
  const rows = transactions.map((tx) => {
    const cat = state.catsById.get(tx.category_id);
    const sub = tx.subcategory_id
      ? state.catsById.get(tx.subcategory_id)
      : null;
    const account = findAccountForTransaction(tx);
    const date = new Date(tx.date).toLocaleDateString('es-ES');
    const type = tx.type === 'expense' ? 'Gasto' : 'Ingreso';
    const catName = cat?.name || tx.category_id || '';
    const subName = sub?.name || '';
    const accountName = account?.name || tx.account_id || '';
    const note = String(tx.note || '').replaceAll('"', '""');
    const amount = (tx.type === 'expense' ? -1 : 1) * Number(tx.amount || 0);
    return [
      date,
      type,
      catName,
      subName,
      accountName,
      `"${note}"`,
      amount.toFixed(2)
    ].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movimientos-${monthLabel || 'historial'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function initModalListeners() {
  const btnAdd = $('btnAddAccount');
  const btnFab = $('openAddModal');
  const btnSave = $('btnSaveTx');
  const btnLogout = $('btnLogout');
  const btnSettings = $('btnSettings');
  const viewTitle = $('viewTitle');

  const goHomeFromTopBar = () => {
    if (state.currentViewId === 'home') return;
    switchView('home', 'Inicio');
  };

  if (viewTitle) {
    viewTitle.style.cursor = 'pointer';
    viewTitle.addEventListener('click', goHomeFromTopBar);
    viewTitle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      goHomeFromTopBar();
    });
  }

  if (btnSettings)
    btnSettings.addEventListener('click', () =>
      switchView('config', 'Ajustes')
    );
  if (btnAdd)
    btnAdd.addEventListener('click', async () => {
      await openCreateTxModal();
    });
  if (btnFab)
    btnFab.addEventListener('click', async () => {
      await openCreateTxModal();
    });
  document.querySelectorAll('.close-modal').forEach((button) => {
    button.addEventListener('click', () => {
      const modalHost = button.closest('.modal');
      closeModal(modalHost?.id || 'modalAddTx');
    });
  });
  if (btnSave) btnSave.addEventListener('click', saveTx);
  if (btnLogout) btnLogout.addEventListener('click', logout);
}

function initAccountListeners() {
  const btnAddNewAccount = $('btnAddNewAccount');
  const btnAccountsTransfer = $('btnAccountsTransfer');
  const btnSaveAccount = $('btnSaveAccount');
  const btnSaveTransfer = $('btnSaveTransfer');
  const btnSwapTransferAccounts = $('btnSwapTransferAccounts');
  const btnSync = $('btnSync');
  const btnDeleteAccount = $('btnDeleteAccount');
  const accountIcon = $('accountIcon');
  const accountImage = $('accountImage');
  const accountImageUrl = $('accountImageUrl');
  const btnClearAccountImage = $('btnClearAccountImage');
  const btnCloseAccount = document.querySelector(
    '#modalAddAccount .close-modal'
  );
  if (btnAddNewAccount)
    btnAddNewAccount.addEventListener('click', openAddAccountModal);
  if (btnAccountsTransfer)
    btnAccountsTransfer.addEventListener('click', async () => {
      await openTransferModal();
    });
  if (btnSaveAccount) btnSaveAccount.addEventListener('click', saveAccount);
  if (btnSaveTransfer) btnSaveTransfer.addEventListener('click', saveTransfer);
  if (btnSwapTransferAccounts)
    btnSwapTransferAccounts.addEventListener('click', swapTransferAccounts);
  if (btnDeleteAccount)
    btnDeleteAccount.addEventListener('click', (event) => {
      event.preventDefault();
    });
  if (btnCloseAccount)
    btnCloseAccount.addEventListener('click', () =>
      closeModal('modalAddAccount')
    );
  if (btnSync) btnSync.addEventListener('click', loadCategoryTree);
  const transferSourceAccount = $('transferSourceAccount');
  const transferDestinationAccount = $('transferDestinationAccount');
  const transferAmount = $('transferAmount');
  const transferDescription = $('transferDescription');
  if (transferSourceAccount) {
    transferSourceAccount.addEventListener('change', () => {
      const destinationSel = $('transferDestinationAccount');
      if (destinationSel?.value === transferSourceAccount.value) {
        destinationSel.value = '';
      }
      syncTransferFormState();
    });
  }
  if (transferDestinationAccount) {
    transferDestinationAccount.addEventListener(
      'change',
      syncTransferFormState
    );
  }
  if (transferAmount) {
    transferAmount.addEventListener('input', syncTransferFormState);
  }
  if (transferDescription) {
    transferDescription.addEventListener('input', syncTransferFormState);
  }
  if (accountIcon) {
    accountIcon.addEventListener('input', () => {
      if (accountFormImageData && accountIcon.value.trim()) {
        accountFormImageData = null;
        clearFileInput('accountImage');
        if (accountImageUrl) accountImageUrl.value = '';
      }
      syncAccountFormPreview();
    });
  }
  if (accountImageUrl) {
    const syncRemotePreview = () => {
      if (!accountImageUrl.value.trim()) {
        if (!accountFormImageData) syncAccountFormPreview();
        return;
      }
      try {
        accountFormImageData = normalizeRemoteImageUrl(accountImageUrl.value);
        if (accountIcon) accountIcon.value = '';
        clearFileInput('accountImage');
        syncAccountFormPreview();
      } catch {
        // No interrumpimos mientras escribe; validamos definitivamente al guardar.
      }
    };
    accountImageUrl.addEventListener('input', syncRemotePreview);
    accountImageUrl.addEventListener('blur', syncRemotePreview);
  }
  if (accountImage) {
    accountImage.addEventListener('change', async (event) => {
      const [file] = event.target.files || [];
      if (!file) {
        accountFormImageData = null;
        syncAccountFormPreview();
        return;
      }

      try {
        accountFormImageData = await readImageFileAsDataUrl(file);
        if (accountIcon) accountIcon.value = '';
        if (accountImageUrl) accountImageUrl.value = '';
        syncAccountFormPreview();
      } catch (err) {
        showAlert(err?.message || 'No se pudo cargar la imagen', 'error');
        accountFormImageData = null;
        clearFileInput('accountImage');
        syncAccountFormPreview();
      }
    });
  }
  if (btnClearAccountImage) {
    btnClearAccountImage.addEventListener('click', () => {
      accountFormImageData = null;
      clearFileInput('accountImage');
      if (accountImageUrl) accountImageUrl.value = '';
      syncAccountFormPreview();
    });
  }
}

function initHistoryListeners() {
  const txListFull = $('txListFull');
  const historyMonth = $('historyMonth');
  const historySelectVisibleBtn = $('historySelectVisibleBtn');
  const historyClearSelectionBtn = $('historyClearSelectionBtn');
  const historyExportSelectionBtn = $('historyExportSelectionBtn');
  const historyAccountFilter = $('historyAccountFilter');
  const historyCategoryFilter = $('historyCategoryFilter');
  const historyMinAmount = $('historyMinAmount');
  const historyMaxAmount = $('historyMaxAmount');
  const historySearchInput = $('historySearchInput');
  const historyTypeFilters = $('historyTypeFilters');
  const historyPresetSelect = $('historyPresetSelect');
  const historyPresetChips = $('historyPresetChips');
  const historySavePresetBtn = $('historySavePresetBtn');
  const historyQuickSavePresetBtn = $('historyQuickSavePresetBtn');
  const historyDeletePresetBtn = $('historyDeletePresetBtn');
  const historyRenamePresetBtn = $('historyRenamePresetBtn');
  const historyDuplicatePresetBtn = $('historyDuplicatePresetBtn');
  const historyToggleFavoritePresetBtn = $('historyToggleFavoritePresetBtn');
  const historyClearFiltersBtn = $('historyClearFiltersBtn');
  const historyResetRangeBtn = $('historyResetRangeBtn');
  const historyBackDashboardBtn = $('historyBackDashboardBtn');
  const historyCollapseAllBtn = $('historyCollapseAllBtn');
  const historyExpandAllBtn = $('historyExpandAllBtn');
  const historyExportPresetBtn = $('historyExportPresetBtn');
  const historyCopyFilterBtn = $('historyCopyFilterBtn');
  const historyPasteFilterBtn = $('historyPasteFilterBtn');
  syncHistoryRangeUi();
  historyFilterPresets = readHistoryFilterPresets();
  historyRecentPresetNames = readHistoryRecentPresetNames();
  historyFavoritePresetName = readHistoryFavoritePresetName();
  renderHistoryPresetSelect();
  renderHistoryPresetChips();
  restoreSavedHistoryState();
  syncHistoryFilterActivityUi();
  bindHistoryFilterInputs({
    historyMonth,
    historyAccountFilter,
    historyCategoryFilter,
    historyMinAmount,
    historyMaxAmount,
    historySearchInput,
    historyClearFiltersBtn,
    historyCollapseAllBtn,
    historyExpandAllBtn
  });
  bindHistorySelectionActions({
    historySelectVisibleBtn,
    historyClearSelectionBtn,
    historyExportSelectionBtn
  });
  bindHistoryRangeActions({
    historyResetRangeBtn,
    historyBackDashboardBtn
  });
  const historyExportCsvBtn = $('historyExportCsvBtn');
  if (historyExportPresetBtn)
    historyExportPresetBtn.addEventListener('click', () => {
      exportSelectedHistoryPresetToCSV();
    });
  if (historyCopyFilterBtn)
    historyCopyFilterBtn.addEventListener('click', () => {
      copyCurrentOrSelectedHistoryFilter();
    });
  if (historyPasteFilterBtn)
    historyPasteFilterBtn.addEventListener('click', () => {
      pasteHistoryFilterFromText();
    });
  if (historyExportCsvBtn)
    historyExportCsvBtn.addEventListener('click', () => {
      const monthInput = $('historyMonth');
      const monthLabel = monthInput?.value || getCurrentMonthValue();
      exportHistoryToCSV(historyFilteredTxns, monthLabel);
    });
  if (historyTypeFilters)
    historyTypeFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-history-type]');
      if (!button) return;
      setSelectedHistoryType(button.dataset.historyType || 'all');
      loadHistoryView();
    });
  if (historyPresetSelect)
    historyPresetSelect.addEventListener('change', () => {
      syncHistoryFavoritePresetButton();
      applySelectedHistoryPreset();
    });
  if (historySavePresetBtn)
    historySavePresetBtn.addEventListener('click', () => {
      saveCurrentHistoryPreset();
    });
  if (historyQuickSavePresetBtn)
    historyQuickSavePresetBtn.addEventListener('click', () => {
      saveQuickHistoryPreset();
    });
  if (historyDeletePresetBtn)
    historyDeletePresetBtn.addEventListener('click', () => {
      deleteSelectedHistoryPreset();
    });
  if (historyRenamePresetBtn)
    historyRenamePresetBtn.addEventListener('click', () => {
      renameSelectedHistoryPreset();
    });
  if (historyDuplicatePresetBtn)
    historyDuplicatePresetBtn.addEventListener('click', () => {
      duplicateSelectedHistoryPreset();
    });
  if (historyToggleFavoritePresetBtn)
    historyToggleFavoritePresetBtn.addEventListener('click', () => {
      toggleFavoriteSelectedHistoryPreset();
    });
  if (historyPresetChips)
    historyPresetChips.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-history-preset-chip]');
      if (!chip) return;
      applyHistoryPresetByName(chip.dataset.historyPresetChip || '');
    });
  if (txListFull) {
    txListFull.addEventListener('click', handleHistoryListClick);
    txListFull.addEventListener('change', handleHistoryListChange);
  }
}

function initBudgetListeners() {
  const budgetSaveBtn = $('budgetSaveBtn');
  const budgetCancelEditBtn = $('budgetCancelEditBtn');
  const budgetStatusFilters = $('budgetStatusFilters');
  if (budgetSaveBtn)
    budgetSaveBtn.addEventListener('click', () => {
      saveBudgetFromView();
    });
  if (budgetCancelEditBtn)
    budgetCancelEditBtn.addEventListener('click', () => {
      resetBudgetForm();
    });
  if (budgetStatusFilters)
    budgetStatusFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-budget-filter]');
      if (!button) return;
      setBudgetStatusFilter(button.dataset.budgetFilter || 'all');
      loadBudgetsView();
    });
  setBudgetStatusFilter(state.budgetStatusFilter || 'all');
}

function wirePasswordInputListeners(input, onCapsLock, onHide, onEnter) {
  if (!input) return;
  input.addEventListener('keydown', onCapsLock);
  input.addEventListener('keyup', onCapsLock);
  input.addEventListener('blur', onHide);
  input.addEventListener('keydown', onEnter);
}

function initProfileListeners() {
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

  if (profileAvatarChoices)
    profileAvatarChoices.addEventListener('click', (event) => {
      const button = event.target.closest('[data-avatar-choice]');
      if (!button) return;
      updateAppSetting('profileAvatar', button.dataset.avatarChoice || 'auto');
    });
  if (btnProfileChangePassword)
    btnProfileChangePassword.addEventListener('click', () => {
      changePasswordFromProfile();
    });
  if (btnProfileClearPasswords)
    btnProfileClearPasswords.addEventListener('click', () => {
      clearProfilePasswordForm(true);
    });
  if (profileCurrentPassword)
    profileCurrentPassword.addEventListener('input', () => {
      updateProfilePasswordFormState();
    });
  if (profileNextPassword)
    profileNextPassword.addEventListener('input', () => {
      updateProfilePasswordFormState();
    });
  if (profileConfirmPassword)
    profileConfirmPassword.addEventListener('input', () => {
      updateProfilePasswordFormState();
    });

  const updateProfileCapsLockHint = (event) => {
    const hint = $('profileCapsLockHint');
    if (!hint) return;
    const isCapsLockOn = event.getModifierState?.('CapsLock');
    hint.style.display = isCapsLockOn ? '' : 'none';
  };
  const hideProfileCapsLockHint = () => {
    const hint = $('profileCapsLockHint');
    if (!hint) return;
    hint.style.display = 'none';
  };

  const handleProfilePasswordEnter = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const submitBtn = $('btnProfileChangePassword');
    if (submitBtn?.disabled) return;
    changePasswordFromProfile();
  };
  wirePasswordInputListeners(
    profileCurrentPassword,
    updateProfileCapsLockHint,
    hideProfileCapsLockHint,
    handleProfilePasswordEnter
  );
  wirePasswordInputListeners(
    profileNextPassword,
    updateProfileCapsLockHint,
    hideProfileCapsLockHint,
    handleProfilePasswordEnter
  );
  wirePasswordInputListeners(
    profileConfirmPassword,
    updateProfileCapsLockHint,
    hideProfileCapsLockHint,
    handleProfilePasswordEnter
  );

  if (profileShowPasswords)
    profileShowPasswords.addEventListener('change', () => {
      const nextType = profileShowPasswords.checked ? 'text' : 'password';
      if (profileCurrentPassword) profileCurrentPassword.type = nextType;
      if (profileNextPassword) profileNextPassword.type = nextType;
      if (profileConfirmPassword) profileConfirmPassword.type = nextType;
    });
  if (settingDefaultView)
    settingDefaultView.addEventListener('change', () => {
      const nextView =
        settingDefaultView.value || DEFAULT_APP_SETTINGS.defaultView;
      updateAppSetting('defaultView', nextView);
      showAlert('Vista inicial guardada', 'info');
    });
  if (settingReduceMotion)
    settingReduceMotion.addEventListener('change', () => {
      updateAppSetting('reduceMotion', settingReduceMotion.checked);
    });
  if (settingAccentColor)
    settingAccentColor.addEventListener('change', () => {
      updateAppSetting(
        'accentColor',
        normalizeAccentColor(settingAccentColor.value)
      );
      showAlert('Color de la app guardado', 'info');
    });
  if (btnLogoutFromSettings)
    btnLogoutFromSettings.addEventListener('click', () => {
      if (!confirm('¿Seguro que quieres cerrar sesión?')) return;
      logout();
    });
}

function handleCategoryTreeAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const categoryId = button.dataset.id;
  if (!categoryId) return;

  if (action === 'edit-category') {
    openEditCategoryForm(categoryId);
  } else if (action === 'delete-category') {
    deleteCategoryItem(categoryId);
  } else if (action === 'add-subcategory') {
    openNewSubcategoryForm(categoryId);
  } else if (action === 'move-category-up') {
    moveCategoryItem(categoryId, 'up');
  } else if (action === 'move-category-down') {
    moveCategoryItem(categoryId, 'down');
  }
}

function handleCategoryTreeDragStart(event) {
  const row = event.target.closest('[draggable="true"][data-id][data-kind]');
  if (!row || event.target.closest('.tree-row-actions')) {
    event.preventDefault();
    return;
  }

  categoryDragState = {
    id: row.dataset.id || '',
    kind: row.dataset.kind || '',
    group: row.dataset.dragGroup || ''
  };

  row.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', categoryDragState.id);
  }
}

function handleCategoryTreeDragOver(event) {
  const row = event.target.closest('[draggable="true"][data-id][data-kind]');
  if (!row || !categoryDragState) return;
  if (
    row.dataset.id === categoryDragState.id ||
    row.dataset.kind !== categoryDragState.kind ||
    row.dataset.dragGroup !== categoryDragState.group
  ) {
    return;
  }

  event.preventDefault();
  const placement = getDragPlacement(row, event.clientY);
  clearCategoryDragStyles();
  row.classList.add(
    placement === 'after' ? 'is-drop-target-after' : 'is-drop-target-before'
  );
}

async function handleCategoryTreeDrop(event) {
  const row = event.target.closest('[draggable="true"][data-id][data-kind]');
  if (!row || !categoryDragState) return;
  if (
    row.dataset.id === categoryDragState.id ||
    row.dataset.kind !== categoryDragState.kind ||
    row.dataset.dragGroup !== categoryDragState.group
  ) {
    return;
  }

  event.preventDefault();
  const draggedId = categoryDragState.id;
  const targetId = row.dataset.id || '';
  const placement = getDragPlacement(row, event.clientY);
  clearCategoryDragStyles();
  categoryDragState = null;

  try {
    await moveCategoryItemByDrop(draggedId, targetId, placement);
  } catch (err) {
    showAlert(
      'No se pudo actualizar el orden: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function bindCategoryTreeListeners(categoriesTree) {
  if (!categoriesTree) return;
  categoriesTree.addEventListener('click', handleCategoryTreeAction);
  categoriesTree.addEventListener('dragstart', handleCategoryTreeDragStart);
  categoriesTree.addEventListener('dragover', handleCategoryTreeDragOver);
  categoriesTree.addEventListener('drop', handleCategoryTreeDrop);
  categoriesTree.addEventListener('dragend', () => {
    categoryDragState = null;
    clearCategoryDragStyles();
  });
}

function initCategoryListeners() {
  const btnNewCategory = $('btnNewCategory');
  const btnNewSubcategory = $('btnNewSubcategory');
  const btnSaveCategory = $('btnSaveCategory');
  const btnCancelCategory = $('btnCancelCategory');
  const btnClearCategoryImage = $('btnClearCategoryImage');
  const categoryParent = $('categoryFormParent');
  const categoryName = $('categoryFormName');
  const categoryIcon = $('categoryFormIcon');
  const categoryBgColor = $('categoryFormBgColor');
  const categoryImage = $('categoryFormImage');
  const categoryIconPicker = $('categoryIconPicker');
  const categoriesTree = $('categoriesTree');
  const catSel = $('txCategory');

  if (btnNewCategory)
    btnNewCategory.addEventListener('click', openNewCategoryForm);
  if (btnNewSubcategory)
    btnNewSubcategory.addEventListener('click', () => openNewSubcategoryForm());
  if (btnSaveCategory)
    btnSaveCategory.addEventListener('click', saveCategoryForm);
  if (btnCancelCategory)
    btnCancelCategory.addEventListener('click', () => {
      hideCategoryFormCard();
      resetCategoryForm({});
    });
  if (btnClearCategoryImage)
    btnClearCategoryImage.addEventListener('click', () => {
      categoryFormImageData = null;
      clearFileInput('categoryFormImage');
      syncCategoryFormState();
    });
  if (categoryParent)
    categoryParent.addEventListener('change', () => {
      syncCategoryFormState();
    });
  if (categoryName)
    categoryName.addEventListener('blur', () => {
      const iconInput = $('categoryFormIcon');
      if (iconInput && !iconInput.value.trim() && !categoryFormImageData) {
        iconInput.value = inferIconFromCategoryName(categoryName.value, '🧾');
        syncCategoryIconSelection();
      }
    });
  if (categoryIcon)
    categoryIcon.addEventListener('input', syncCategoryFormState);
  if (categoryBgColor)
    categoryBgColor.addEventListener('input', () => {
      categoryBgColorOverridden = true;
    });
  if (categoryImage)
    categoryImage.addEventListener('change', async () => {
      const file = categoryImage.files?.[0];
      if (!file) return;
      try {
        categoryFormImageData = await readImageFileAsDataUrl(file);
        syncCategoryFormState();
      } catch (err) {
        showAlert(err?.message || 'No se pudo cargar la imagen', 'error');
      }
    });
  if (categoryIconPicker)
    categoryIconPicker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-icon]');
      if (!button) return;
      const icon = button.dataset.icon || '';
      const iconInput = $('categoryFormIcon');
      if (iconInput) {
        iconInput.value = icon;
        syncCategoryFormState();
      }
    });
  bindCategoryTreeListeners(categoriesTree);
  if (catSel) catSel.addEventListener('change', onCategoryChange);
}

function toggleAuthForm(isRegister) {
  const loginContainer = $('loginFormContainer');
  const registerContainer = $('registerFormContainer');
  if (isRegister) {
    loginContainer.style.display = 'none';
    registerContainer.style.display = 'block';
  } else {
    loginContainer.style.display = 'block';
    registerContainer.style.display = 'none';
  }
}

function initAuthListeners() {
  const btnLogin = $('btnLogin');
  const btnRegister = $('btnRegister');
  const showRegister = $('showRegister');
  const showLogin = $('showLogin');
  if (btnLogin) btnLogin.addEventListener('click', login);
  if (btnRegister) btnRegister.addEventListener('click', register);
  if (showRegister)
    showRegister.addEventListener('click', (e) => {
      e.preventDefault();
      toggleAuthForm(true);
    });
  if (showLogin)
    showLogin.addEventListener('click', (e) => {
      e.preventDefault();
      toggleAuthForm(false);
    });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  modal = $('modalAddTx');
  attachModalOutsideClose();
  initModalListeners();
  initAccountListeners();
  initDashboardListeners();
  initHistoryListeners();
  initBudgetListeners();
  initProfileListeners();
  initReminderListeners();
  initCategoryListeners();
  initAutomationListeners();
  initAuthListeners();
  initSettingsAccordion();
  applyAutomationApiAvailability();
  loadAppSettings();
  applyAppSettings();
  updateProfilePasswordFormState();

  const hasSession = await hasValidStoredSession();
  if (!hasSession) {
    switchView('login', 'Inicio de sesión');
    return;
  }

  // Show app immediately; load categories + accounts in parallel background
  const startupView = getConfiguredStartView();
  switchView(startupView.id, startupView.title);

  Promise.all([loadCategoryTree(), loadAccounts()])
    .then(() => {
      resetCategoryForm({});
      renderCategoryIconPicker();
    })
    .catch((err) => {
      console.error('Error cargando categorías:', err);
      showAlert('No se pudieron cargar categorías al iniciar', 'error');
    });
});

// ---------- RESET USER DATA ----------
async function resetUserData() {
  if (
    !confirm(
      '⚠️ ADVERTENCIA: Se borrarán todos tus movimientos, cuentas y presupuestos.\n\nSe reinicializarán las 4 cuentas por defecto con saldo 0.\n\n¿Estás seguro?'
    )
  ) {
    return;
  }

  const confirmationText = prompt(
    'Para confirmar, escribe REINICIAR en mayúsculas:'
  );
  if (confirmationText !== 'REINICIAR') {
    showAlert('Operación cancelada. No se borró ningún dato.', 'error');
    return;
  }

  try {
    await api('/admin/reset-user-data', { method: 'POST' });
    showAlert('✅ Datos borrados y reinicializados. Recargando...', 'success');
    location.reload();
  } catch (err) {
    showAlert('Error al resetear: ' + (err?.message || String(err)), 'error');
  }
}
