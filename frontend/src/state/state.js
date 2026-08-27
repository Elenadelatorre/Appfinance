// js/state/state.js
import {
  DEFAULT_APP_SETTINGS,
  BUDGET_FILTER_STORAGE_KEY
} from '../config/constants.js';

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
  budgetStatusFilter: localStorage.getItem(BUDGET_FILTER_STORAGE_KEY) || 'all',
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
  settings: { ...DEFAULT_APP_SETTINGS }
};
