// src/state/state.js
import {
  DEFAULT_APP_SETTINGS,
  BUDGET_FILTER_STORAGE_KEY
} from '../config/constants.js';
import { loadStoredAppSettings } from '../services/storage.js';

function getInitialBudgetFilter() {
  try {
    return localStorage.getItem(BUDGET_FILTER_STORAGE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

export const state = {
  // Datos estructurales y colecciones
  tree: [],
  catsById: new Map(),
  accounts: [],
  recurringTemplates: [],
  automationRules: [],
  forecast: null,

  // Control de interfaz y arrastre
  accountsDragLockUntil: 0,
  accountDetailOriginViewId: 'accounts',
  homeSpendSinceDate: null,

  // Configuración y filtros de Dashboard
  dashboardSelectedAccountId: null,
  dashboardAccountSpendMode: 'all',
  dashboardSummaryMode: 'full',
  dashboardDateStart: '',
  dashboardDateEnd: '',
  dashboardUseCustomRange: false,

  // Estados de edición actuales
  budgetStatusFilter: getInitialBudgetFilter(),
  editingBudgetId: null,
  editingAccountId: null,
  editingCategoryId: null,
  currentAccountId: null,
  currentAccountTransactions: [],

  // Control de navegabilidad y recordatorios
  currentViewId: 'home',
  reminders: [],
  reminderFilter: 'all',

  // Estados y filtros de la vista de historial
  historyRangeStart: '',
  historyRangeEnd: '',
  historyRangeSource: '',
  historyPendingAccountId: '',
  historyPendingCategoryId: '',

  // Usuario y preferencias
  user: null,
  settings: loadStoredAppSettings()
};

export function resetAppState() {
  state.tree = [];
  state.catsById = new Map();
  state.accounts = [];
  state.recurringTemplates = [];
  state.automationRules = [];
  state.forecast = null;
  state.accountsDragLockUntil = 0;
  state.accountDetailOriginViewId = 'accounts';
  state.homeSpendSinceDate = null;
  state.dashboardSelectedAccountId = null;
  state.dashboardAccountSpendMode = 'all';
  state.dashboardSummaryMode = 'full';
  state.dashboardDateStart = '';
  state.dashboardDateEnd = '';
  state.dashboardUseCustomRange = false;
  state.budgetStatusFilter = 'all';
  state.editingBudgetId = null;
  state.editingAccountId = null;
  state.editingCategoryId = null;
  state.currentAccountId = null;
  state.currentAccountTransactions = [];
  state.currentViewId = 'home';
  state.reminders = [];
  state.reminderFilter = 'all';
  state.historyRangeStart = '';
  state.historyRangeEnd = '';
  state.historyRangeSource = '';
  state.historyPendingAccountId = '';
  state.historyPendingCategoryId = '';
  state.user = null;
  state.settings = { ...DEFAULT_APP_SETTINGS };

  if (
    globalThis.historySelectedTxIds &&
    typeof globalThis.historySelectedTxIds.clear === 'function'
  ) {
    globalThis.historySelectedTxIds.clear();
  }
}
