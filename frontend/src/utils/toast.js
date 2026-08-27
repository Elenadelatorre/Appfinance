// js/utils/toast.js
import { escapeHtml } from '../features/ui/dom.js';

export function showAlert(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    if (type === 'error') console.error('[showAlert]', message);
    else console.info('[showAlert]', message);
    return;
  }

  let icon = 'ℹ';
  let typeClass = '';
  if (type === 'error') {
    icon = '✕';
    typeClass = ' is-error';
  } else if (type === 'success') {
    icon = '✓';
    typeClass = ' is-success';
  }

  const toast = document.createElement('div');
  toast.className = `toast${typeClass}`;
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span class="toast-msg">${escapeHtml(String(message))}</span>`;
  toast.setAttribute('role', 'alert');
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

  const timer = setTimeout(dismiss, 2200);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}
