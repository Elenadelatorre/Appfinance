// src/features/automations/automations.js
import { state } from '../../state/state.js';
import { api, API, getApiToken, fetchJsonSilent } from '../../services/api.js';
import { $, escapeHtml } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import {
  buildCategoryOption,
  buildSubcategoryOption
} from '../categories/categories.js';

let editingRecurringId = null;
let editingRuleId = null;
let automationLastRunAt = 0;
let supportsAutomationApi = true;
let backendCapabilitiesLoaded = false;
let backendCapabilitiesPromise = null;

export function applyAutomationApiAvailability() {
  const panel = document.querySelector('[data-settings-panel="automation"]');
  if (!panel) return;
  panel.style.display = supportsAutomationApi ? '' : 'none';
}

export function applyBackendCapabilities(paths = {}) {
  const automationPaths = [
    '/automation/recurring',
    '/automation/rules',
    '/automation/run',
    '/forecast'
  ];
  supportsAutomationApi = automationPaths.every((path) => Boolean(paths[path]));
  applyAutomationApiAvailability();
}

export async function detectBackendCapabilities() {
  if (!API) return;
  try {
    const res = await fetch(`${API}/openapi.json`, {
      credentials: 'include',
      mode: 'cors'
    });
    if (!res.ok) return;
    const spec = await res.json().catch(() => null);
    applyBackendCapabilities(spec?.paths || {});
  } catch {}
}

export async function ensureBackendCapabilities() {
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

export function getAllParentCategories() {
  const parents = [];
  for (const section of state.tree || []) {
    for (const cat of section.categories || []) {
      parents.push(cat);
    }
  }
  return parents;
}

export function renderRecurringSubcategories(parentId) {
  const sel = $('recurringSubcategory');
  if (!sel) return;
  const parent = parentId ? state.catsById.get(parentId) : null;
  const subs = parent?.subcategories || [];
  sel.innerHTML =
    `<option value="">Sin subcategoría</option>` +
    subs.map((item) => buildSubcategoryOption(item, parent)).join('');
}

export function renderRuleSubcategories(parentId) {
  const sel = $('ruleSubcategory');
  if (!sel) return;
  const parent = parentId ? state.catsById.get(parentId) : null;
  const subs = parent?.subcategories || [];
  sel.innerHTML =
    `<option value="">Sin subcategoría</option>` +
    subs.map((item) => buildSubcategoryOption(item, parent)).join('');
}

export function fillAutomationSelectors() {
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
        .map((acc) => {
          const accId = String(acc.id || acc._id || '');
          return `<option value="${escapeHtml(accId)}">${escapeHtml(acc.name || 'Cuenta')}</option>`;
        })
        .join('');
  }
  if (ruleAccount) {
    ruleAccount.innerHTML =
      `<option value="">Sin cambio de cuenta</option>` +
      accounts
        .map((acc) => {
          const accId = String(acc.id || acc._id || '');
          return `<option value="${escapeHtml(accId)}">${escapeHtml(acc.name || 'Cuenta')}</option>`;
        })
        .join('');
  }

  renderRecurringSubcategories(recurringCategory?.value || '');
  renderRuleSubcategories(ruleCategory?.value || '');
}

export function clearRecurringForm() {
  editingRecurringId = null;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;

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
    $('recurringMonth').value = String(now.getMonth() + 1);
  if ($('recurringNote')) $('recurringNote').value = '';
  if ($('recurringStart')) $('recurringStart').value = today;
  if ($('recurringEnd')) $('recurringEnd').value = '';
  if ($('recurringActive')) $('recurringActive').checked = true;
}

