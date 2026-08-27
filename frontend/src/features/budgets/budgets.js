// js/features/budgets/budgets.js
import { state } from '../../state/state.js';
import { api } from '../../services/api.js';
import { BUDGET_FILTER_STORAGE_KEY } from '../../config/constants.js';
import { $, escapeHtml } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import { getCategoryVisual } from '../../utils/visuals.js';
import { ensureCategoriesLoaded } from '../categories/categories.js';
import { formatDashboardCycle } from '../dashboard/dashboard.js';

export function getBudgetParentCategories() {
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

export function renderBudgetStatusCard(item) {
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

export function getSelectedBudgetStatusFilter() {
  const active = document.querySelector(
    '#budgetStatusFilters [data-budget-filter].is-active'
  );
  if (!active) return state.budgetStatusFilter || 'all';

  const selected = active?.dataset.budgetFilter || 'all';
  state.budgetStatusFilter = selected;
  return selected;
}

export function setBudgetStatusFilter(filterValue = 'all') {
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
  if (target) target.classList.add('is-active');
}

export function getBudgetScopeLabel(selectedFilter = 'all') {
  if (selectedFilter === 'risk') return 'en riesgo';
  if (selectedFilter === 'exceeded') return 'excedidos';
  return 'totales';
}

export function applyBudgetStatusFilter(items = [], selectedFilter = 'all') {
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

export function resetBudgetForm() {
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

export function startEditBudget(item) {
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

export async function deleteBudgetFromView(budgetId) {
  if (!budgetId) return;
  if (!confirm('¿Eliminar este presupuesto del ciclo actual?')) return;

  try {
    await api(`/budgets/${budgetId}`, { method: 'DELETE' });
    showAlert('Presupuesto eliminado', 'info');
    if (state.editingBudgetId === budgetId) resetBudgetForm();
    await loadBudgetsView();
  } catch (err) {
    showAlert(
      'No se pudo eliminar el presupuesto: ' + (err?.message || String(err)),
      'error'
    );
  }
}

export function renderBudgetOverviewChart(items = []) {
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

export async function populateBudgetCategorySelect() {
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

export async function saveBudgetFromView() {
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

export async function loadBudgetsView() {
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
      if (currentEditing) startEditBudget(currentEditing);
      else resetBudgetForm();
    }

    renderBudgetOverviewChart(filteredItems);
  } catch (err) {
    statusList.innerHTML = `<div class="muted" style="text-align:center;">Error cargando presupuestos: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

export function initBudgetListeners() {
  const budgetSaveBtn = $('budgetSaveBtn');
  const budgetCancelEditBtn = $('budgetCancelEditBtn');
  const budgetStatusFilters = $('budgetStatusFilters');

  if (budgetSaveBtn)
    budgetSaveBtn.addEventListener('click', () => saveBudgetFromView());
  if (budgetCancelEditBtn)
    budgetCancelEditBtn.addEventListener('click', () => resetBudgetForm());
  if (budgetStatusFilters) {
    budgetStatusFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-budget-filter]');
      if (!button) return;
      setBudgetStatusFilter(button.dataset.budgetFilter || 'all');
      loadBudgetsView();
    });
  }
  setBudgetStatusFilter(state.budgetStatusFilter || 'all');
}
