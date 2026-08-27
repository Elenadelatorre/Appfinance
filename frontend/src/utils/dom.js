// js/utils/dom.js

export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderListEmptyState(iconClass, title, hint = '') {
  const hintHtml = hint
    ? `<p class="list-empty-state__hint">${escapeHtml(hint)}</p>`
    : '';
  return `
    <div class="list-empty-state" role="status" aria-live="polite">
      <span class="list-empty-state__icon" aria-hidden="true"><i class="ph ${escapeHtml(iconClass)}"></i></span>
      <p class="list-empty-state__msg">${escapeHtml(title)}</p>
      ${hintHtml}
    </div>
  `;
}

export function clearFileInput(inputId) {
  const input = $(inputId);
  if (input) input.value = '';
}

export function setValueIfElement(element, value) {
  if (element) element.value = value;
}