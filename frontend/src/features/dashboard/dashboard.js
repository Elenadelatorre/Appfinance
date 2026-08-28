// src/features/dashboard/dashboard.js
import { state } from '../../state/state.js';
import { api } from '../../services/api.js';
import { $, escapeHtml, renderListEmptyState } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import {
  getAccountsFast,
  applyAccountTheme,
  getAccountBadgeMarkup,
  openTransferModal,
  confirmAndResetAccount,
  openViewAccount
} from '../accounts/accounts.js';
import { ensureCategoriesLoaded } from '../categories/categories.js';
import {
  fetchAllTransactions,
  sortTransactionsByMostRecent,
  annotateTransactionsWithRunningBalances,
  renderTxItem,
  renderBreakdownItem,
  buildAccountSpendDistributionCard,
  openViewTx
} from '../transactions/transactions.js';
import { openHistoryFromDashboardCategory } from '../history/history.js';

let dashboardLoadNonce = 0;
let homeLoadNonce = 0;

export function formatDashboardCycle(summary = {}) {
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

export function getDashboardDateInputValue(isoValue = '') {
  return String(isoValue || '').slice(0, 10);
}

export function buildDashboardSummaryPath() {
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

export function getDashboardTransactionFilters() {
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

export function syncDashboardRangeInputs(summary = {}) {
  const startValue = getDashboardDateInputValue(summary.period_start);
  const endValue = getDashboardDateInputValue(summary.period_end);
  const startInput = $('dashboardDateStart');
  const endInput = $('dashboardDateEnd');

  state.dashboardDateStart = startValue;
  state.dashboardDateEnd = endValue;

  if (startInput) startInput.value = startValue;
  if (endInput) endInput.value = endValue;
}

export function filterTransactionsByDashboardCycle(
  transactions = [],
  summary = {}
) {
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

export function buildDashboardAccountSpendCard(
  accounts = [],
  transactions = []
) {
  const selectableAccounts = (accounts || []).filter(
    (acc) => acc?.id || acc?._id
  );

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
    (acc) =>
      String(acc.id || acc._id) ===
      String(state.dashboardSelectedAccountId || '')
  );
  const isAllAccounts = !selectedAccount;

  const accountButtonsHtml = `
    <div class="account-spend-account-pills" aria-label="Seleccionar cuenta">
      <button type="button" class="account-spend-account-pill${
        isAllAccounts ? ' is-active' : ''
      }" data-dashboard-account-id="__all__">Todas</button>
      ${selectableAccounts
        .map((acc) => {
          const accId = String(acc.id || acc._id);
          return `<button type="button" class="account-spend-account-pill${
            accId === String(selectedAccount?.id || selectedAccount?._id || '')
              ? ' is-active'
              : ''
          }" data-dashboard-account-id="${escapeHtml(accId)}">${escapeHtml(acc.name || 'Cuenta')}</button>`;
        })
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

  const targetAccId = String(selectedAccount.id || selectedAccount._id);
  const filteredTransactions = (transactions || []).filter((tx) => {
    const accountRef = String(tx?.account_id || '').trim();
    return (
      accountRef === targetAccId ||
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

function syncHomeTransferButton(button, account) {
  if (!button) return;
  const accId = account?.id || account?._id;
  const canTransfer = Boolean(accId);
  button.disabled = !canTransfer;
  button.onclick = canTransfer
    ? async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await openTransferModal(accId);
      }
    : null;
}

function syncHomeResetButton(button, account) {
  if (!button) return;
  const accId = account?.id || account?._id;
  const canReset = Boolean(accId);
  button.disabled = !canReset;
  button.onclick = canReset
    ? async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await confirmAndResetAccount(accId, account.name, false);
      }
    : null;
}

function applyEmptyHomeAccountState(
  homeCard,
  homeTransferBtn,
  homeResetBtn,
  homeSpendDistribution
) {
  applyAccountTheme(homeCard, { name: 'Cuenta', type: 'bank' });
  if ($('homeAccountName')) $('homeAccountName').textContent = 'Sin cuenta';
  if ($('homeAccountSubtitle'))
    $('homeAccountSubtitle').textContent = 'Cuenta principal';
  if ($('homeAccountBalance')) $('homeAccountBalance').textContent = '0.00€';
  if ($('homeAccountType')) $('homeAccountType').textContent = 'Cuenta';

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
    txList.innerHTML = renderListEmptyState(
      'ph-receipt',
      'No hay movimientos aún.',
      'Cuando registres movimientos, aparecerán aquí.'
    );
  }
  if (homeSpendDistribution) {
    homeSpendDistribution.innerHTML = buildAccountSpendDistributionCard([]);
  }
}

export async function loadHomeAccount(options = {}) {
  const currentLoadNonce = ++homeLoadNonce;
  const forceAccountsReload = Boolean(options.forceAccountsReload);

  try {
    const homeCard = document.querySelector('.home-account-card');
    const homeTransferBtn = $('btnHomeTransfer');
    const homeResetBtn = $('btnHomeResetAccount');
    const homeSpendDistribution = $('homeSpendDistribution');
    const txList = $('homeAccountTxList');

    if (txList) {
      txList.innerHTML =
        '<div class="muted" style="text-align:center; margin: 12px 0;">Cargando movimientos...</div>';
    }
    if (homeSpendDistribution) {
      homeSpendDistribution.innerHTML =
        '<div class="muted" style="text-align:center; margin: 10px 0;">Cargando gasto por categoría...</div>';
    }

    const accounts = await getAccountsFast(forceAccountsReload);
    if (currentLoadNonce !== homeLoadNonce) return;
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

    const principalAccId = String(principalAccount.id || principalAccount._id);
    const typeLabel =
      {
        bank: '🏦 Banco',
        cash: '💵 Efectivo',
        credit: '💳 Tarjeta crédito'
      }[principalAccount.type] || principalAccount.type;

    if ($('homeAccountType')) $('homeAccountType').textContent = typeLabel;
    const [mainName, subtitle = 'Principal'] = String(
      principalAccount.name || ''
    )
      .split('·')
      .map((part) => part.trim())
      .filter(Boolean);

    applyAccountTheme(homeCard, principalAccount);
    const welcomeChip = $('homeWelcomeDate');
    if (welcomeChip) {
      const now = new Date();
      welcomeChip.textContent = now.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    }

    const homeBadge = $('homeAccountBadge');
    if (homeBadge) {
      homeBadge.innerHTML = getAccountBadgeMarkup(
        principalAccount,
        'account-brand-badge--hero'
      );
    }
    if ($('homeAccountName'))
      $('homeAccountName').textContent = mainName || principalAccount.name;
    if ($('homeAccountSubtitle')) {
      $('homeAccountSubtitle').textContent = subtitle;
      $('homeAccountSubtitle').classList.toggle(
        'account-subtitle-muted',
        /ahorro|hucha/i.test(subtitle)
      );
    }
    const balance = Number(principalAccount.current_balance || 0).toFixed(2);
    if ($('homeAccountBalance'))
      $('homeAccountBalance').textContent = `${balance}€`;

    enableHomeCardNavigation(homeCard, principalAccId);
    syncHomeTransferButton(homeTransferBtn, principalAccount);
    syncHomeResetButton(homeResetBtn, principalAccount);

    await ensureCategoriesLoaded();
    if (currentLoadNonce !== homeLoadNonce) return;

    const filtered = await fetchAllTransactions(
      { account_id: principalAccId },
      { maxPages: 2, maxRecords: 300 }
    );
    if (currentLoadNonce !== homeLoadNonce) return;

    function renderHomeSpendCard() {
      if (!homeSpendDistribution) return;
      let txsForSpend = filtered || [];
      if (state.homeSpendSinceDate) {
        const sinceTime = new Date(
          `${state.homeSpendSinceDate}T00:00:00`
        ).getTime();
        txsForSpend = (filtered || []).filter((tx) => {
          const txTime = new Date(tx.date).getTime();
          return !Number.isNaN(txTime) && txTime >= sinceTime;
        });
      }
      const controlsHtml = `
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; opacity:0.85;">
          Desde
          <input
            type="date"
            id="homeSpendSinceInput"
            value="${state.homeSpendSinceDate || ''}"
            style="font-size:12px; padding:2px 4px;"
          />
        </label>
      `;
      homeSpendDistribution.innerHTML = buildAccountSpendDistributionCard(
        txsForSpend,
        { controlsHtml }
      );
      $('homeSpendSinceInput')?.addEventListener('change', (ev) => {
        state.homeSpendSinceDate = ev.target.value || null;
        renderHomeSpendCard();
      });
    }
    renderHomeSpendCard();

    let sortedTransactions = sortTransactionsByMostRecent(filtered || []);
    if (sortedTransactions.length === 0) {
      const globalRecent = await fetchAllTransactions(
        {},
        { maxPages: 1, maxRecords: 120 }
      );
      if (currentLoadNonce !== homeLoadNonce) return;
      sortedTransactions = sortTransactionsByMostRecent(globalRecent || []);
    }

    const transactionsWithRunningBalance =
      annotateTransactionsWithRunningBalances(sortedTransactions);
    const HOME_TX_PAGE_SIZE = 10;
    let homeTxVisibleCount = HOME_TX_PAGE_SIZE;

    function renderHomeTxList() {
      if (!txList) return;
      const recentTransactions = transactionsWithRunningBalance.slice(
        0,
        homeTxVisibleCount
      );
      const html = recentTransactions
        .map((t) => renderTxItem(t, true))
        .join('');

      txList.innerHTML =
        html ||
        renderListEmptyState(
          'ph-receipt',
          'No hay movimientos aún.',
          'Usa el botón + para registrar el primero.'
        );

      if (transactionsWithRunningBalance.length > homeTxVisibleCount) {
        const moreWrap = document.createElement('div');
        moreWrap.style.display = 'flex';
        moreWrap.style.justifyContent = 'center';
        moreWrap.style.marginTop = '10px';
        moreWrap.innerHTML =
          '<button type="button" class="btn" id="btnHomeSeeMoreTx">Ver más movimientos</button>';
        txList.appendChild(moreWrap);
        $('btnHomeSeeMoreTx')?.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          homeTxVisibleCount += HOME_TX_PAGE_SIZE;
          renderHomeTxList();
        });
      }

      txList.querySelectorAll('.tx-item').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.id;
          if (id) openViewTx(id);
        });
      });
    }

    if (txList) renderHomeTxList();
  } catch (err) {
    if (
      err?.code === 'STALE_AUTH_REQUEST' ||
      err?.message === 'Sesión caducada. Vuelve a iniciar sesión.'
    )
      return;
    console.error('Error cargando cuenta principal:', err);
  }
}

