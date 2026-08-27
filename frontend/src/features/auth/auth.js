// js/features/auth/auth.js
import { state } from '../../state/state.js';
import {
  API,
  setApiToken,
  getApiToken,
  fetchJsonSilent,
  readErrorMessage
} from '../../services/api.js';
import { START_VIEW_CONFIG } from '../../config/constants.js';
import { $ } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import {
  persistAuthToken,
  clearPersistedAuthToken
} from '../../services/storage.js';
import { renderProfileIdentity, fetchRemoteAppSettings } from './profile.js';
import { ensureBackendCapabilities } from '../automations/automations.js';
import { loadCategoryTree } from '../categories/categories.js';
import { loadAccounts } from '../accounts/accounts.js';

export function getConfiguredStartView() {
  const candidate = state.settings.defaultView;
  if (START_VIEW_CONFIG[candidate]) return START_VIEW_CONFIG[candidate];
  return START_VIEW_CONFIG.home;
}

export function setAuthSubmitLoading(mode = 'login', isLoading = false) {
  const loginBtn = $('btnLogin');
  const registerBtn = $('btnRegister');

  if (loginBtn) {
    if (!loginBtn.dataset.defaultLabel)
      loginBtn.dataset.defaultLabel = loginBtn.textContent || 'Entrar';
    loginBtn.disabled = isLoading;
    loginBtn.classList.toggle('is-loading', isLoading && mode === 'login');
    loginBtn.textContent =
      isLoading && mode === 'login'
        ? 'Entrando...'
        : loginBtn.dataset.defaultLabel;
  }

  if (registerBtn) {
    if (!registerBtn.dataset.defaultLabel)
      registerBtn.dataset.defaultLabel =
        registerBtn.textContent || 'Crear cuenta';
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

export async function login() {
  const email = $('loginEmail')?.value?.trim();
  const password = $('loginPassword')?.value || '';
  const rememberDevice = Boolean($('loginRememberDevice')?.checked);

  if (!email || !password) {
    showAlert('Introduce email y contraseña', 'error');
    return;
  }

  setAuthSubmitLoading('login', true);

  console.log('Enviando petición a:', `${API}/auth/login`);
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password })
    });

    if (!res.ok)
      throw new Error(await readErrorMessage(res, 'Error al autenticar'));

    const data = await res.json();
    console.log('Código HTTP:', res.status, data);
    setApiToken(data.access_token);
    persistAuthToken(data.access_token, rememberDevice);
    if ($('loginPassword')) $('loginPassword').value = '';

    const startupView = getConfiguredStartView();
    globalThis.switchView?.(startupView.id, startupView.title);
    schedulePostAuthHydration(startupView.id);
  } catch (err) {
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

export async function register() {
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

    const data = await res.json();
    setApiToken(data.access_token);
    persistAuthToken(data.access_token, false);
    if ($('registerPassword')) $('registerPassword').value = '';

    const startupView = getConfiguredStartView();
    globalThis.switchView?.(startupView.id, startupView.title);
    schedulePostAuthHydration(startupView.id);
  } catch (err) {
    if (err?.code === 'SESSION_EXPIRED' || err?.code === 'NO_AUTH') return;
    showAlert('Registro fallido: ' + (err?.message ?? String(err)), 'error');
  } finally {
    setAuthSubmitLoading('register', false);
  }
}

export async function refreshSessionMetadataInBackground() {
  if (!getApiToken()) return;
  const { ok, data } = await fetchJsonSilent('/me');
  if (!ok || !data) return;

  state.user = data;
  renderProfileIdentity();
  Promise.allSettled([ensureBackendCapabilities(), fetchRemoteAppSettings()]);
}

export function schedulePostAuthHydration(startupViewId = 'home') {
  setTimeout(() => {
    refreshSessionMetadataInBackground().catch(() => {});
  }, 220);

  setTimeout(() => {
    loadCategoryTree().catch(() => {});
    if (startupViewId !== 'home' && startupViewId !== 'accounts') {
      loadAccounts().catch(() => {});
    }
  }, 420);
}

export async function hasValidStoredSession() {
  const token = getApiToken();
  if (!token) return false;

  try {
    const res = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      mode: 'cors'
    });

    if (res.ok) {
      const me = await res.json().catch(() => null);
      state.user = me;
      renderProfileIdentity();
      Promise.allSettled([
        ensureBackendCapabilities(),
        fetchRemoteAppSettings()
      ]);
      return true;
    }

    if (res.status === 401) {
      clearPersistedAuthToken();
      setApiToken('');
      state.user = null;
      renderProfileIdentity();
      return false;
    }
    return false;
  } catch {
    renderProfileIdentity();
    return false;
  }
}

export function toggleAuthForm(isRegister) {
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

export function initAuthListeners() {
  const btnLogin = $('btnLogin');
  const btnRegister = $('btnRegister');
  const showRegister = $('showRegister');
  const showLogin = $('showLogin');
  if (btnLogin) btnLogin.addEventListener('click', login);
  if (btnRegister) btnRegister.addEventListener('click', register);
  if (showRegister) {
    showRegister.addEventListener('click', (e) => {
      e.preventDefault();
      toggleAuthForm(true);
    });
  }
  if (showLogin) {
    showLogin.addEventListener('click', (e) => {
      e.preventDefault();
      toggleAuthForm(false);
    });
  }
}