export function clearRuleForm() {
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

export function renderRecurringTemplates() {
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
      const amount = Number(item.amount || 0).toFixed(2);
      const itemId = String(item.id || item._id || '');
      return `
        <article class="automation-item">
          <div class="automation-item-head">
            <h5 class="automation-item-title">${escapeHtml(item.name || 'Recurrente')}</h5>
            <div class="automation-item-actions">
              <button class="automation-action-btn" data-automation-action="edit-recurring" data-id="${escapeHtml(itemId)}" title="Editar"><i class="ph ph-pencil"></i></button>
              <button class="automation-action-btn" data-automation-action="delete-recurring" data-id="${escapeHtml(itemId)}" title="Eliminar"><i class="ph ph-trash"></i></button>
            </div>
          </div>
          <p class="automation-item-meta">${escapeHtml(cadence)} · Día ${escapeHtml(String(item.day_of_month || 1))} · ${escapeHtml(status)} · ${amount}€</p>
        </article>
      `;
    })
    .join('');
}

export function renderAutomationRules() {
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
      const itemId = String(item.id || item._id || '');
      return `
        <article class="automation-item">
          <div class="automation-item-head">
            <h5 class="automation-item-title">${escapeHtml(item.name || 'Regla')}</h5>
            <div class="automation-item-actions">
              <button class="automation-action-btn" data-automation-action="edit-rule" data-id="${escapeHtml(itemId)}" title="Editar"><i class="ph ph-pencil"></i></button>
              <button class="automation-action-btn" data-automation-action="delete-rule" data-id="${escapeHtml(itemId)}" title="Eliminar"><i class="ph ph-trash"></i></button>
            </div>
          </div>
          <p class="automation-item-meta">${escapeHtml(item.match_mode || 'contains')} "${escapeHtml(item.keyword || '')}" · Prioridad ${escapeHtml(String(item.priority || 100))} · ${escapeHtml(status)}</p>
        </article>
      `;
    })
    .join('');
}

export function renderForecastSummary() {
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

export async function loadRecurringTemplates() {
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
    throw new Error(
      res.data?.message ||
        res.data?.detail ||
        'No se pudieron cargar recurrentes'
    );
  }

  state.recurringTemplates = Array.isArray(res.data) ? res.data : [];
  renderRecurringTemplates();
}

export async function loadAutomationRules() {
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
    throw new Error(
      res.data?.message || res.data?.detail || 'No se pudieron cargar reglas'
    );
  }

  state.automationRules = Array.isArray(res.data) ? res.data : [];
  renderAutomationRules();
}

export async function loadForecast() {
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
    throw new Error(
      res.data?.message || res.data?.detail || 'No se pudo cargar la proyección'
    );
  }

  state.forecast = res.data;
  renderForecastSummary();
}

export async function runAutomationNow() {
  const token = getApiToken();
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
  } catch {}
}

export async function loadAutomationWorkspace() {
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

export function getRecurringPayloadFromForm() {
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
      ? new Date($('recurringStart').value + 'T00:00:00Z').toISOString()
      : null,
    end_date: $('recurringEnd')?.value
      ? new Date($('recurringEnd').value + 'T23:59:59Z').toISOString()
      : null,
    is_active: Boolean($('recurringActive')?.checked)
  };
}

export async function saveRecurringTemplate() {
  const payload = getRecurringPayloadFromForm();
  if (
    !payload.name ||
    !payload.category_id ||
    !Number.isFinite(payload.amount) ||
    payload.amount <= 0
  ) {
    showAlert('Completa nombre, categoría e importe válido', 'error');
    return;
  }

  const method = editingRecurringId ? 'PATCH' : 'POST';
  const path = editingRecurringId
    ? `/automation/recurring/${editingRecurringId}`
    : '/automation/recurring';

  await api(path, { method, json: true, body: JSON.stringify(payload) });
  clearRecurringForm();
  await loadRecurringTemplates();
  await runAutomationNow();
  showAlert('Recurrente guardada', 'success');
}

export async function deleteRecurringTemplate(id) {
  if (!confirm('¿Eliminar esta plantilla recurrente?')) return;
  await api(`/automation/recurring/${id}`, { method: 'DELETE' });
  if (editingRecurringId === id) clearRecurringForm();
  await loadRecurringTemplates();
}