export async function loadDashboardView() {
  const currentLoadNonce = ++dashboardLoadNonce;

  try {
    const [ms, accounts] = await Promise.all([
      api(buildDashboardSummaryPath()),
      getAccountsFast()
    ]);

    if (currentLoadNonce !== dashboardLoadNonce) return;

    syncDashboardRangeInputs(ms || {});
    const cycleLabel = formatDashboardCycle(ms || {});
    const summaryMode =
      state.dashboardSummaryMode === 'compact' ? 'compact' : 'full';
    const periodLabel = state.dashboardUseCustomRange ? 'rango' : 'ciclo';

    const dashEl = $('dashboardBalance');
    if (dashEl) dashEl.textContent = Number(ms?.balance || 0).toFixed(2) + '€';

    const adviceEl = $('dashboardAdvice');
    if (adviceEl) {
      adviceEl.textContent = `${cycleLabel} · Ingresos: ${Number(ms?.total_income || 0).toFixed(2)}€ · Gastos: ${Number(ms?.total_expense || 0).toFixed(2)}€`;
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

    const details = $('dashboardDetails');
    const breakdownCard = document.querySelector(
      '#view-dashboard .dashboard-breakdown-card'
    );
    if (breakdownCard) {
      breakdownCard.style.display = summaryMode === 'compact' ? 'none' : '';
    }

    if (details && Object.keys(ms?.category_breakdown || {}).length > 0) {
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
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handler();
          }
        });
      });
    } else if (details) {
      details.innerHTML = `<div class="muted" style="text-align:center; margin: 16px 0;">Aún no hay gastos en este ${periodLabel}.</div>`;
    }

    const accountsDistribution = $('dashboardAccountsDistribution');
    if (accountsDistribution) {
      accountsDistribution.style.display =
        summaryMode === 'compact' ? 'none' : '';
      if (summaryMode === 'compact') {
        accountsDistribution.innerHTML = '';
      } else {
        accountsDistribution.innerHTML =
          '<div class="muted" style="text-align:center; margin: 12px 0;">Cargando distribución por cuentas...</div>';
      }

      fetchAllTransactions(getDashboardTransactionFilters(), {
        maxPages: 8,
        maxRecords: 2500
      })
        .then((transactions) => {
          if (currentLoadNonce !== dashboardLoadNonce) return;
          if (state.currentViewId !== 'dashboard') return;
          if (!accountsDistribution) return;

          const rangeTransactions = filterTransactionsByDashboardCycle(
            transactions || [],
            ms || {}
          );
          accountsDistribution.innerHTML = buildDashboardAccountSpendCard(
            accounts || [],
            rangeTransactions
          );

          accountsDistribution
            .querySelectorAll('[data-dashboard-account-id]')
            .forEach((button) => {
              button.addEventListener('click', () => {
                const selectedAccountId =
                  button.dataset.dashboardAccountId || '';
                state.dashboardSelectedAccountId =
                  selectedAccountId === '__all__' ? null : selectedAccountId;
                state.dashboardAccountSpendMode = 'all';
                loadDashboardView();
              });
            });
        })
        .catch(() => {
          if (currentLoadNonce !== dashboardLoadNonce) return;
          if (!accountsDistribution) return;
          accountsDistribution.innerHTML =
            '<div class="muted" style="text-align:center; margin: 12px 0;">No se pudo cargar la distribución por cuentas.</div>';
        });
    }
  } catch (err) {
    console.error('Error cargando dashboard:', err);
  }
}

export function initDashboardListeners() {
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

  if (applyBtn) applyBtn.addEventListener('click', submitRange);
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
