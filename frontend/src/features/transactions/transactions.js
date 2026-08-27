// js/features/transactions/transactions.js
import { state } from '../../state/state.js';
import { api } from '../../services/api.js';
import { $, escapeHtml } from '../../utils/dom.js';
import { showAlert } from '../../utils/toast.js';
import { openModal, closeModal } from '../ui/modals.js';
import {
  getCategoryVisual,
  getTransferVisual,
  hasCustomCategoryVisual,
  buildCategoryVisualStyle,
  renderCategoryVisualContent
} from '../../utils/visuals.js';
import {
  updateCategoriesForType,
  onCategoryChange
} from '../categories/categories.js';
import { TRANSACTIONS_PAGE_SIZE } from '../../config/constants.js';

let editingTxId = null;
let refreshAppCallback = null;
let openViewAccountCallback = null;

export function setTransactionRefreshCallbacks({
  onRefresh,
  onOpenViewAccount
}) {
  refreshAppCallback = onRefresh;
  openViewAccountCallback = onOpenViewAccount;
}

export function findAccountForTransaction(tx) {
  const accountRef = String(tx?.account_id || '').trim();
  if (!accountRef) return null;
  return (
    (state.accounts || []).find(
      (account) =>
        String(account?.id || '') === accountRef ||
        String(account?._id || '') === accountRef ||
        String(account?.name || '') === accountRef
    ) || null
  );
}

export function sortTransactionsByMostRecent(transactions = []) {
  return [...transactions].sort((left, right) => {
    const leftTime = new Date(left?.date || 0).getTime();
    const rightTime = new Date(right?.date || 0).getTime();
    if (rightTime !== leftTime) return rightTime - leftTime;
    const leftId = String(left?._id || '');
    const rightId = String(right?._id || '');
    if (rightId > leftId) return 1;
    if (rightId < leftId) return -1;
    return 0;
  });
}

export function getTransactionSignedAmount(tx) {
  const amount = Math.abs(Number(tx?.amount || 0));
  return tx?.type === 'income' ? amount : -amount;
}

