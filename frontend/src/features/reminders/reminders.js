// src/features/reminders/reminders.js
import { state } from '../../state/state.js';
import { api, getApiToken } from '../../services/api.js';
import {
  REMINDER_TYPE_LABELS,
  REMINDER_RECURRENCE_LABELS
} from '../../config/constants.js';
import { $, escapeHtml } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';

let editingReminderId = null;

export function reminderIdOf(item) {
  return String(item?.id || item?._id || '');
}

export function reminderTypeLabel(type) {
  return REMINDER_TYPE_LABELS[type] || REMINDER_TYPE_LABELS.other;
}

export function reminderRecurrenceLabel(value) {
  return REMINDER_RECURRENCE_LABELS[value] || REMINDER_RECURRENCE_LABELS.none;
}

export function reminderDueInputValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = /^\d{4}-\d{2}-\d{2}/.exec(raw);
  if (direct) return direct[0];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function reminderDueLabel(value) {
  const inputValue = reminderDueInputValue(value);
  if (!inputValue) return 'Sin fecha';
  const parsed = new Date(`${inputValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
  return parsed.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export function isReminderOverdue(reminder) {
  if (reminder?.is_completed) return false;
  const dueInput = reminderDueInputValue(reminder?.due_date);
  if (!dueInput) return false;
  const dueDate = new Date(`${dueInput}T23:59:59`);
  if (Number.isNaN(dueDate.getTime())) return false;
  return dueDate.getTime() < Date.now();
}

export function getReminderById(reminderId) {
  return (state.reminders || []).find(
    (item) => reminderIdOf(item) === String(reminderId)
  );
}

export function getFilteredReminders(reminders = []) {
  const mode = state.reminderFilter || 'all';
  if (mode === 'pending')
    return reminders.filter((item) => !item?.is_completed);
  if (mode === 'overdue')
    return reminders.filter((item) => isReminderOverdue(item));
  return reminders;
}

export function renderReminderFilterControls() {
  const filters = $('reminderFilters');
  if (!filters) return;
  filters.querySelectorAll('[data-reminder-filter]').forEach((button) => {
    const mode = button.dataset.reminderFilter || 'all';
    button.classList.toggle(
      'is-active',
      mode === (state.reminderFilter || 'all')
    );
  });
}

export function notifyReminderAdvanceAlert() {
  const reminders = Array.isArray(state.reminders) ? state.reminders : [];
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );
  const threshold = new Date(todayStart);
  threshold.setMonth(threshold.getMonth() + 2);

  const upcoming = reminders.filter((item) => {
    if (item?.is_completed) return false;
    const dueInput = reminderDueInputValue(item?.due_date);
    if (!dueInput) return false;
    const due = new Date(`${dueInput}T00:00:00`);
    if (Number.isNaN(due.getTime())) return false;
    return due >= todayStart && due <= threshold;
  });

  if (!upcoming.length) return;

  const nearest = upcoming
    .slice()
    .sort((a, b) => {
      const aDue = reminderDueInputValue(a?.due_date) || '9999-12-31';
      const bDue = reminderDueInputValue(b?.due_date) || '9999-12-31';
      return aDue.localeCompare(bDue);
    })
    .slice(0, 2)
    .map((item) => String(item?.title || 'Recordatorio'));

  const preview = nearest.length ? ` (${nearest.join(', ')})` : '';
  showAlert(
    `Tienes ${upcoming.length} recordatorio(s) que vencen en los próximos 2 meses${preview}`,
    'info'
  );
}

export function updateReminderTabBadge() {
  const badge = $('remindersTabBadge');
  if (!badge) return;

  const reminders = Array.isArray(state.reminders) ? state.reminders : [];
  const pendingCount = reminders.filter((item) => !item?.is_completed).length;

  if (!pendingCount) {
    badge.style.display = 'none';
    badge.textContent = '0';
    return;
  }

  badge.style.display = 'inline-flex';
  badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
}

export function renderRemindersList() {
  const container = $('remindersList');
  if (!container) return;

  const reminders = getFilteredReminders(
    Array.isArray(state.reminders) ? [...state.reminders] : []
  );
  reminders.sort((a, b) => {
    if (Boolean(a.is_completed) !== Boolean(b.is_completed)) {
      return a.is_completed ? 1 : -1;
    }
    const aDue = reminderDueInputValue(a?.due_date) || '9999-12-31';
    const bDue = reminderDueInputValue(b?.due_date) || '9999-12-31';
    return aDue.localeCompare(bDue);
  });

  if (!reminders.length) {
    container.innerHTML = `
      <div class="list-empty-state">
        <span class="list-empty-state__icon"><i class="ph ph-bell-slash"></i></span>
        <p class="list-empty-state__msg">Sin recordatorios aún</p>
        <p class="list-empty-state__hint">Pulsa «Nuevo» para añadir seguros, suscripciones o cobros.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = reminders
    .map((item) => {
      const id = reminderIdOf(item);
      const completed = Boolean(item.is_completed);
      const overdue = isReminderOverdue(item);
      const hasAmount =
        Number.isFinite(Number(item.amount)) &&
        item.amount !== null &&
        item.amount !== '';
      const amountText = hasAmount
        ? `${Number(item.amount).toFixed(2)}€`
        : null;
      let status = 'Pendiente';
      let tone = '';
      if (completed) {
        status = 'Pagado';
        tone = 'is-completed';
      } else if (overdue) {
        status = 'Vencido';
        tone = 'is-overdue';
      }
      const note = String(item.note || '').trim();
      const toggleLabel = completed ? 'Marcar pendiente' : 'Marcar pagado';
      const recurrence = reminderRecurrenceLabel(item.recurrence || 'none');

      return `
        <article class="reminder-card ${tone}" data-reminder-id="${escapeHtml(id)}">
          <div class="reminder-card-head">
            <div>
              <h4>${escapeHtml(String(item.title || 'Recordatorio'))}</h4>
              <p class="reminder-meta">
                <span><i class="ph ph-calendar-dots"></i> ${escapeHtml(reminderDueLabel(item.due_date))}</span>
                <span><i class="ph ph-tag"></i> ${escapeHtml(reminderTypeLabel(item.type))}</span>
                <span><i class="ph ph-repeat"></i> ${escapeHtml(recurrence)}</span>
                ${amountText ? `<span><i class="ph ph-currency-eur"></i> ${escapeHtml(amountText)}</span>` : ''}
              </p>
            </div>
            <span class="reminder-status-pill">${escapeHtml(status)}</span>
          </div>
          ${note ? `<p class="reminder-note">${escapeHtml(note)}</p>` : ''}
          <div class="reminder-actions-row">
            <button class="btn" type="button" data-action="toggle-reminder" data-id="${escapeHtml(id)}">
              <i class="ph ph-check-circle"></i> ${escapeHtml(toggleLabel)}
            </button>
            <button class="btn" type="button" data-action="edit-reminder" data-id="${escapeHtml(id)}">
              <i class="ph ph-pencil-simple"></i> Editar
            </button>
            <button class="btn" type="button" data-action="delete-reminder" data-id="${escapeHtml(id)}">
              <i class="ph ph-trash"></i> Borrar
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

export function resetReminderForm(shouldFocus = false) {
  editingReminderId = null;
  const title = $('reminderTitle');
  const amount = $('reminderAmount');
  const dueDate = $('reminderDueDate');
  const type = $('reminderType');
  const recurrence = $('reminderRecurrence');
  const autoAdvance = $('reminderAutoAdvance');
  const note = $('reminderNote');
  const completed = $('reminderCompleted');
  const saveBtn = $('btnSaveReminder');

  if (title) title.value = '';
  if (amount) amount.value = '';
  if (dueDate) dueDate.value = '';
  if (type) type.value = 'insurance';
  if (recurrence) recurrence.value = 'none';
  if (autoAdvance) autoAdvance.checked = true;
  if (note) note.value = '';
  if (completed) completed.checked = false;
  if (saveBtn)
    saveBtn.innerHTML = '<i class="ph ph-check"></i> Guardar recordatorio';

  if (shouldFocus && title) title.focus();
}

export function loadReminderInForm(reminderId) {
  const reminder = getReminderById(reminderId);
  if (!reminder) return;

  editingReminderId = reminderIdOf(reminder);
  const title = $('reminderTitle');
  const amount = $('reminderAmount');
  const dueDate = $('reminderDueDate');
  const type = $('reminderType');
  const recurrence = $('reminderRecurrence');
  const autoAdvance = $('reminderAutoAdvance');
  const note = $('reminderNote');
  const completed = $('reminderCompleted');
  const saveBtn = $('btnSaveReminder');
  const reminderEditorCard = $('reminderEditorCard');
  const btnToggleReminderForm = $('btnToggleReminderForm');

  if (reminderEditorCard && reminderEditorCard.style.display === 'none') {
    reminderEditorCard.style.display = '';
    if (btnToggleReminderForm) {
      btnToggleReminderForm.innerHTML = '<i class="ph ph-minus"></i> Cerrar';
    }
  }

  if (title) title.value = String(reminder.title || '');
  if (amount) {
    amount.value =
      Number.isFinite(Number(reminder.amount)) && reminder.amount !== null
        ? Number(reminder.amount).toFixed(2)
        : '';
  }
  if (dueDate) dueDate.value = reminderDueInputValue(reminder.due_date);
  if (type) type.value = reminder.type || 'other';
  if (recurrence) recurrence.value = reminder.recurrence || 'none';
  if (autoAdvance) autoAdvance.checked = reminder.auto_advance !== false;
  if (note) note.value = String(reminder.note || '');
  if (completed) completed.checked = Boolean(reminder.is_completed);
  if (saveBtn)
    saveBtn.innerHTML = '<i class="ph ph-check"></i> Guardar cambios';
  if (title) {
    title.focus();
    reminderEditorCard?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }
}

export function buildReminderPayloadFromForm() {
  const titleRaw = String($('reminderTitle')?.value || '').trim();
  const amountRaw = String($('reminderAmount')?.value || '').trim();
  const dueDate = String($('reminderDueDate')?.value || '').trim();
  const type = String($('reminderType')?.value || 'other').trim();
  const recurrence = String($('reminderRecurrence')?.value || 'none').trim();
  const autoAdvance = Boolean($('reminderAutoAdvance')?.checked);
  const noteRaw = String($('reminderNote')?.value || '').trim();
  const isCompleted = Boolean($('reminderCompleted')?.checked);

  if (!titleRaw) {
    showAlert('Indica el nombre del recordatorio', 'error');
    $('reminderTitle')?.focus();
    return null;
  }
  if (!dueDate) {
    showAlert('Selecciona la fecha de vencimiento', 'error');
    $('reminderDueDate')?.focus();
    return null;
  }

  let amountValue = null;
  if (amountRaw) {
    amountValue = Number(amountRaw);
    if (!Number.isFinite(amountValue) || amountValue < 0) {
      showAlert('El importe debe ser un número positivo', 'error');
      $('reminderAmount')?.focus();
      return null;
    }
    amountValue = Number(amountValue.toFixed(2));
  }

  return {
    title: titleRaw,
    due_date: `${dueDate}T00:00:00`,
    amount: amountValue,
    type: REMINDER_TYPE_LABELS[type] ? type : 'other',
    recurrence: REMINDER_RECURRENCE_LABELS[recurrence] ? recurrence : 'none',
    auto_advance: autoAdvance,
    note: noteRaw || null,
    is_completed: isCompleted
  };
}

export async function loadReminders(options = {}) {
  const shouldNotify = Boolean(options?.notifyAdvance);
  const token = getApiToken();

  if (!token) {
    state.reminders = [];
    updateReminderTabBadge();
    renderReminderFilterControls();
    renderRemindersList();
    return;
  }
  try {
    const data = await api('/reminders');
    state.reminders = Array.isArray(data) ? data : [];
    updateReminderTabBadge();
    renderReminderFilterControls();
    renderRemindersList();
    if (shouldNotify) notifyReminderAdvanceAlert();
  } catch (err) {
    console.error('Error cargando recordatorios:', err);
  }
}

export async function saveReminderFromSettings() {
  const payload = buildReminderPayloadFromForm();
  if (!payload) return;

  try {
    if (editingReminderId) {
      await api(`/reminders/${editingReminderId}`, {
        method: 'PATCH',
        json: true,
        body: JSON.stringify(payload)
      });
      showAlert('Recordatorio actualizado', 'success');
    } else {
      await api('/reminders', {
        method: 'POST',
        json: true,
        body: JSON.stringify(payload)
      });
      showAlert('Recordatorio guardado', 'success');
    }
    resetReminderForm();
    await loadReminders();
  } catch (err) {
    showAlert(err?.message || 'No se pudo guardar el recordatorio', 'error');
  }
}

export async function toggleReminderStatus(reminderId) {
  const reminder = getReminderById(reminderId);
  if (!reminder) return;

  try {
    const payload = { is_completed: !reminder.is_completed };
    await api(`/reminders/${reminderId}`, {
      method: 'PATCH',
      json: true,
      body: JSON.stringify(payload)
    });
    await loadReminders();
  } catch (err) {
    showAlert(err?.message || 'No se pudo actualizar el recordatorio', 'error');
  }
}

export async function deleteReminder(reminderId) {
  const reminder = getReminderById(reminderId);
  const title = reminder ? String(reminder.title || '').trim() : '';
  const ok = confirm(
    title
      ? `¿Eliminar el recordatorio "${title}"?`
      : '¿Eliminar este recordatorio?'
  );
  if (!ok) return;

  try {
    await api(`/reminders/${reminderId}`, { method: 'DELETE' });
    if (editingReminderId && editingReminderId === String(reminderId)) {
      resetReminderForm();
    }
    await loadReminders();
    showAlert('Recordatorio eliminado', 'success');
  } catch (err) {
    showAlert(err?.message || 'No se pudo eliminar el recordatorio', 'error');
  }
}

export function initReminderListeners() {
  const btnSaveReminder = $('btnSaveReminder');
  const btnClearReminderForm = $('btnClearReminderForm');
  const reminderFilters = $('reminderFilters');
  const remindersList = $('remindersList');
  const btnToggleReminderForm = $('btnToggleReminderForm');
  const reminderEditorCard = $('reminderEditorCard');
  const reminderTitle = $('reminderTitle');
  const reminderAmount = $('reminderAmount');
  const reminderDueDate = $('reminderDueDate');

  if (btnToggleReminderForm && reminderEditorCard) {
    btnToggleReminderForm.addEventListener('click', () => {
      const isHidden = reminderEditorCard.style.display === 'none';
      reminderEditorCard.style.display = isHidden ? '' : 'none';
      btnToggleReminderForm.innerHTML = isHidden
        ? '<i class="ph ph-minus"></i> Cerrar'
        : '<i class="ph ph-plus"></i> Nuevo';
    });
  }

  if (btnSaveReminder) {
    btnSaveReminder.addEventListener('click', () => saveReminderFromSettings());
  }

  if (btnClearReminderForm) {
    btnClearReminderForm.addEventListener('click', () =>
      resetReminderForm(true)
    );
  }

  const handleEnterKey = (e) => {
    if (e.key === 'Enter') saveReminderFromSettings();
  };
  reminderTitle?.addEventListener('keydown', handleEnterKey);
  reminderAmount?.addEventListener('keydown', handleEnterKey);
  reminderDueDate?.addEventListener('keydown', handleEnterKey);

  if (reminderFilters) {
    reminderFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-reminder-filter]');
      if (!button) return;
      state.reminderFilter = button.dataset.reminderFilter || 'all';
      renderReminderFilterControls();
      renderRemindersList();
    });
  }

  if (remindersList) {
    remindersList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const reminderId = button.dataset.id;
      if (!reminderId) return;

      if (action === 'toggle-reminder') toggleReminderStatus(reminderId);
      else if (action === 'edit-reminder') loadReminderInForm(reminderId);
      else if (action === 'delete-reminder') deleteReminder(reminderId);
    });
  }
}
