// js/config/constants.js

export const API_STORAGE_KEY = 'financeApiBaseUrl';
export const DEFAULT_LOCAL_API = 'http://127.0.0.1:8000';
export const TRANSACTIONS_PAGE_SIZE = 500;
export const HISTORY_PAGE_SIZE = 30;
export const HISTORY_PASTE_UNDO_LIMIT = 3;
export const HISTORY_FETCH_PAGE_BLOCK = 2;

// Storage Keys
export const BUDGET_FILTER_STORAGE_KEY = 'budgetStatusFilter';
export const HISTORY_PRESETS_STORAGE_KEY = 'financeApp.history.filterPresets';
export const HISTORY_PRESET_RECENTS_STORAGE_KEY =
  'financeApp.history.presetRecents';
export const HISTORY_LAST_STATE_STORAGE_KEY = 'financeApp.history.lastState';
export const HISTORY_FAVORITE_PRESET_STORAGE_KEY =
  'financeApp.history.favoritePreset';
export const TOKEN_STORAGE_KEY = 'token';
export const REMEMBER_DEVICE_STORAGE_KEY = 'financeApp.auth.rememberDevice';
export const SETTINGS_DEFAULT_VIEW_KEY = 'financeApp.settings.defaultView';
export const SETTINGS_REDUCE_MOTION_KEY = 'financeApp.settings.reduceMotion';
export const SETTINGS_OPEN_PANEL_KEY = 'financeApp.settings.openPanel';
export const SETTINGS_PROFILE_AVATAR_KEY = 'financeApp.settings.profileAvatar';
export const SETTINGS_ACCENT_COLOR_KEY = 'financeApp.settings.accentColor';

// Configuraciones base
export const DEFAULT_APP_SETTINGS = {
  defaultView: 'home',
  reduceMotion: false,
  profileAvatar: 'auto',
  accentColor: '#6366f1'
};

export const PROFILE_AVATAR_CHOICES = [
  'auto',
  '🙂',
  '😎',
  '🧠',
  '💼',
  '💸',
  '🚀'
];

export const START_VIEW_CONFIG = {
  home: { id: 'home', title: 'Inicio' },
  dashboard: { id: 'dashboard', title: 'Resumen' },
  history: { id: 'history', title: 'Historial' },
  stats: { id: 'stats', title: 'Presupuestos' },
  accounts: { id: 'accounts', title: 'Cuentas' },
  reminders: { id: 'reminders', title: 'Recordatorios' }
};

export const REMINDER_TYPE_LABELS = {
  insurance: 'Seguro',
  subscription: 'Suscripción',
  other: 'Otro'
};

export const REMINDER_RECURRENCE_LABELS = {
  none: 'Sin repetición',
  monthly: 'Cada mes',
  yearly: 'Cada año'
};

export const LEGACY_ICON_MAP = {
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

export const CATEGORY_NAME_ICON_MAP = [
  [/nomina|nómina|salario/i, '💼'],
  [/extra|bonus/i, '✨'],
  [/regalo/i, '🎁'],
  [/interes/i, '📈'],
  [/venta/i, '🏷️'],
  [/hogar|alquiler|vivienda/i, '🏠'],
  [/suministro|luz|agua/i, '💡'],
  [/supermercado/i, '🛒'],
  [/aliment|ubereat|comida/i, '🍎'],
  [/restaurante|desayuno|snack|cena/i, '🍽️'],
  [/ocio|hobb|cine|concierto|evento|viaje/i, '🎨'],
  [/personal|médico|medico|peluquer|deporte|aseo/i, '🧘'],
  [/compra|ropa|tecnologia/i, '🛍️'],
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

export const CATEGORY_ICON_SET = new Set([
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

export const CATEGORY_ICON_GROUPS = [
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
  { label: 'Digital y suscripciones', icons: ['📱', '🌐', '☎️', '📶', '🔒'] },
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

export const CATEGORY_ICON_COLOR_MAP = {
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
