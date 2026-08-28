// src/ui/dom.js

export const $ = (id) =>
  typeof id === 'string' ? document.getElementById(id) : id;

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => HTML_ESCAPE_MAP[char]
  );
}

export function renderListEmptyState(iconClass, title, hint = '') {
  const cleanIconClass = String(iconClass || 'ph-receipt').trim();
  const fullIconClass =
    cleanIconClass.startsWith('ph ') || cleanIconClass.startsWith('ph-')
      ? cleanIconClass
      : `ph-${cleanIconClass}`;

  const hintHtml = hint
    ? `<p class="list-empty-state__hint">${escapeHtml(hint)}</p>`
    : '';

  return `
    <div class="list-empty-state" role="status" aria-live="polite">
      <span class="list-empty-state__icon" aria-hidden="true"><i class="ph ${escapeHtml(fullIconClass)}"></i></span>
      <p class="list-empty-state__msg">${escapeHtml(title)}</p>
      ${hintHtml}
    </div>
  `;
}

export function clearFileInput(inputOrId) {
  const input = typeof inputOrId === 'string' ? $(inputOrId) : inputOrId;
  if (input && 'value' in input) {
    input.value = '';
  }
}

export function setValueIfElement(elementOrId, value) {
  const element =
    typeof elementOrId === 'string' ? $(elementOrId) : elementOrId;
  if (element && 'value' in element) {
    element.value = value ?? '';
  }
}
