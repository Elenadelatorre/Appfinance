// js/utils/modal.js
import { $ } from '../features/ui/dom.js';

let activeModal = null;

export function openModal(modalId = 'modalAddTx') {
  const m = $(modalId);
  if (!m) return;
  activeModal = m;
  m.style.display = 'flex';
  history.pushState({ modalOpen: true }, '');
  setTimeout(() => m.classList.add('active'), 10);
}

export function closeModal(modalId = 'modalAddTx', skipHistoryBack = false) {
  const m = $(modalId);
  if (!m) return;
  m.classList.remove('active');
  if (!skipHistoryBack && history.state?.modalOpen) {
    history.back();
  }
  setTimeout(() => {
    m.style.display = 'none';
    if (activeModal === m) activeModal = null;
  }, 250);
}

export function attachModalOutsideClose() {
  globalThis.addEventListener('click', (ev) => {
    const txModal = $('modalAddTx');
    const accModal = $('modalAddAccount');
    const transferModal = $('modalTransfer');

    if (txModal && ev.target === txModal) closeModal('modalAddTx');
    if (accModal && ev.target === accModal) closeModal('modalAddAccount');
    if (transferModal && ev.target === transferModal)
      closeModal('modalTransfer');
  });
}

globalThis.addEventListener('popstate', () => {
  if (activeModal?.style.display === 'flex') {
    closeModal(activeModal.id, true);
  }
});
