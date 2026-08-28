// src/features/history/historyExport.js
import { state } from '../../state/state.js';
import { showAlert } from '../../utils/toast.js';
import { findAccountForTransaction } from '../transactions/transactions.js';

function escapeCsvField(field) {
  const str = String(field ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function exportHistoryToCSV(transactions = [], monthLabel = '') {
  if (!Array.isArray(transactions) || !transactions.length) {
    showAlert('No hay movimientos para exportar', 'error');
    return;
  }

  const headers = [
    'Fecha',
    'Tipo',
    'Categoría',
    'Subcategoría',
    'Cuenta',
    'Nota',
    'Importe'
  ];

  const rows = transactions.map((tx) => {
    const cat = state.catsById?.get(tx.category_id);
    const sub = tx.subcategory_id
      ? state.catsById?.get(tx.subcategory_id)
      : null;
    const account = findAccountForTransaction(tx);
    const date = tx.date
      ? new Date(tx.date).toLocaleDateString('es-ES')
      : '';
    const type = tx.type === 'expense' ? 'Gasto' : 'Ingreso';
    const catName = cat?.name || tx.category_id || '';
    const subName = sub?.name || '';
    const accountName = account?.name || tx.account_id || '';
    const note = tx.note || '';
    const amount = (tx.type === 'expense' ? -1 : 1) * Number(tx.amount || 0);

    return [
      escapeCsvField(date),
      escapeCsvField(type),
      escapeCsvField(catName),
      escapeCsvField(subName),
      escapeCsvField(accountName),
      escapeCsvField(note),
      amount.toFixed(2)
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csvContent], {
    type: 'text/csv;charset=utf-8;'
  });

  const cleanLabel = String(monthLabel || 'historial')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/gi, '-');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movimientos-${cleanLabel}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}