// src/features/accounts/accounts.js
import { state } from '../../state/state.js';
import { api } from '../../services/api.js';
import { $, escapeHtml, clearFileInput } from '../../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import { openModal, closeModal } from '../../ui/modals.js';
import {
  normalizeColorValue,
  normalizeRemoteImageUrl,
  readImageFileAsDataUrl,
  renderVisualPreview
} from '../../utils/visuals.js';
import {
  annotateTransactionsWithRunningBalances,
  sortTransactionsByMostRecent,
  renderTxItem,
  openViewTx
} from '../transactions/transactions.js';

let accountFormImageData = null;
let switchViewCallback = null;

export function setAccountsNavigationCallback(callback) {
  switchViewCallback = callback;
}

export function getAccountAccent(account) {
  const customAccent = normalizeColorValue(account?.bg_color);
  if (customAccent) return customAccent;

  const name = String(account?.name || '').toLowerCase();
  const type = String(account?.type || '').toLowerCase();

  if (name.includes('trade republic')) return '#86efac';
  if (name.includes('hucha') || name.includes('ahorro')) return '#ec4899';
  if (name.includes('santander')) return '#fecaca';
  if (name.includes('imagin')) return '#93c5fd';
  if (type === 'credit') return '#c4b5fd';
  if (type === 'cash') return '#fde68a';

  return 'rgba(255, 255, 255, 0.78)';
}

export function getAccountSurface(account) {
  const customAccent = normalizeColorValue(account?.bg_color);
  if (customAccent) {
    return `color-mix(in srgb, ${customAccent} 18%, white)`;
  }

  const name = String(account?.name || '').toLowerCase();
  const type = String(account?.type || '').toLowerCase();

  if (name.includes('trade republic')) return 'rgba(17, 24, 39, 0.06)';
  if (name.includes('hucha') || name.includes('ahorro'))
    return 'rgba(236, 72, 153, 0.12)';
  if (name.includes('santander')) return 'rgba(254, 202, 202, 0.16)';
  if (name.includes('imagin')) return 'rgba(96, 165, 250, 0.12)';
  if (type === 'credit') return 'rgba(167, 139, 250, 0.12)';
  if (type === 'cash') return 'rgba(251, 191, 36, 0.12)';

  return 'rgba(203, 213, 225, 0.12)';
}

export function getAccountBorder(account) {
  const customBorder = normalizeColorValue(account?.border_color);
  if (customBorder) return customBorder;

  const name = String(account?.name || '').toLowerCase();

  if (name.includes('trade republic')) return '#111111';
  if (name.includes('imagin')) return '#60a5fa';
  if (name.includes('santander')) return '#fecaca';

  return 'color-mix(in srgb, var(--account-accent) 44%, white)';
}

export function getAccountBrand(account) {
  const customIcon = String(account?.icon || '').trim();
  const customImage = String(account?.image_data || '').trim();
  const customAccent = normalizeColorValue(account?.bg_color);
  const customBorder = normalizeColorValue(account?.border_color);

  if (customIcon || customImage) {
    return {
      brand: 'custom',
      icon: customIcon || '🏦',
      label: String(account?.name || 'Cuenta'),
      imageData: customImage || null,
      accent: customAccent,
      border: customBorder
    };
  }

  const name = String(account?.name || '').toLowerCase();
  const type = String(account?.type || '').toLowerCase();

  if (name.includes('trade republic')) {
    return {
      brand: 'trade-republic',
      icon: 'ph-chart-line-up',
      label: 'Trade Republic',
      logoPath: '/media/unnamed (2).png'
    };
  }

  if (name.includes('hucha') || name.includes('ahorro')) {
    return {
      brand: 'savings',
      icon: 'ph-piggy-bank',
      label: 'Ahorro',
      logoPath: '/media/hucha.png'
    };
  }

  if (name.includes('santander')) {
    return {
      brand: 'santander',
      icon: 'ph-flame',
      label: 'Santander',
      logoPath: '/media/santander(2).png'
    };
  }

  if (name.includes('imagin')) {
    return {
      brand: 'imagin',
      icon: 'ph-star-four',
      label: 'Imagin',
      logoPath: '/media/unnamed (1).png'
    };
  }

  if (type === 'credit')
    return { brand: 'credit', icon: 'ph-credit-card', label: 'Crédito' };
  if (type === 'cash')
    return { brand: 'cash', icon: 'ph-wallet', label: 'Efectivo' };

  return { brand: 'default', icon: 'ph-bank', label: 'Cuenta' };
}

