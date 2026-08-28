// src/features/history/history.js
import { state } from '../../state/state.js';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_FETCH_PAGE_BLOCK,
  HISTORY_PRESETS_STORAGE_KEY,
  HISTORY_PRESET_RECENTS_STORAGE_KEY,
  HISTORY_LAST_STATE_STORAGE_KEY,
  HISTORY_FAVORITE_PRESET_STORAGE_KEY,
} from '../../config/constants.js';
import { $, escapeHtml, renderListEmptyState } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import {
  getCategoryVisual,
  hasCustomCategoryVisual,
} from '../../utils/visuals.js';
import { ensureCategoriesLoaded } from '../categories/categories.js';
import { ensureAccountsLoaded } from '../accounts/accounts.js';
import {
  fetchAllTransactions,
  sortTransactionsByMostRecent,
  annotateTransactionsWithRunningBalances,
  renderTxItem,
  openViewTx,
} from '../transactions/transactions.js';
import { exportHistoryToCSV } from './historyExport.js';

const collapsedHistoryGroups = new Set();
export const historySelectedTxIds = new Set();
globalThis.historySelectedTxIds = historySelectedTxIds;

let historyFilteredTxns = [];
let historyVisibleCount = HISTORY_PAGE_SIZE;
let historyFilterPresets = [];
let historyRecentPresetNames = [];
let historyFavoritePresetName = '';
let historyFetchPages = HISTORY_FETCH_PAGE_BLOCK;
let historyCanLoadMoreData = false;
let historySearchTimer = null;

export function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isHistoryRangeActive() {
  return Boolean(state.historyRangeStart && state.historyRangeEnd);
}