export function editRecurringTemplate(id) {
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

export function getRulePayloadFromForm() {
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

export async function saveAutomationRule() {
  const payload = getRulePayloadFromForm();
  if (!payload.name || !payload.keyword) {
    showAlert('Completa nombre y palabra clave de la regla', 'error');
    return;
  }

  const method = editingRuleId ? 'PATCH' : 'POST';
  const path = editingRuleId
    ? `/automation/rules/${editingRuleId}`
    : '/automation/rules';
  await api(path, { method, json: true, body: JSON.stringify(payload) });
  clearRuleForm();
  await loadAutomationRules();
  showAlert('Regla guardada', 'success');
}

export async function deleteAutomationRule(id) {
  if (!confirm('¿Eliminar esta regla?')) return;
  await api(`/automation/rules/${id}`, { method: 'DELETE' });
  if (editingRuleId === id) clearRuleForm();
  await loadAutomationRules();
}

export function editAutomationRule(id) {
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

export async function exportAllTransactionsCsv() {
  const headers = {};
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}/transactions/export.csv`, {
    method: 'GET',
    headers,
    credentials: 'include',
    mode: 'cors'
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(
      errorData?.message ||
        errorData?.detail ||
        'No se pudo exportar el archivo CSV'
    );
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  a.download = `movimientos-${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importTransactionsCsv() {
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
  globalThis.loadViewContent?.(state.currentViewId);
}

export function initAutomationListeners() {
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

  if (recurringCategory) {
    recurringCategory.addEventListener('change', () =>
      renderRecurringSubcategories(recurringCategory.value || '')
    );
  }
  if (ruleCategory) {
    ruleCategory.addEventListener('change', () =>
      renderRuleSubcategories(ruleCategory.value || '')
    );
  }

  if (btnSaveRecurring) {
    btnSaveRecurring.addEventListener('click', () => {
      saveRecurringTemplate().catch((err) =>
        showAlert(err?.message || 'No se pudo guardar la recurrente', 'error')
      );
    });
  }
  if (btnClearRecurring)
    btnClearRecurring.addEventListener('click', clearRecurringForm);

  if (btnSaveRule) {
    btnSaveRule.addEventListener('click', () => {
      saveAutomationRule().catch((err) =>
        showAlert(err?.message || 'No se pudo guardar la regla', 'error')
      );
    });
  }
  if (btnClearRule) btnClearRule.addEventListener('click', clearRuleForm);

  if (btnRefreshForecast) {
    btnRefreshForecast.addEventListener('click', () => {
      loadForecast().catch((err) =>
        showAlert(err?.message || 'No se pudo cargar la proyección', 'error')
      );
    });
  }

  if (btnExportAllCsv) {
    btnExportAllCsv.addEventListener('click', () => {
      exportAllTransactionsCsv().catch((err) =>
        showAlert(err?.message || 'No se pudo exportar CSV', 'error')
      );
    });
  }

  if (btnImportCsv) {
    btnImportCsv.addEventListener('click', () => {
      importTransactionsCsv().catch((err) =>
        showAlert(err?.message || 'No se pudo importar CSV', 'error')
      );
    });
  }

  if (csvImportFile) {
    csvImportFile.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        if ($('csvImportText')) $('csvImportText').value = text;
      } catch (err) {
        showAlert(err?.message || 'No se pudo leer el archivo CSV', 'error');
      }
    });
  }

  if (recurringList) {
    recurringList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-automation-action][data-id]');
      if (!button) return;
      const id = button.dataset.id || '';
      const action = button.dataset.automationAction;
      if (action === 'edit-recurring') editRecurringTemplate(id);
      if (action === 'delete-recurring') {
        deleteRecurringTemplate(id).catch((err) =>
          showAlert(err?.message || 'No se pudo eliminar la plantilla', 'error')
        );
      }
    });
  }

  if (ruleList) {
    ruleList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-automation-action][data-id]');
      if (!button) return;
      const id = button.dataset.id || '';
      const action = button.dataset.automationAction;
      if (action === 'edit-rule') editAutomationRule(id);
      if (action === 'delete-rule') {
        deleteAutomationRule(id).catch((err) =>
          showAlert(err?.message || 'No se pudo eliminar la regla', 'error')
        );
      }
    });
  }

  clearRecurringForm();
  clearRuleForm();
}