export function getAccountBadgeMarkup(account, sizeClass = '') {
  const brand = getAccountBrand(account);
  const sizeClassName = sizeClass ? ` ${sizeClass}` : '';
  const styleParts = [];
  if (brand.accent) styleParts.push(`--account-badge-accent:${brand.accent}`);
  if (brand.border) styleParts.push(`--account-badge-border:${brand.border}`);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';

  if (brand.imageData) {
    return `<span class="account-brand-badge account-brand-badge--custom account-brand-badge--image${sizeClassName}" data-brand="${brand.brand}" title="${escapeHtml(brand.label)}"${styleAttr}><img class="account-brand-logo" src="${brand.imageData}" alt="${escapeHtml(brand.label)}" loading="lazy" decoding="async" /></span>`;
  }
  if (brand.logoPath) {
    return `<span class="account-brand-badge account-brand-badge--logo${sizeClassName}" data-brand="${brand.brand}" title="${escapeHtml(brand.label)}"${styleAttr}><img class="account-brand-logo" src="${brand.logoPath}" alt="${escapeHtml(brand.label)}" loading="lazy" decoding="async" /></span>`;
  }
  if (brand.brand === 'custom') {
    return `<span class="account-brand-badge account-brand-badge--custom${sizeClassName}" data-brand="${brand.brand}" title="${escapeHtml(brand.label)}"${styleAttr}>${escapeHtml(brand.icon)}</span>`;
  }

  return `<span class="account-brand-badge${sizeClassName}" data-brand="${brand.brand}" title="${escapeHtml(brand.label)}"><i class="ph ${brand.icon}"></i></span>`;
}

export function applyAccountTheme(element, account) {
  if (!element) return;
  element.style.setProperty('--account-accent', getAccountAccent(account));
  element.style.setProperty('--account-surface', getAccountSurface(account));
  element.style.setProperty('--account-border', getAccountBorder(account));
}

export function getSortedAccounts(accounts = []) {
  return [...(accounts || [])].sort((a, b) => {
    const aHasOrder = Number.isInteger(a?.order);
    const bHasOrder = Number.isInteger(b?.order);
    if (aHasOrder && bHasOrder) return a.order - b.order;
    if (aHasOrder) return -1;
    if (bHasOrder) return 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'es');
  });
}

export async function ensureAccountsLoaded() {
  if (state.accounts && state.accounts.length > 0) return state.accounts;
  const accounts = await api('/accounts');
  state.accounts = accounts || [];
  return state.accounts;
}

export async function getAccountsFast(forceReload = false) {
  const cached = Array.isArray(state.accounts) ? state.accounts : [];
  if (cached.length && !forceReload) return getSortedAccounts(cached);
  const fresh = getSortedAccounts(await api('/accounts'));
  state.accounts = fresh;
  return fresh;
}

export async function persistAccountsOrder(orderedAccounts = []) {
  const accountIds = orderedAccounts.map((acc) => acc?.id).filter(Boolean);
  if (!accountIds.length) return;
  await api('/accounts/reorder', {
    method: 'POST',
    json: true,
    body: JSON.stringify({ account_ids: accountIds })
  });
}

export async function moveAccountByDirection(accountId, direction) {
  const sortedAccounts = getSortedAccounts(state.accounts || []);
  const currentIndex = sortedAccounts.findIndex(
    (acc) => String(acc.id) === String(accountId)
  );
  if (currentIndex < 0) return;

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sortedAccounts.length) return;

  const [moved] = sortedAccounts.splice(currentIndex, 1);
  sortedAccounts.splice(targetIndex, 0, moved);

  try {
    await persistAccountsOrder(sortedAccounts);
    await loadAccounts();
    showAlert('Orden de cuentas actualizado', 'info');
  } catch (err) {
    showAlert(err?.message || 'No se pudo actualizar el orden', 'error');
  }
}