export function formatHistoryRangeLabel(startValue = '', endValue = '') {
  const start = new Date(`${startValue}T00:00:00Z`);
  const end = new Date(`${endValue}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '';
  }
  const fmt = new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

export function syncHistoryRangeUi() {
  const monthInput = $('historyMonth');
  const context = $('historyRangeContext');
  const resetRangeBtn = $('historyResetRangeBtn');
  const backBtn = $('historyBackDashboardBtn');
  const active = isHistoryRangeActive();

  if (monthInput) {
    monthInput.disabled = active;
    monthInput.title = active ? 'Desactiva el rango para filtrar por mes' : '';
  }

  if (context) {
    const sourceLabel =
      state.historyRangeSource === 'dashboard' ? 'desde Resumen' : 'rango';
    const label = formatHistoryRangeLabel(
      state.historyRangeStart,
      state.historyRangeEnd
    );
    const fallbackLabel = `${state.historyRangeStart} - ${state.historyRangeEnd}`;

    context.style.display = active ? 'inline-flex' : 'none';
    if (!active) context.textContent = '';
    else context.textContent = `${sourceLabel}: ${label || fallbackLabel}`;
  }

  if (resetRangeBtn) resetRangeBtn.style.display = active ? '' : 'none';
  if (backBtn) backBtn.style.display = active ? '' : 'none';
}

export function openHistoryFromDashboardCategory(categoryId, summary = {}) {
  const rangeStart = String(summary?.period_start || '').slice(0, 10);
  const rangeEnd = String(summary?.period_end || '').slice(0, 10);

  state.historyPendingCategoryId = String(categoryId || '').trim();
  state.historyRangeStart = rangeStart;
  state.historyRangeEnd = rangeEnd;
  state.historyRangeSource = 'dashboard';

  globalThis.switchView?.('history', 'Historial');
}

export function openHistoryForAccount(accountId) {
  const normalizedAccountId = String(accountId || '').trim();
  if (!normalizedAccountId) {
    globalThis.switchView?.('history', 'Historial');
    return;
  }
  state.historyPendingAccountId = normalizedAccountId;
  globalThis.switchView?.('history', 'Historial');
}

export function formatHistoryDayLabel(date) {
  const label = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function renderHistoryGroup(dateKey, transactions = []) {
  const date = new Date(`${dateKey}T00:00:00Z`);
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
    <section class="history-group${isCollapsed ? ' is-collapsed' : ''}" data-history-date="${escapeHtml(dateKey)}">
      <button
        type="button"
        class="history-group-header history-group-toggle"
        data-history-toggle="${escapeHtml(dateKey)}"
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

export function applyHistoryGroupState(dateKey) {
  const group = document.querySelector(
    `[data-history-date="${CSS.escape(dateKey)}"]`
  );
  const toggle = document.querySelector(
    `[data-history-toggle="${CSS.escape(dateKey)}"]`
  );
  const isCollapsed = collapsedHistoryGroups.has(dateKey);

  if (group) group.classList.toggle('is-collapsed', isCollapsed);
  if (toggle)
    toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
}

export function getRenderedHistoryDates() {
  return Array.from(
    document.querySelectorAll('#txListFull [data-history-date]')
  )
    .map((element) => element.dataset.historyDate || '')
    .filter(Boolean);
}

export function toggleHistoryGroup(dateKey) {
  if (!dateKey) return;
  if (collapsedHistoryGroups.has(dateKey))
    collapsedHistoryGroups.delete(dateKey);
  else collapsedHistoryGroups.add(dateKey);
  applyHistoryGroupState(dateKey);
}

export function setAllHistoryGroupsCollapsed(collapsed) {
  getRenderedHistoryDates().forEach((dateKey) => {
    if (collapsed) collapsedHistoryGroups.add(dateKey);
    else collapsedHistoryGroups.delete(dateKey);
    applyHistoryGroupState(dateKey);
  });
}

export function getSelectedHistoryType() {
  const active = document.querySelector(
    '#historyTypeFilters .history-filter-btn.is-active'
  );
  return active?.dataset.historyType || 'all';
}

export function setSelectedHistoryType(typeValue = 'all') {
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

export function readHistoryFilterPresets() {
  try {
    const raw = localStorage.getItem(HISTORY_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string' && item.filters)
      .map((item) => ({
        name: String(item.name).trim(),
        filters: item.filters,
      }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

export function readHistoryRecentPresetNames() {
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

export function persistHistoryFilterPresets() {
  localStorage.setItem(
    HISTORY_PRESETS_STORAGE_KEY,
    JSON.stringify(historyFilterPresets)
  );
}

export function persistHistoryRecentPresetNames() {
  localStorage.setItem(
    HISTORY_PRESET_RECENTS_STORAGE_KEY,
    JSON.stringify(historyRecentPresetNames)
  );
}

export function readHistoryFavoritePresetName() {
  return String(
    localStorage.getItem(HISTORY_FAVORITE_PRESET_STORAGE_KEY) || ''
  ).trim();
}

export function persistHistoryFavoritePresetName() {
  if (historyFavoritePresetName) {
    localStorage.setItem(
      HISTORY_FAVORITE_PRESET_STORAGE_KEY,
      historyFavoritePresetName
    );
    return;
  }
  localStorage.removeItem(HISTORY_FAVORITE_PRESET_STORAGE_KEY);
}

export function readHistoryLastState() {
  try {
    const raw = localStorage.getItem(HISTORY_LAST_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      selectedMonth: String(parsed.selectedMonth || '').trim(),
      selectedType: String(parsed.selectedType || 'all').trim() || 'all',
      selectedAccountId:
        String(parsed.selectedAccountId || 'all').trim() || 'all',
      selectedCategoryId:
        String(parsed.selectedCategoryId || 'all').trim() || 'all',
      minAmount: String(parsed.minAmount || '').trim(),
      maxAmount: String(parsed.maxAmount || '').trim(),
      searchTerm: String(parsed.searchTerm || ''),
      rangeStart: String(parsed.rangeStart || '').trim(),
      rangeEnd: String(parsed.rangeEnd || '').trim(),
      rangeSource: String(parsed.rangeSource || '').trim(),
      selectedPresetName: String(parsed.selectedPresetName || '').trim(),
    };
  } catch {
    return null;
  }
}

export function getCurrentHistoryFiltersSnapshot() {
  return {
    selectedType: getSelectedHistoryType(),
    selectedAccountId: $('historyAccountFilter')?.value || 'all',
    selectedCategoryId: $('historyCategoryFilter')?.value || 'all',
    minAmount: String($('historyMinAmount')?.value || '').trim(),
    maxAmount: String($('historyMaxAmount')?.value || '').trim(),
    searchTerm: String($('historySearchInput')?.value || ''),
    rangeStart: state.historyRangeStart || '',
    rangeEnd: state.historyRangeEnd || '',
  };
}

export function buildHistoryLastState() {
  const snapshot = getCurrentHistoryFiltersSnapshot();
  let rangeSource = '';
  if (snapshot.rangeStart && snapshot.rangeEnd) {
    rangeSource = state.historyRangeSource || 'range';
    if (state.historyRangeSource === 'dashboard') rangeSource = 'range';
  }

  return {
    ...snapshot,
    selectedMonth: $('historyMonth')?.value || getCurrentMonthValue(),
    rangeSource,
    selectedPresetName: String($('historyPresetSelect')?.value || '').trim(),
  };
}

export function persistCurrentHistoryState() {
  localStorage.setItem(
    HISTORY_LAST_STATE_STORAGE_KEY,
    JSON.stringify(buildHistoryLastState())
  );
}

export function countActiveHistoryFilters(
  snapshot = getCurrentHistoryFiltersSnapshot()
) {
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

export function syncHistoryFilterActivityUi(
  snapshot = getCurrentHistoryFiltersSnapshot()
) {
  const activeMeta = $('historyActiveFiltersMeta');
  const clearBtn = $('historyClearFiltersBtn');
  const activeCount = countActiveHistoryFilters(snapshot);

  if (activeMeta) {
    const pluralSuffix = activeCount === 1 ? '' : 's';
    activeMeta.style.display = activeCount > 0 ? '' : 'none';
    activeMeta.textContent =
      activeCount > 0
        ? `${activeCount} filtro${pluralSuffix} activo${pluralSuffix}`
        : '';
  }

  if (clearBtn) {
    clearBtn.classList.toggle(
      'history-results-btn--attention',
      activeCount > 0
    );
    clearBtn.textContent =
      activeCount > 0 ? `Limpiar filtros (${activeCount})` : 'Limpiar filtros';
  }
}

export function syncHistoryFavoritePresetButton() {
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

export function renderHistoryPresetChips() {
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
    .map((name) => {
      const label =
        name === historyFavoritePresetName
          ? `★ ${escapeHtml(name)}`
          : escapeHtml(name);
      return `<button type="button" class="history-preset-chip" data-history-preset-chip="${escapeHtml(name)}">${label}</button>`;
    })
    .join('');

  container.innerHTML = chipsHtml;
  container.style.display = '';
}

export function renderHistoryPresetSelect(selectedName = '') {
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
      preset.name === historyFavoritePresetName ? `★ ${safeName}` : safeName;
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

export function restoreSavedHistoryState() {
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

export function applyHistorySelectValue(
  select,
  candidateValue,
  pendingStateKey
) {
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

export function applyHistoryFiltersSnapshot(snapshot = {}) {
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

export async function populateHistoryAccountFilter() {
  const select = $('historyAccountFilter');
  if (!select) return;

  const currentValue = state.historyPendingAccountId || select.value || 'all';
  const accounts = await ensureAccountsLoaded();
  select.innerHTML = '<option value="all">Todas las cuentas</option>';
  accounts.forEach((account) => {
    const accId = String(account.id || account._id || '');
    const option = document.createElement('option');
    option.value = accId;
    option.textContent = account.name;
    select.appendChild(option);
  });
  select.value = accounts.some(
    (account) => String(account.id || account._id) === currentValue
  )
    ? currentValue
    : 'all';
  state.historyPendingAccountId = '';
}

export async function populateHistoryCategoryFilter() {
  const select = $('historyCategoryFilter');
  if (!select) return;

  const currentValue = state.historyPendingCategoryId || select.value || 'all';
  await ensureCategoriesLoaded();

  const options = ['<option value="all">Todas las categorías</option>'];
  for (const section of state.tree || []) {
    for (const category of section.categories || []) {
      const catId = String(category._id || category.id || '');
      const visual = getCategoryVisual(category);
      const categoryLabel = `${visual.icon} ${visual.name}`;
      options.push(
        `<option value="${escapeHtml(catId)}">${escapeHtml(categoryLabel)}</option>`
      );
      for (const subcategory of category.subcategories || []) {
        const subId = String(subcategory._id || subcategory.id || '');
        const subVisual = hasCustomCategoryVisual(subcategory)
          ? getCategoryVisual(subcategory, visual.icon, visual.color)
          : {
              ...getCategoryVisual(subcategory, visual.icon, visual.color),
              icon: visual.icon,
            };
        const subcategoryLabel = `↳ ${subVisual.icon} ${subcategory.name}`;
        options.push(
          `<option value="${escapeHtml(subId)}">${escapeHtml(subcategoryLabel)}</option>`
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

export function matchesHistoryCategory(tx, selectedCategoryId) {
  if (selectedCategoryId === 'all') return true;
  if (String(tx.category_id || '') === selectedCategoryId) return true;
  if (String(tx.subcategory_id || '') === selectedCategoryId) return true;

  const subcategory = tx.subcategory_id
    ? state.catsById.get(tx.subcategory_id)
    : null;
  return String(subcategory?.parent_id || '') === String(selectedCategoryId);
}

export function matchesHistoryAccount(
  tx,
  selectedAccountId,
  selectedAccountName = ''
) {
  if (selectedAccountId === 'all') return true;
  const accountRef = String(tx.account_id || '').trim();
  return (
    accountRef === selectedAccountId ||
    (selectedAccountName && accountRef === selectedAccountName)
  );
}

export function matchesHistorySearch(tx, searchTerm, accountLookup) {
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
    Number(tx.amount || 0).toFixed(2),
  ]
    .join(' ')
    .toLocaleLowerCase('es-ES');

  return haystack.includes(searchTerm);
}

export function matchesHistoryAmount(tx, minAmount, maxAmount) {
  const amount = Number(tx.amount || 0);
  if (minAmount !== null && amount < minAmount) return false;
  if (maxAmount !== null && amount > maxAmount) return false;
  return true;
}

export function matchesHistoryFilters(tx, filters) {
  const date = new Date(tx.date);
  if (Number.isNaN(date.getTime())) return false;

  if (filters.rangeStart && filters.rangeEndExclusive) {
    if (date < filters.rangeStart || date >= filters.rangeEndExclusive)
      return false;
  } else if (filters.selectedMonth) {
    const yearMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (yearMonth !== filters.selectedMonth) return false;
  }

  if (filters.selectedType !== 'all' && tx.type !== filters.selectedType)
    return false;
  if (
    !matchesHistoryAccount(
      tx,
      filters.selectedAccountId,
      filters.selectedAccountName
    )
  )
    return false;
  if (!matchesHistoryCategory(tx, filters.selectedCategoryId)) return false;
  if (!matchesHistoryAmount(tx, filters.minAmount, filters.maxAmount))
    return false;
  return matchesHistorySearch(tx, filters.searchTerm, filters.accountLookup);
}

export function updateHistorySummary(transactions = []) {
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
  if (elFilteredTotal)
    elFilteredTotal.textContent = `${totalAmount.toFixed(2)}€`;
}

export function updateHistoryResultsMeta(
  transactions = [],
  selectedMonth = ''
) {
  const meta = $('historyResultsMeta');
  const selectionMeta = $('historySelectionMeta');
  if (!meta) return;

  const categoryCount = new Set(
    transactions.map((tx) => String(tx.subcategory_id || tx.category_id || ''))
  ).size;
  const monthDate = selectedMonth
    ? new Date(`${selectedMonth}-01T00:00:00Z`)
    : null;
  let monthLabel =
    monthDate && !Number.isNaN(monthDate.getTime())
      ? monthDate.toLocaleDateString('es-ES', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
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
    selectionMeta.textContent =
      selectedCount > 0 ? `${selectedCount} seleccionados` : '';
  }
  syncHistoryFilterActivityUi();
}

export function pruneHistorySelection(transactions = []) {
  const availableIds = new Set(
    transactions.map((tx) => String(tx._id || tx.id || ''))
  );
  Array.from(historySelectedTxIds).forEach((id) => {
    if (!availableIds.has(id)) historySelectedTxIds.delete(id);
  });
}

export function getSelectedHistoryTransactions() {
  return historyFilteredTxns.filter((tx) =>
    historySelectedTxIds.has(String(tx._id || tx.id))
  );
}

export function renderHistoryPage() {
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

  const loadMoreDataHtml =
    remaining <= 0 && historyCanLoadMoreData
      ? `<button type="button" id="historyLoadMoreDataBtn" class="history-load-more-btn">Cargar más datos del historial</button>`
      : '';

  txListFull.innerHTML = groupsHtml + loadMoreHtml + loadMoreDataHtml;
}

export async function loadHistoryView(options = {}) {
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
    populateHistoryCategoryFilter(),
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
    ? new Date(`${state.historyRangeStart}T00:00:00Z`)
    : null;
  const rangeEndExclusive = rangeActive
    ? new Date(`${state.historyRangeEnd}T00:00:00Z`)
    : null;
  if (rangeEndExclusive && !Number.isNaN(rangeEndExclusive.getTime())) {
    rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);
  }

  const selectedType = getSelectedHistoryType();
  const selectedAccountId = accountFilter?.value || 'all';
  const selectedCategoryId = categoryFilter?.value || 'all';
  const minAmount = $('historyMinAmount')?.value
    ? Number.parseFloat($('historyMinAmount').value)
    : null;
  const maxAmount = $('historyMaxAmount')?.value
    ? Number.parseFloat($('historyMaxAmount').value)
    : null;
  const searchTerm = String($('historySearchInput')?.value || '')
    .trim()
    .toLocaleLowerCase('es-ES');

  if (
    minAmountInput &&
    maxAmountInput &&
    minAmount !== null &&
    maxAmount !== null &&
    minAmount > maxAmount
  ) {
    maxAmountInput.value = minAmount.toFixed(2);
  }
  persistCurrentHistoryState();

  if (!options.preserveFetchWindow) {
    historyFetchPages = HISTORY_FETCH_PAGE_BLOCK;
  }

  const accounts = await ensureAccountsLoaded();
  const accountLookup = new Map();
  accounts.forEach((account) => {
    const accId = String(account.id || account._id || '');
    accountLookup.set(accId, account.name);
    accountLookup.set(String(account.name), account.name);
  });
  const selectedAccount = accounts.find(
    (account) => String(account.id || account._id) === selectedAccountId
  );

  const queryParams = rangeActive
    ? { start_date: state.historyRangeStart, end_date: state.historyRangeEnd }
    : { month: selectedMonth };

  if (selectedAccountId !== 'all') {
    queryParams.account_id = selectedAccountId;
  }

  const historyData = await fetchAllTransactions(queryParams, {
    maxPages: historyFetchPages,
    returnMeta: true,
  });
  const allTransactions = historyData?.items || [];
  historyCanLoadMoreData = Boolean(historyData?.hasMore);

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
    accountLookup,
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
    if (hasExtraFilters) emptyMessage = 'No hay movimientos con esos filtros.';
    else if (rangeActive) emptyMessage = 'No hay movimientos en este rango.';

    let emptyActions = '';
    if (hasExtraFilters)
      emptyActions =
        '<button type="button" class="history-empty-action" data-history-empty-clear="1">Quitar filtros</button>';
    else if (rangeActive)
      emptyActions =
        '<button type="button" class="history-empty-action" data-history-reset-range="1">Ver por mes</button>';

    let emptyIcon = 'ph-receipt';
    let emptyHint =
      'Añade tu primer movimiento para empezar a construir historial.';
    if (hasExtraFilters) {
      emptyIcon = 'ph-funnel';
      emptyHint = 'Ajusta o limpia filtros para volver a ver resultados.';
    } else if (rangeActive) {
      emptyIcon = 'ph-calendar-blank';
      emptyHint = 'Cambia al modo mensual si prefieres una vista más amplia.';
    }

    txListFull.innerHTML = `
      <div class="history-empty-state">
        ${renderListEmptyState(emptyIcon, emptyMessage, emptyHint)}
        ${emptyActions}
      </div>
    `;
    historyFilteredTxns = [];
    historyCanLoadMoreData = false;
    return;
  }

  historyFilteredTxns = filtered;
  historyVisibleCount = HISTORY_PAGE_SIZE;
  renderHistoryPage();
}

export function resetHistoryFilters() {
  setSelectedHistoryType('all');
  if ($('historyAccountFilter')) $('historyAccountFilter').value = 'all';
  if ($('historyCategoryFilter')) $('historyCategoryFilter').value = 'all';
  if ($('historyMinAmount')) $('historyMinAmount').value = '';
  if ($('historyMaxAmount')) $('historyMaxAmount').value = '';
  if ($('historySearchInput')) $('historySearchInput').value = '';
  collapsedHistoryGroups.clear();
  loadHistoryView();
}

export function selectVisibleHistoryTransactions() {
  const visibleIds = Array.from(
    document.querySelectorAll('#txListFull .tx-item[data-id]')
  )
    .map((item) => String(item.dataset.id || '').trim())
    .filter(Boolean);

  visibleIds.forEach((id) => historySelectedTxIds.add(id));
  updateHistoryResultsMeta(
    historyFilteredTxns,
    $('historyMonth')?.value || getCurrentMonthValue()
  );
  renderHistoryPage();
}

export function clearHistorySelection() {
  historySelectedTxIds.clear();
  updateHistoryResultsMeta(
    historyFilteredTxns,
    $('historyMonth')?.value || getCurrentMonthValue()
  );
  renderHistoryPage();
}

export function toggleHistorySelection(txId, isSelected) {
  const normalizedId = String(txId || '').trim();
  if (!normalizedId) return;
  if (isSelected) historySelectedTxIds.add(normalizedId);
  else historySelectedTxIds.delete(normalizedId);
  updateHistoryResultsMeta(
    historyFilteredTxns,
    $('historyMonth')?.value || getCurrentMonthValue()
  );
}

export function initHistoryListeners() {
  const txListFull = $('txListFull');
  const historyMonth = $('historyMonth');
  const historyAccountFilter = $('historyAccountFilter');
  const historyCategoryFilter = $('historyCategoryFilter');
  const historyMinAmount = $('historyMinAmount');
  const historyMaxAmount = $('historyMaxAmount');
  const historySearchInput = $('historySearchInput');
  const historyTypeFilters = $('historyTypeFilters');
  const historyPresetSelect = $('historyPresetSelect');
  const historyPresetChips = $('historyPresetChips');
  const historySavePresetBtn = $('historySavePresetBtn');
  const historyToggleFavoritePresetBtn = $('historyToggleFavoritePresetBtn');
  const historyClearFiltersBtn = $('historyClearFiltersBtn');
  const historyResetRangeBtn = $('historyResetRangeBtn');
  const historyBackDashboardBtn = $('historyBackDashboardBtn');
  const historyExportCsvBtn = $('historyExportCsvBtn');
  const historySelectVisibleBtn = $('historySelectVisibleBtn');
  const historyClearSelectionBtn = $('historyClearSelectionBtn');
  const historyCollapseAllBtn = $('historyCollapseAllBtn');
  const historyExpandAllBtn = $('historyExpandAllBtn');

  syncHistoryRangeUi();
  historyFilterPresets = readHistoryFilterPresets();
  historyRecentPresetNames = readHistoryRecentPresetNames();
  historyFavoritePresetName = readHistoryFavoritePresetName();
  renderHistoryPresetSelect();
  renderHistoryPresetChips();
  restoreSavedHistoryState();
  syncHistoryFilterActivityUi();

  if (historyMonth) {
    historyMonth.addEventListener('change', () => {
      if (isHistoryRangeActive()) return;
      loadHistoryView();
    });
  }
  if (historyAccountFilter)
    historyAccountFilter.addEventListener('change', () => loadHistoryView());
  if (historyCategoryFilter)
    historyCategoryFilter.addEventListener('change', () => loadHistoryView());

  const scheduleReload = () => {
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(() => loadHistoryView(), 140);
  };
  if (historyMinAmount)
    historyMinAmount.addEventListener('input', scheduleReload);
  if (historyMaxAmount)
    historyMaxAmount.addEventListener('input', scheduleReload);
  if (historySearchInput)
    historySearchInput.addEventListener('input', scheduleReload);

  if (historyClearFiltersBtn)
    historyClearFiltersBtn.addEventListener('click', resetHistoryFilters);
  if (historyCollapseAllBtn)
    historyCollapseAllBtn.addEventListener('click', () =>
      setAllHistoryGroupsCollapsed(true)
    );
  if (historyExpandAllBtn)
    historyExpandAllBtn.addEventListener('click', () =>
      setAllHistoryGroupsCollapsed(false)
    );

  if (historySelectVisibleBtn)
    historySelectVisibleBtn.addEventListener(
      'click',
      selectVisibleHistoryTransactions
    );
  if (historyClearSelectionBtn)
    historyClearSelectionBtn.addEventListener('click', clearHistorySelection);

  if (historyResetRangeBtn) {
    historyResetRangeBtn.addEventListener('click', () => {
      state.historyRangeStart = '';
      state.historyRangeEnd = '';
      state.historyRangeSource = '';
      syncHistoryRangeUi();
      loadHistoryView();
    });
  }
  if (historyBackDashboardBtn) {
    historyBackDashboardBtn.addEventListener('click', () =>
      globalThis.switchView?.('dashboard', 'Resumen')
    );
  }

  if (historyExportCsvBtn) {
    historyExportCsvBtn.addEventListener('click', () => {
      const monthInput = $('historyMonth');
      const monthLabel = monthInput?.value || getCurrentMonthValue();
      exportHistoryToCSV(historyFilteredTxns, monthLabel);
    });
  }

  if (historyTypeFilters) {
    historyTypeFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-history-type]');
      if (!button) return;
      setSelectedHistoryType(button.dataset.historyType || 'all');
      loadHistoryView();
    });
  }

  if (historySavePresetBtn) {
    historySavePresetBtn.addEventListener('click', () => {
      const name = prompt('Nombre para guardar este filtro:');
      if (!name || !name.trim()) return;
      const cleanName = name.trim();
      const current = getCurrentHistoryFiltersSnapshot();
      const existingIdx = historyFilterPresets.findIndex(
        (p) => p.name === cleanName
      );
      if (existingIdx >= 0) {
        historyFilterPresets[existingIdx].filters = current;
      } else {
        historyFilterPresets.push({ name: cleanName, filters: current });
      }
      persistHistoryFilterPresets();
      if (!historyRecentPresetNames.includes(cleanName)) {
        historyRecentPresetNames.unshift(cleanName);
        historyRecentPresetNames = historyRecentPresetNames.slice(0, 8);
        persistHistoryRecentPresetNames();
      }
      renderHistoryPresetSelect(cleanName);
      renderHistoryPresetChips();
      showAlert('Filtro guardado', 'success');
    });
  }

  if (historyPresetSelect) {
    historyPresetSelect.addEventListener('change', () => {
      const val = historyPresetSelect.value;
      if (!val) return;
      const preset = historyFilterPresets.find((p) => p.name === val);
      if (preset?.filters) {
        applyHistoryFiltersSnapshot(preset.filters);
        if (!historyRecentPresetNames.includes(val)) {
          historyRecentPresetNames.unshift(val);
          historyRecentPresetNames = historyRecentPresetNames.slice(0, 8);
          persistHistoryRecentPresetNames();
        }
        renderHistoryPresetChips();
        syncHistoryFavoritePresetButton();
        loadHistoryView();
      }
    });
  }

  if (historyPresetChips) {
    historyPresetChips.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-history-preset-chip]');
      if (!chip) return;
      const val = chip.dataset.historyPresetChip;
      const preset = historyFilterPresets.find((p) => p.name === val);
      if (preset?.filters) {
        applyHistoryFiltersSnapshot(preset.filters);
        renderHistoryPresetSelect(val);
        loadHistoryView();
      }
    });
  }

  if (historyToggleFavoritePresetBtn) {
    historyToggleFavoritePresetBtn.addEventListener('click', () => {
      const selectedName = String(historyPresetSelect?.value || '').trim();
      if (!selectedName) return;
      if (historyFavoritePresetName === selectedName) {
        historyFavoritePresetName = '';
      } else {
        historyFavoritePresetName = selectedName;
      }
      persistHistoryFavoritePresetName();
      renderHistoryPresetSelect(selectedName);
      renderHistoryPresetChips();
      syncHistoryFavoritePresetButton();
    });
  }

  if (txListFull) {
    txListFull.addEventListener('click', (event) => {
      const clearBtn = event.target.closest('[data-history-empty-clear]');
      if (clearBtn) {
        resetHistoryFilters();
        return;
      }

      const resetRangeEmptyBtn = event.target.closest(
        '[data-history-reset-range]'
      );
      if (resetRangeEmptyBtn) {
        state.historyRangeStart = '';
        state.historyRangeEnd = '';
        state.historyRangeSource = '';
        syncHistoryRangeUi();
        loadHistoryView();
        return;
      }

      const selector = event.target.closest('.tx-select, .tx-select-input');
      if (selector) return;

      const quickEditBtn = event.target.closest('[data-history-edit-id]');
      if (quickEditBtn) {
        const txId = quickEditBtn.dataset.historyEditId || '';
        if (txId) {
          openViewTx(txId).then(() => {
            const btnEdit = $('btnEditTx');
            if (btnEdit && btnEdit.style.display !== 'none') btnEdit.click();
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

      const loadMoreDataBtn = event.target.closest('#historyLoadMoreDataBtn');
      if (loadMoreDataBtn) {
        historyFetchPages += HISTORY_FETCH_PAGE_BLOCK;
        loadHistoryView({ preserveFetchWindow: true });
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
    });

    txListFull.addEventListener('change', (event) => {
      const input = event.target.closest('[data-history-select]');
      if (!input) return;
      toggleHistorySelection(input.dataset.historySelect || '', input.checked);
      const txItem = input.closest('.tx-item');
      if (txItem) txItem.classList.toggle('is-selected', input.checked);
    });
  }
}