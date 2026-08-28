// src/main.js
import { state } from './state/state.js';
import { START_VIEW_CONFIG } from './config/constants.js';
import { $ } from './features/ui/dom.js';
import { showAlert } from './utils/toast.js';
import {
  loadStoredAppSettings,
  isRememberDeviceEnabled
} from './services/storage.js';
import { setSessionExpiredHandler, getApiToken } from './services/api.js';

import { attachModalOutsideClose, closeModal } from './features/ui/modals.js';
import {
  loadCategoryTree,
  initCategoryListeners,
  resetCategoryForm,
  renderCategoryIconPicker
} from './features/categories/categories.js';
import {
  loadAccounts,
  initAccountListeners,
  openViewAccount,
  setAccountsNavigationCallback
} from './features/accounts/accounts.js';
import {
  saveTx,
  openCreateTxModal,
  setTransactionRefreshCallbacks
} from './features/transactions/transactions.js';
import {
  loadHistoryView,
  initHistoryListeners
} from './features/history/history.js';
import {
  loadHomeAccount,
  loadDashboardView,
  initDashboardListeners
} from './features/dashboard/dashboard.js';
import {
  loadBudgetsView,
  initBudgetListeners
} from './features/budgets/budgets.js';
import {
  loadReminders,
  initReminderListeners
} from './features/reminders/reminders.js';
import {
  loadAutomationWorkspace,
  initAutomationListeners,
  applyAutomationApiAvailability
} from './features/automations/automations.js';
import {
  initProfileListeners,
  initSettingsAccordion,
  applyAppSettings,
  updateProfilePasswordFormState,
  renderProfileIdentity,
  logout,
  flushRemoteSettingsSync
} from './features/auth/profile.js';
import {
  initAuthListeners,
  hasValidStoredSession,
  getConfiguredStartView
} from './features/auth/auth.js';

// Exponer funciones globales requeridas por el DOM
globalThis.loadHomeAccount = loadHomeAccount;
globalThis.openViewAccount = openViewAccount;

export function loadViewContent(viewId) {
  if (viewId === 'accounts') return void loadAccounts();
  if (viewId === 'home') return void loadHomeAccount();
  if (viewId === 'dashboard') return void loadDashboardView();
  if (viewId === 'history') return void loadHistoryView();
  if (viewId === 'stats') return void loadBudgetsView();
  if (viewId === 'reminders') {
    return void loadReminders({ notifyAdvance: true });
  }
  if (viewId !== 'config') return;

  if (getApiToken() && !state.user) {
    hasValidStoredSession();
  } else {
    renderProfileIdentity();
  }

  loadCategoryTree();
  loadAccounts()
    .then(() => loadAutomationWorkspace())
    .catch(() => {});
}
globalThis.loadViewContent = loadViewContent;

export function applyViewChrome(viewId, ev) {
  const isLogin = viewId === 'login';
  const showTxFab = new Set(['home', 'history', 'account-detail']).has(viewId);
  const top = document.querySelector('.top-bar');
  const tab = document.querySelector('.tab-bar');
  const fab = $('openAddModal');

  if (top) top.style.display = isLogin ? 'none' : '';
  if (tab) tab.style.display = isLogin ? 'none' : '';
  if (fab) fab.style.display = !isLogin && showTxFab ? '' : 'none';

  document.querySelectorAll('.tab-item').forEach((btn) => {
    btn.classList.remove('active');
    btn.removeAttribute('aria-current');
  });

  const activeButton =
    ev?.currentTarget ||
    document.querySelector(`.tab-item[data-view="${viewId}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
    activeButton.setAttribute('aria-current', 'page');
  }
}

export function switchView(viewId, title, ev) {
  document.querySelectorAll('.view').forEach((v) => (v.style.display = 'none'));
  const view = $(`view-${viewId}`);
  if (view) view.style.display = viewId === 'login' ? 'flex' : 'block';

  const appContainer = document.querySelector('.app-container');
  if (appContainer) {
    appContainer.classList.toggle('auth-layout', viewId === 'login');
  }

  const titleEl = $('viewTitle');
  if (titleEl) titleEl.textContent = title;

  state.currentViewId = viewId;
  applyViewChrome(viewId, ev);
  loadViewContent(viewId);
}
globalThis.switchView = switchView;

export function backToAccounts() {
  const originViewId = state.accountDetailOriginViewId || 'accounts';
  const target = START_VIEW_CONFIG[originViewId] || START_VIEW_CONFIG.accounts;
  switchView(target.id, target.title);
}
globalThis.backToAccounts = backToAccounts;

function initNavigationListeners() {
  document.querySelectorAll('.tab-item[data-view]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', (ev) => {
      const viewId = tabBtn.dataset.view;
      const config = START_VIEW_CONFIG[viewId];
      if (config) {
        switchView(config.id, config.title, ev);
      }
    });
  });

  setAccountsNavigationCallback((viewId, title) => {
    switchView(viewId, title);
  });
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
  }

  if (btnSettings) {
    btnSettings.addEventListener('click', () =>
      switchView('config', 'Ajustes')
    );
  }
  if (btnAdd) btnAdd.addEventListener('click', () => openCreateTxModal());
  if (btnFab) btnFab.addEventListener('click', () => openCreateTxModal());

  document.querySelectorAll('.close-modal').forEach((button) => {
    button.addEventListener('click', () => {
      const modalHost = button.closest('.modal');
      closeModal(modalHost?.id || 'modalAddTx');
    });
  });

  if (btnSave) btnSave.addEventListener('click', saveTx);
  if (btnLogout) btnLogout.addEventListener('click', logout);
}

// Inicialización de la aplicación
document.addEventListener('DOMContentLoaded', async () => {
  setSessionExpiredHandler(logout);
  attachModalOutsideClose();
  initNavigationListeners();
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
  state.settings = loadStoredAppSettings();
  applyAppSettings();
  updateProfilePasswordFormState();

  const rememberCheckbox = $('loginRememberDevice');
  if (rememberCheckbox) rememberCheckbox.checked = isRememberDeviceEnabled();

  const hasSession = await hasValidStoredSession();
  if (!hasSession) {
    switchView('login', 'Inicio de sesión');
    return;
  }

  const startupView = getConfiguredStartView();
  switchView(startupView.id, startupView.title);

  Promise.all([
    loadCategoryTree(),
    startupView.id === 'home' || startupView.id === 'accounts'
      ? Promise.resolve()
      : loadAccounts()
  ])
    .then(() => {
      resetCategoryForm({});
      renderCategoryIconPicker();
    })
    .catch((err) => {
      console.error('Error cargando datos al iniciar:', err);
      showAlert('No se pudieron cargar categorías al iniciar', 'error');
    });
});

window.addEventListener('pagehide', flushRemoteSettingsSync);

// Configurar el callback directo de transacciones
setTransactionRefreshCallbacks({
  onRefresh: async () => {
    await loadAccounts();
    if (state.currentViewId) {
      loadViewContent(state.currentViewId);
    }
  },
  onOpenViewAccount: (accId) => {
    openViewAccount(accId);
  }
});

// Escuchar evento global por si se dispara desde otros módulos
window.addEventListener('finance:transactions-changed', async () => {
  await loadAccounts();
  if (state.currentViewId) {
    loadViewContent(state.currentViewId);
  }
});
