// src/utils/toast.js
import { escapeHtml } from '../features/ui/dom.js';

function getOrCreateToastContainer() {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }
  return container;
}

export function showAlert(message, type = 'info') {
  const container = getOrCreateToastContainer();

  let icon = 'ℹ';
  let typeClass = '';
  let durationMs = 2200;

  if (type === 'error') {
    icon = '✕';
    typeClass = ' is-error';
    durationMs = 3600;
  } else if (type === 'success') {
    icon = '✓';
    typeClass = ' is-success';
    durationMs = 2200;
  }

  const toast = document.createElement('div');
  toast.className = `toast${typeClass}`;
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span class="toast-msg">${escapeHtml(String(message ?? ''))}</span>`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  container.appendChild(toast);

  let removed = false;
  const removeToast = () => {
    if (removed) return;
    removed = true;
    toast.remove();
  };

  const dismiss = () => {
    if (removed) return;
    toast.classList.add('is-out');

    const styles = globalThis.getComputedStyle
      ? globalThis.getComputedStyle(toast)
      : null;
    const duration = styles ? Number.parseFloat(styles.animationDuration) : 0;
    const animationName = styles?.animationName || 'none';
    const hasAnimation = duration > 0 && animationName !== 'none';

    if (hasAnimation) {
      toast.addEventListener('animationend', removeToast, { once: true });
      setTimeout(removeToast, 450);
      return;
    }
    setTimeout(removeToast, 0);
  };

  const timer = setTimeout(dismiss, durationMs);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}
