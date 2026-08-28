// src/ui/modal.js
import { $ } from './dom.js';

let activeModal = null;
let modalTransitionTimer = null;

export function openModal(modalId = 'modalAddTx') {
  const m = $(modalId);
  if (!m) return;

  if (modalTransitionTimer) {
    clearTimeout(modalTransitionTimer);
    modalTransitionTimer = null;
  }

  activeModal = m;
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  try {
    history.pushState({ modalOpen: true, modalId }, '');
  } catch {}

  requestAnimationFrame(() => {
    m.classList.add('active');
  });
}

export function closeModal(modalId = 'modalAddTx', skipHistoryBack = false) {
  const m = $(modalId) || activeModal;
  if (!m) return;

  m.classList.remove('active');

  if (!skipHistoryBack && history.state?.modalOpen) {
    try {
      history.back();
    } catch {}
  }

  if (modalTransitionTimer) {
    clearTimeout(modalTransitionTimer);
  }

  modalTransitionTimer = setTimeout(() => {
    m.style.display = 'none';
    if (activeModal === m) {
      activeModal = null;
      document.body.style.overflow = '';
    }
  }, 250);
}

export function attachModalOutsideClose() {
  globalThis.addEventListener('click', (ev) => {
    const target = ev.target;
    if (target && target.classList && target.classList.contains('modal')) {
      closeModal(target.id || 'modalAddTx');
    }
  });

  globalThis.addEventListener('keydown', (ev) => {
    if (
      ev.key === 'Escape' &&
      activeModal &&
      activeModal.style.display === 'flex'
    ) {
      closeModal(activeModal.id);
    }
  });
}

globalThis.addEventListener('popstate', () => {
  if (activeModal && activeModal.style.display === 'flex') {
    closeModal(activeModal.id, true);
  }
});