export function annotateTransactionsWithRunningBalances(transactions = []) {
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

export function buildTransactionIsoDate(dateValue) {
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

export function resolveTransactionVisual(tx, category, subcategory) {
  const transferVisual = getTransferVisual(tx?.category_id);
  if (transferVisual) {
    return {
      visual: transferVisual,
      title: transferVisual.name,
      subtitle: ''
    };
  }

  const hasSubcategorySelection = Boolean(
    String(tx?.subcategory_id || '').trim()
  );

  let sourceForVisual = category || subcategory;
  if (hasSubcategorySelection && subcategory) {
    sourceForVisual = hasCustomCategoryVisual(subcategory)
      ? subcategory
      : category || subcategory;
  }

  const visual = getCategoryVisual(sourceForVisual);
  const title = category?.name || visual.name;
  const subtitle =
    hasSubcategorySelection && subcategory ? subcategory.name : '';

  return {
    visual,
    title,
    subtitle: subtitle && subtitle !== title ? subtitle : ''
  };
}

export function renderTxAccountMeta(tx, getAccountBadgeMarkup) {
  const account = findAccountForTransaction(tx);

  if (account) {
    if (typeof getAccountBadgeMarkup === 'function') {
      return `
        <span class="tx-account-chip" title="${escapeHtml(account.name || 'Cuenta')}">
          ${getAccountBadgeMarkup(account, 'account-brand-badge--tx')}
          <span class="tx-account-name">${escapeHtml(account.name || 'Cuenta')}</span>
        </span>
      `;
    }
    return `
      <span class="tx-account-chip">
        <span class="tx-account-name">${escapeHtml(account.name || 'Cuenta')}</span>
      </span>
    `;
  }

  // Si no se encuentra la cuenta, no mostrar el hash de MongoDB
  return '';
}

export function renderTxItem(
  tx,
  includeNote = true,
  options = {},
  getAccountBadgeMarkup = null
) {
  const cat = state.catsById.get(tx.category_id);
  const sub = tx.subcategory_id ? state.catsById.get(tx.subcategory_id) : null;
  const txVisual = resolveTransactionVisual(tx, cat, sub);
  const visual = txVisual.visual;
  const date = new Date(tx.date).toLocaleDateString();
  const accountMeta = renderTxAccountMeta(tx, getAccountBadgeMarkup);
  const note = (tx.note || '').trim();
  const sign = tx.type === 'expense' ? '-' : '+';
  const amount = Number(tx.amount || 0).toFixed(2);
  const title = txVisual.title;
  const subtitle = txVisual.subtitle;
  const runningBalanceAfter = Number(tx?.running_balance_after);
  const showRunningBalance =
    options.showRunningBalance !== false &&
    Number.isFinite(runningBalanceAfter);
  const isSelectable = Boolean(options.selectable);
  const isSelected =
    isSelectable &&
    (options.selectedIds?.has(String(tx._id)) ||
      globalThis.historySelectedTxIds?.has(String(tx._id)));
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
          ${subtitle ? `<div class="tx-sub">${escapeHtml(subtitle)}</div>` : ''}
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

export function renderBreakdownItem(categoryId, amount, totalExpense = 0) {
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

export function buildAccountSpendDistributionCard(
  transactions = [],
  options = {}
) {
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

export async function fetchAllTransactions(filters = {}, options = {}) {
  const allTransactions = [];
  const maxPages = Math.max(1, Number.parseInt(options.maxPages || '200', 10));
  const maxRecords = Math.max(
    TRANSACTIONS_PAGE_SIZE,
    Number.parseInt(options.maxRecords || '100000', 10)
  );
  const returnMeta = Boolean(options.returnMeta);
  let skip = 0;
  let hasMore = false;

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
    if (allTransactions.length >= maxRecords) {
      hasMore = true;
      const items = allTransactions.slice(0, maxRecords);
      return returnMeta ? { items, hasMore } : items;
    }
    if (chunk.length < TRANSACTIONS_PAGE_SIZE) {
      hasMore = false;
      break;
    }
    if (page === maxPages - 1) {
      hasMore = true;
      break;
    }

    skip += TRANSACTIONS_PAGE_SIZE;
  }

  return returnMeta ? { items: allTransactions, hasMore } : allTransactions;
}

function setFormControlsDisabled(form, disabled) {
  Array.from(form.querySelectorAll('input,select,textarea')).forEach(
    (i) => (i.disabled = disabled)
  );
}

export function applyCreateModalMode() {
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

export function applyViewModalMode(txId) {
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
      closeModal('modalAddTx');
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

export function setModalMode(mode, txId = null) {
  if (mode === 'create') {
    applyCreateModalMode();
  } else if (mode === 'view') {
    applyViewModalMode(txId);
  }
}

export async function populateTxAccountSelect(selectedAccountId = null) {
  const sel = $('txAccount');
  if (!sel) return;
  try {
    let accounts = state.accounts || [];
    if (!accounts.length) {
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
  } catch {
    sel.innerHTML = '<option value="">(Opcional) Cuenta</option>';
  }
}

export async function openCreateTxModal(preselectedAccountId = null) {
  setModalMode('create');
  let defaultAccountId = preselectedAccountId;
  if (!defaultAccountId) {
    if (state.currentViewId === 'account-detail' && state.currentAccountId) {
      defaultAccountId = state.currentAccountId;
    } else if (state.currentViewId === 'home') {
      defaultAccountId = state.accounts[0]?.id || null;
    }
  }
  await populateTxAccountSelect(defaultAccountId);
  openModal('modalAddTx');
}

export async function saveTx() {
  const amount = Number.parseFloat($('txAmount')?.value || '');
  const type = $('txType')?.value || 'expense';
  const category_id = $('txCategory')?.value || '';
  const subcategory_id = $('txSubcategory')?.value || null;
  const note = $('txDesc')?.value?.trim() || null;
  const account_id = ($('txAccount')?.value || '').trim() || null;
  const dateValue = ($('txDate')?.value || '').trim();

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

    // 1. Recargar cuentas para refrescar saldos en memoria
    state.accounts = await api('/accounts');

    const form = $('txForm');
    if (form) form.reset();
    editingTxId = null;
    closeModal('modalAddTx');

    // 2. Ejecutar callback si está registrado
    if (typeof refreshAppCallback === 'function') {
      await refreshAppCallback(account_id);
    }
  } catch (err) {
    showAlert('Error al guardar: ' + (err?.message || String(err)), 'error');
  }
}

export async function deleteTx(txId) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  try {
    const currentAccountId = ($('txAccount')?.value || '').trim() || null;
    await api(`/transactions/${txId}`, { method: 'DELETE' });

    // 1. Recargar cuentas tras borrar
    state.accounts = await api('/accounts');

    // 2. Ejecutar callback
    if (typeof refreshAppCallback === 'function') {
      await refreshAppCallback(currentAccountId);
    }

    // 3. Emitir evento global
    window.dispatchEvent(
      new CustomEvent('finance:transactions-changed', {
        detail: { accountId: currentAccountId }
      })
    );
  } catch (err) {
    showAlert('Error al eliminar: ' + (err?.message || String(err)), 'error');
  }
}

export async function openViewTx(txId) {
  try {
    const tx = await api(`/transactions/${txId}`);
    if (!tx) throw new Error('Transacción no encontrada');

    $('txAmount').value = tx.amount || '';
    $('txType').value = tx.type || 'expense';
    updateCategoriesForType();
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
    openModal('modalAddTx');
  } catch (err) {
    showAlert(
      'No se pudo cargar la transacción: ' + (err?.message || String(err)),
      'error'
    );
  }
}
