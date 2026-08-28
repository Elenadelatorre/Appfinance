// src/ui/modals.js
import { $ } from './dom.js';

let activeModal = null;
let modalTransitionTimer = null;
let lastFocusedElement = null;

export function openModal(modalId = 'modalAddTx') {
  const m = $(modalId);
  if (!m) return;

  if (modalTransitionTimer) {
    clearTimeout(modalTransitionTimer);
    modalTransitionTimer = null;
  }

  lastFocusedElement = document.activeElement;
  activeModal = m;
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  try {
    history.pushState({ modalOpen: true, modalId }, '');
  } catch {}

  requestAnimationFrame(() => {
    m.classList.add('active');
    const firstInput = m.querySelector(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    );
    if (firstInput && typeof firstInput.focus === 'function') {
      firstInput.focus();
    }
  });
}

export function closeModal(modalId = 'modalAddTx', skipHistoryBack = false) {
  const m = $(modalId) || activeModal;
  if (!m) return;

  m.classList.remove('active');

  if (
    !skipHistoryBack &&
    history.state?.modalOpen &&
    history.state?.modalId === m.id
  ) {
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
      if (
        lastFocusedElement &&
        typeof lastFocusedElement.focus === 'function'
      ) {
        try {
          lastFocusedElement.focus();
        } catch {}
      }
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