export async function setAccountAsPrincipal(accountId) {
  const sortedAccounts = getSortedAccounts(state.accounts || []);
  const currentIndex = sortedAccounts.findIndex(
    (acc) => String(acc.id) === String(accountId)
  );
  if (currentIndex <= 0) return;

  const [selected] = sortedAccounts.splice(currentIndex, 1);
  sortedAccounts.unshift(selected);

  try {
    await persistAccountsOrder(sortedAccounts);
    await loadAccounts();
    showAlert('Cuenta principal actualizada', 'info');
  } catch (err) {
    showAlert(err?.message || 'No se pudo fijar la cuenta principal', 'error');
  }
}

export async function loadAccounts() {
  try {
    const accounts = getSortedAccounts(await api('/accounts'));
    state.accounts = accounts || [];
    const container = $('accountsList');
    if (!container) return;

    if (!accounts || accounts.length === 0) {
      container.innerHTML = `
        <div class="list-empty-state">
          <span class="list-empty-state__icon"><i class="ph ph-wallet"></i></span>
          <p class="list-empty-state__msg">Sin cuentas aún</p>
          <p class="list-empty-state__hint">Añade tu primera cuenta para empezar a registrar movimientos.</p>
        </div>
      `;
      return;
    }

    const cardsHtml = accounts
      .map((acc, index) => {
        const typeLabel =
          {
            bank: '🏦 Banco',
            cash: '💵 Efectivo',
            credit: '💳 Tarjeta crédito'
          }[acc.type] || acc.type;

        const balance = Number(acc.current_balance || 0).toFixed(2);
        const [mainName, subtitle = 'Cuenta'] = String(acc.name || '')
          .split('·')
          .map((part) => part.trim())
          .filter(Boolean);
        const accent = getAccountAccent(acc);
        const surface = getAccountSurface(acc);
        const border = getAccountBorder(acc);
        const isNegativeBalance = Number(acc.current_balance || 0) < 0;
        const subtitleClass = /ahorro|hucha/i.test(subtitle)
          ? 'account-card-subtitle account-card-subtitle--muted'
          : 'account-card-subtitle';
        const balanceClass = isNegativeBalance
          ? 'account-card-balance-value account-card-balance-value--negative'
          : 'account-card-balance-value account-card-balance-value--positive';

        const safeTitle = escapeHtml(mainName || acc.name || '');
        const safeSubtitle = escapeHtml(subtitle);

        return `
          <div class="account-card" data-account-id="${acc.id}" draggable="true" style="margin-bottom: 12px; --account-accent: ${accent}; --account-surface: ${surface}; --account-border: ${border};">
            <div class="account-card-top">
              <div class="account-card-top-main">
                ${getAccountBadgeMarkup(acc, 'account-brand-badge--small')}
                <div class="account-card-copy">
                  <h2 class="account-card-title">${safeTitle}</h2>
                  <p class="${subtitleClass}">${safeSubtitle}</p>
                </div>
              </div>
              <div class="account-card-actions">
                <button class="account-card-transfer-btn" data-account-id="${acc.id}" type="button" title="Transferir desde esta cuenta">
                  <i class="ph ph-arrows-left-right"></i>
                </button>
                <button class="account-card-pin-btn" data-account-id="${acc.id}" type="button" title="Fijar como principal" ${index === 0 ? 'disabled' : ''}>
                  <i class="ph ph-push-pin-simple"></i>
                </button>
                <button class="account-card-order-btn" data-account-id="${acc.id}" data-direction="up" type="button" title="Subir" ${index === 0 ? 'disabled' : ''}>
                  <i class="ph ph-arrow-up"></i>
                </button>
                <button class="account-card-order-btn" data-account-id="${acc.id}" data-direction="down" type="button" title="Bajar" ${index === accounts.length - 1 ? 'disabled' : ''}>
                  <i class="ph ph-arrow-down"></i>
                </button>
                <button class="account-card-reset-btn" data-account-id="${acc.id}" data-account-name="${escapeHtml(acc.name || '')}" type="button" title="Reiniciar cuenta">
                  <i class="ph ph-arrow-counter-clockwise"></i>
                </button>
              </div>
            </div>
            <div class="account-card-meta">
              <span class="account-card-type">${escapeHtml(typeLabel)}</span>
              <div class="account-card-balance">
                <p class="account-card-balance-label">Saldo</p>
                <p class="${balanceClass}">${balance}€</p>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    container.innerHTML = cardsHtml;
    attachAccountCardsInteractions(container);
  } catch (err) {
    const container = $('accountsList');
    if (container) {
      container.innerHTML = `<div class="muted">Error cargando cuentas: ${escapeHtml(err?.message || String(err))}</div>`;
    }
  }
}

function attachAccountCardsInteractions(container) {
  if (!container) return;

  container.querySelectorAll('.account-card-reset-btn').forEach((button) => {
    button.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const accountId = button.dataset.accountId || '';
      const accountName = button.dataset.accountName || 'cuenta';
      if (!accountId) return;
      await confirmAndResetAccount(accountId, accountName, false);
    });
  });

  container.querySelectorAll('.account-card-transfer-btn').forEach((button) => {
    button.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const accountId = button.dataset.accountId || '';
      if (!accountId) return;
      await openTransferModal(accountId);
    });
  });

  container.querySelectorAll('.account-card-order-btn').forEach((button) => {
    button.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (button.disabled) return;
      const accountId = button.dataset.accountId || '';
      const direction = button.dataset.direction || 'up';
      if (!accountId) return;
      await moveAccountByDirection(accountId, direction);
    });
  });

  container.querySelectorAll('.account-card-pin-btn').forEach((button) => {
    button.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (button.disabled) return;
      const accountId = button.dataset.accountId || '';
      if (!accountId) return;
      await setAccountAsPrincipal(accountId);
    });
  });

  const cards = Array.from(container.querySelectorAll('.account-card'));
  cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      if (Date.now() < Number(state.accountsDragLockUntil || 0)) return;
      if (event.target.closest('.account-card-actions')) return;
      const accountId = card.dataset.accountId || '';
      if (accountId) openViewAccount(accountId);
    });
  });
}

export function syncAccountFormPreview() {
  renderVisualPreview(
    'accountImagePreview',
    accountFormImageData,
    $('accountIcon')?.value || '',
    '🏦'
  );
}

export function openAddAccountModal() {
  const form = $('accountForm');
  if (form) {
    form.reset();
    if ($('accountName')) $('accountName').value = '';
    if ($('accountSubtitle')) $('accountSubtitle').value = 'Principal';
    if ($('accountType')) $('accountType').value = 'bank';
    if ($('accountBalance')) $('accountBalance').value = '0.00';
  }
  accountFormImageData = null;
  if ($('accountIcon')) $('accountIcon').value = '';
  if ($('accountImageUrl')) $('accountImageUrl').value = '';
  if ($('accountBgColor')) $('accountBgColor').value = '#eef2ff';
  if ($('accountBorderColor')) $('accountBorderColor').value = '#c7d2fe';
  clearFileInput('accountImage');
  syncAccountFormPreview();

  const title = document.querySelector('#modalAddAccount .modal-title');
  if (title) title.textContent = 'Añadir cuenta';

  const btnDelete = $('btnDeleteAccount');
  if (btnDelete) btnDelete.style.display = 'none';

  const btnSave = $('btnSaveAccount');
  if (btnSave) {
    btnSave.style.display = '';
    btnSave.innerHTML = '<i class="ph ph-check"></i> Guardar';
  }

  const allInputs = document.querySelectorAll(
    '#modalAddAccount input, #modalAddAccount select'
  );
  allInputs.forEach((i) => (i.disabled = false));

  state.editingAccountId = null;
  openModal('modalAddAccount');
}

export async function openEditAccountModal(accountId) {
  if (!accountId) return;

  try {
    const account = await api(`/accounts/${accountId}`);
    const form = $('accountForm');
    if (form) form.reset();

    const accountNameParts = String(account.name || '')
      .split('·')
      .map((part) => part.trim());
    const accountMainName = accountNameParts[0] || account.name || '';
    const accountSubtitle = accountNameParts.slice(1).join(' · ');

    if ($('accountName')) $('accountName').value = accountMainName;
    if ($('accountSubtitle')) $('accountSubtitle').value = accountSubtitle;
    if ($('accountType')) $('accountType').value = account.type || 'bank';
    if ($('accountBalance'))
      $('accountBalance').value = String(account.balance_inicial ?? 0);
    if ($('accountIcon')) $('accountIcon').value = account.icon || '';
    if ($('accountBgColor'))
      $('accountBgColor').value = account.bg_color || '#eef2ff';
    if ($('accountBorderColor'))
      $('accountBorderColor').value = account.border_color || '#c7d2fe';
    accountFormImageData = account.image_data || null;
    if ($('accountImageUrl')) {
      $('accountImageUrl').value =
        account.image_data && /^https?:\/\//i.test(account.image_data)
          ? account.image_data
          : '';
    }
    clearFileInput('accountImage');
    syncAccountFormPreview();

    const title = document.querySelector('#modalAddAccount .modal-title');
    if (title) title.textContent = 'Editar cuenta';

    const btnSave = $('btnSaveAccount');
    if (btnSave)
      btnSave.innerHTML = '<i class="ph ph-check"></i> Guardar cambios';

    const btnDelete = $('btnDeleteAccount');
    if (btnDelete) {
      btnDelete.style.display = '';
      btnDelete.onclick = async () => {
        if (
          confirm(
            `¿Eliminar la cuenta "${account.name}"? No podrás recuperarla.`
          )
        ) {
          await deleteAccount(accountId);
          closeModal('modalAddAccount');
          if (
            state.currentViewId === 'account-detail' &&
            typeof switchViewCallback === 'function'
          ) {
            switchViewCallback('accounts', 'Cuentas');
          }
        }
      };
    }

    state.editingAccountId = accountId;
    openModal('modalAddAccount');
  } catch (err) {
    showAlert(
      'Error cargando cuenta para editar: ' + (err?.message || String(err)),
      'error'
    );
  }
}

export async function saveAccount() {
  const name = ($('accountName')?.value || '').trim();
  const subtitle = ($('accountSubtitle')?.value || '').trim();
  const type = $('accountType')?.value || 'bank';
  const balance = Number.parseFloat($('accountBalance')?.value || '0');
  const icon = ($('accountIcon')?.value || '').trim();
  const imageUrlInput = $('accountImageUrl')?.value || '';
  const rawBgColor = $('accountBgColor')?.value || '#eef2ff';
  const rawBorderColor = $('accountBorderColor')?.value || '#c7d2fe';

  if (!name) {
    showAlert('Introduce un nombre para la cuenta', 'error');
    return;
  }

  try {
    const composedName = subtitle ? `${name} · ${subtitle}` : name;
    const remoteImageUrl = normalizeRemoteImageUrl(imageUrlInput);
    const payload = {
      name: composedName,
      type,
      balance_inicial: balance,
      icon: icon || null,
      image_data: remoteImageUrl || accountFormImageData,
      bg_color: normalizeColorValue(rawBgColor) || '#eef2ff',
      border_color: normalizeColorValue(rawBorderColor) || '#c7d2fe'
    };

    if (state.editingAccountId) {
      await api(`/accounts/${state.editingAccountId}`, {
        method: 'PATCH',
        json: true,
        body: JSON.stringify(payload)
      });
    } else {
      await api('/accounts', {
        method: 'POST',
        json: true,
        body: JSON.stringify(payload)
      });
    }

    closeModal('modalAddAccount');
    await loadAccounts();
    if (
      state.editingAccountId &&
      state.currentAccountId === state.editingAccountId
    ) {
      await openViewAccount(state.editingAccountId);
    }
    state.editingAccountId = null;
  } catch (err) {
    showAlert(
      'Error guardando cuenta: ' + (err?.message || String(err)),
      'error'
    );
  }
}

export async function deleteAccount(accountId) {
  try {
    await api(`/accounts/${accountId}`, { method: 'DELETE' });
    await loadAccounts();
  } catch (err) {
    showAlert(
      'Error eliminando cuenta: ' + (err?.message || String(err)),
      'error'
    );
  }
}

export async function resetAccount(accountId, accountName = 'cuenta') {
  try {
    await api(`/accounts/${accountId}/reset`, { method: 'POST' });
    await loadAccounts();
    showAlert(`Cuenta "${accountName}" reiniciada`, 'success');
    return true;
  } catch (err) {
    showAlert(
      'Error reiniciando cuenta: ' + (err?.message || String(err)),
      'error'
    );
    return false;
  }
}

export async function confirmAndResetAccount(
  accountId,
  accountName = 'cuenta',
  reopenDetail = false
) {
  const ok = confirm(
    `¿Reiniciar la cuenta "${accountName}"? Se borrarán solo sus movimientos y su saldo inicial pasará a 0,00€.`
  );
  if (!ok) return;

  const confirmationText = prompt(
    'Para confirmar, escribe REINICIAR en mayúsculas:'
  );
  if (confirmationText !== 'REINICIAR') {
    showAlert('Operación cancelada. No se borró ningún dato.', 'error');
    return;
  }

  const done = await resetAccount(accountId, accountName);
  if (!done) return;

  if (reopenDetail) {
    await openViewAccount(accountId);
  }
}

export async function openViewAccount(accountId) {
  try {
    const originViewId =
      state.currentViewId && state.currentViewId !== 'account-detail'
        ? state.currentViewId
        : state.accountDetailOriginViewId || 'accounts';
    state.accountDetailOriginViewId = originViewId;

    const acc = await api(`/accounts/${accountId}`);
    if (!acc) throw new Error('Cuenta no encontrada');
    const detailCard = document.querySelector('.account-detail-card');

    const typeLabel =
      {
        bank: '🏦 Banco',
        cash: '💵 Efectivo',
        credit: '💳 Tarjeta crédito'
      }[acc.type] || acc.type;

    if ($('accountDetailType')) $('accountDetailType').textContent = typeLabel;
    const [detailName, detailSubtitle = 'Cuenta'] = String(acc.name || '')
      .split('·')
      .map((part) => part.trim())
      .filter(Boolean);
    if ($('accountDetailName'))
      $('accountDetailName').textContent = detailName || acc.name;
    if ($('accountDetailSubtitle')) {
      $('accountDetailSubtitle').textContent = detailSubtitle;
      $('accountDetailSubtitle').classList.toggle(
        'account-subtitle-muted',
        /ahorro|hucha/i.test(detailSubtitle)
      );
    }
    const balance = Number(acc.current_balance || 0).toFixed(2);
    if ($('accountDetailBalance'))
      $('accountDetailBalance').textContent = `${balance}€`;
    applyAccountTheme(detailCard, acc);
    const detailBadge = $('accountDetailBadge');
    if (detailBadge) detailBadge.innerHTML = getAccountBadgeMarkup(acc);

    await loadAccountTransactions(accountId);

    const btnDelete = $('btnDeleteAccountDetail');
    if (btnDelete) {
      btnDelete.onclick = async () => {
        if (
          confirm(`¿Eliminar la cuenta "${acc.name}"? No podrás recuperarla.`)
        ) {
          const confirmationText = prompt(
            'Para confirmar, escribe ELIMINAR en mayúsculas:'
          );
          if (confirmationText !== 'ELIMINAR') {
            showAlert('Operación cancelada. No se eliminó la cuenta.', 'error');
            return;
          }
          await deleteAccount(accountId);
          if (typeof switchViewCallback === 'function') {
            switchViewCallback('accounts', 'Cuentas');
          }
        }
      };
    }

    const btnEdit = $('btnEditAccountDetail');
    if (btnEdit) {
      btnEdit.onclick = async () => {
        await openEditAccountModal(accountId);
      };
    }

    const btnTransfer = $('btnTransferAccountDetail');
    if (btnTransfer) {
      btnTransfer.onclick = async () => {
        await openTransferModal(accountId);
      };
    }

    const btnReset = $('btnResetAccountDetail');
    if (btnReset) {
      btnReset.onclick = async () => {
        await confirmAndResetAccount(accountId, acc.name, true);
      };
    }

    state.currentAccountId = accountId;
    if (typeof switchViewCallback === 'function') {
      switchViewCallback('account-detail', acc.name);
    }
  } catch (err) {
    showAlert(
      'Error cargando cuenta: ' + (err?.message || String(err)),
      'error'
    );
  }
}

async function loadAccountTransactions(accountId) {
  try {
    // Consulta directa y eficiente al backend por account_id
    const filtered = await api(
      `/transactions?account_id=${encodeURIComponent(accountId)}&limit=1000`
    );
    const txList = $('accountTxList');
    if (!txList) return;

    state.currentAccountTransactions = annotateTransactionsWithRunningBalances(
      sortTransactionsByMostRecent(filtered || [])
    );

    if (!filtered || filtered.length === 0) {
      txList.innerHTML = `
        <div class="list-empty-state">
          <span class="list-empty-state__icon"><i class="ph ph-wallet"></i></span>
          <p class="list-empty-state__msg">No hay movimientos en esta cuenta.</p>
          <p class="list-empty-state__hint">Puedes añadir uno desde el botón + o transferir saldo.</p>
        </div>
      `;
      return;
    }

    const html = state.currentAccountTransactions
      .map((t) => renderTxItem(t, true, {}, getAccountBadgeMarkup))
      .join('');

    txList.innerHTML = html;
    txList.querySelectorAll('.tx-item').forEach((el) => {
      el.addEventListener('click', () => {
        openViewTx(el.dataset.id);
      });
    });
  } catch (err) {
    state.currentAccountTransactions = [];
    const txList = $('accountTxList');
    if (txList) {
      txList.innerHTML = `<div class="muted">Error cargando transacciones: ${escapeHtml(err?.message || String(err))}</div>`;
    }
  }
}

export function syncTransferFormState() {
  const btnSaveTransfer = $('btnSaveTransfer');
  const hint = $('transferValidationHint');
  const source = $('transferSourceAccount')?.value || '';
  const destination = $('transferDestinationAccount')?.value || '';
  const amountValue = $('transferAmount')?.value || '';
  const amount = Number.parseFloat(amountValue || '0');

  let message = 'Selecciona origen, destino e importe.';
  if (source && !destination) message = 'Selecciona la cuenta destino.';
  if (!source && destination) message = 'Selecciona la cuenta origen.';
  if (source && destination && source === destination) {
    message = 'Origen y destino deben ser distintos.';
  }
  if (
    source &&
    destination &&
    source !== destination &&
    amountValue &&
    amount <= 0
  ) {
    message = 'El importe debe ser mayor que cero.';
  }

  const isValid =
    Boolean(source) &&
    Boolean(destination) &&
    source !== destination &&
    Boolean(amountValue) &&
    amount > 0;

  if (hint) {
    hint.textContent = isValid ? 'Formulario listo para transferir.' : message;
  }
  if (btnSaveTransfer) {
    btnSaveTransfer.disabled = !isValid;
  }
  return isValid;
}

export async function populateTransferAccountSelects(sourceAccountId = null) {
  const sourceSel = $('transferSourceAccount');
  const destinationSel = $('transferDestinationAccount');
  if (!sourceSel || !destinationSel) return;

  try {
    let accounts = state.accounts || [];
    if (!accounts.length) {
      accounts = await api('/accounts');
      state.accounts = accounts;
    }
    accounts = getSortedAccounts(accounts);

    const currentSourceId = String(sourceAccountId || sourceSel.value || '');
    sourceSel.innerHTML = '<option value="">Cuenta origen</option>';
    destinationSel.innerHTML = '<option value="">Cuenta destino</option>';

    accounts.forEach((account) => {
      const sourceOption = document.createElement('option');
      sourceOption.value = account.id;
      sourceOption.textContent = account.name;
      sourceSel.appendChild(sourceOption);

      const destinationOption = document.createElement('option');
      destinationOption.value = account.id;
      destinationOption.textContent = account.name;
      destinationSel.appendChild(destinationOption);
    });

    if (currentSourceId) {
      sourceSel.value = currentSourceId;
      if (destinationSel.value === currentSourceId) destinationSel.value = '';
    }
    syncTransferFormState();
  } catch {}
}

export async function openTransferModal(sourceAccountId = null) {
  const form = $('transferForm');
  if (form) form.reset();
  await populateTransferAccountSelects(
    sourceAccountId || state.currentAccountId
  );
  syncTransferFormState();
  openModal('modalTransfer');
}

export async function saveTransfer() {
  if (!syncTransferFormState()) return;

  const source_account_id = $('transferSourceAccount')?.value || '';
  const destination_account_id = $('transferDestinationAccount')?.value || '';
  const amount = Number.parseFloat($('transferAmount')?.value || '0');
  const description = ($('transferDescription')?.value || '').trim();

  try {
    await api('/transfers', {
      method: 'POST',
      json: true,
      body: JSON.stringify({
        source_account_id,
        destination_account_id,
        amount,
        description: description || 'Transferencia entre cuentas',
        date: new Date().toISOString()
      })
    });

    closeModal('modalTransfer');
    await loadAccounts();
    if (state.currentViewId === 'account-detail' && state.currentAccountId) {
      await openViewAccount(state.currentAccountId);
    }
    showAlert('Transferencia registrada', 'success');
  } catch (err) {
    showAlert(
      'Error registrando transferencia: ' + (err?.message || String(err)),
      'error'
    );
  }
}

export function initAccountListeners() {
  const btnAddNewAccount = $('btnAddNewAccount');
  const btnAccountsTransfer = $('btnAccountsTransfer');
  const btnSaveAccount = $('btnSaveAccount');
  const btnSaveTransfer = $('btnSaveTransfer');
  const btnSwapTransferAccounts = $('btnSwapTransferAccounts');
  const btnDeleteAccount = $('btnDeleteAccount');
  const accountIcon = $('accountIcon');
  const accountImage = $('accountImage');
  const accountImageUrl = $('accountImageUrl');
  const btnClearAccountImage = $('btnClearAccountImage');
  const btnCloseAccount = document.querySelector(
    '#modalAddAccount .close-modal'
  );

  if (btnAddNewAccount)
    btnAddNewAccount.addEventListener('click', openAddAccountModal);
  if (btnAccountsTransfer)
    btnAccountsTransfer.addEventListener('click', () => openTransferModal());
  if (btnSaveAccount) btnSaveAccount.addEventListener('click', saveAccount);
  if (btnSaveTransfer) btnSaveTransfer.addEventListener('click', saveTransfer);
  if (btnSwapTransferAccounts) {
    btnSwapTransferAccounts.addEventListener('click', () => {
      const sourceSel = $('transferSourceAccount');
      const destinationSel = $('transferDestinationAccount');
      if (!sourceSel || !destinationSel) return;
      const temp = sourceSel.value;
      sourceSel.value = destinationSel.value;
      destinationSel.value = temp;
      syncTransferFormState();
    });
  }
  if (btnDeleteAccount)
    btnDeleteAccount.addEventListener('click', (e) => e.preventDefault());
  if (btnCloseAccount)
    btnCloseAccount.addEventListener('click', () =>
      closeModal('modalAddAccount')
    );

  const transferSourceAccount = $('transferSourceAccount');
  const transferDestinationAccount = $('transferDestinationAccount');
  const transferAmount = $('transferAmount');
  const transferDescription = $('transferDescription');

  if (transferSourceAccount) {
    transferSourceAccount.addEventListener('change', () => {
      const destinationSel = $('transferDestinationAccount');
      if (destinationSel?.value === transferSourceAccount.value) {
        destinationSel.value = '';
      }
      syncTransferFormState();
    });
  }
  if (transferDestinationAccount) {
    transferDestinationAccount.addEventListener(
      'change',
      syncTransferFormState
    );
  }
  if (transferAmount)
    transferAmount.addEventListener('input', syncTransferFormState);
  if (transferDescription)
    transferDescription.addEventListener('input', syncTransferFormState);

  if (accountIcon) {
    accountIcon.addEventListener('input', () => {
      if (accountFormImageData && accountIcon.value.trim()) {
        accountFormImageData = null;
        clearFileInput('accountImage');
        if (accountImageUrl) accountImageUrl.value = '';
      }
      syncAccountFormPreview();
    });
  }

  if (accountImageUrl) {
    const syncRemotePreview = () => {
      if (!accountImageUrl.value.trim()) {
        if (!accountFormImageData) syncAccountFormPreview();
        return;
      }
      try {
        accountFormImageData = normalizeRemoteImageUrl(accountImageUrl.value);
        if (accountIcon) accountIcon.value = '';
        clearFileInput('accountImage');
        syncAccountFormPreview();
      } catch {}
    };
    accountImageUrl.addEventListener('input', syncRemotePreview);
    accountImageUrl.addEventListener('blur', syncRemotePreview);
  }

  if (accountImage) {
    accountImage.addEventListener('change', async (event) => {
      const [file] = event.target.files || [];
      if (!file) {
        accountFormImageData = null;
        syncAccountFormPreview();
        return;
      }
      try {
        accountFormImageData = await readImageFileAsDataUrl(file);
        if (accountIcon) accountIcon.value = '';
        if (accountImageUrl) accountImageUrl.value = '';
        syncAccountFormPreview();
      } catch (err) {
        showAlert(err?.message || 'No se pudo cargar la imagen', 'error');
        accountFormImageData = null;
        clearFileInput('accountImage');
        syncAccountFormPreview();
      }
    });
  }

  if (btnClearAccountImage) {
    btnClearAccountImage.addEventListener('click', () => {
      accountFormImageData = null;
      clearFileInput('accountImage');
      if (accountImageUrl) accountImageUrl.value = '';
      syncAccountFormPreview();
    });
  }
}
