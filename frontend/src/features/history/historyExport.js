// js/features/history/historyExport.js
import { state } from '../../state/state.js';
import { showAlert } from '../../utils/toast.js';
import { findAccountForTransaction } from '../transactions/transactions.js';

export function exportHistoryToCSV(transactions, monthLabel) {
  if (!transactions.length) {
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
    const cat = state.catsById.get(tx.category_id);
    const sub = tx.subcategory_id
      ? state.catsById.get(tx.subcategory_id)
      : null;
    const account = findAccountForTransaction(tx);
    const date = new Date(tx.date).toLocaleDateString('es-ES');
    const type = tx.type === 'expense' ? 'Gasto' : 'Ingreso';
    const catName = cat?.name || tx.category_id || '';
    const subName = sub?.name || '';
    const accountName = account?.name || tx.account_id || '';
    const note = String(tx.note || '').replaceAll('"', '""');
    const amount = (tx.type === 'expense' ? -1 : 1) * Number(tx.amount || 0);
    return [
      date,
      type,
      catName,
      subName,
      accountName,
      `"${note}"`,
      amount.toFixed(2)
    ].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movimientos-${monthLabel || 'historial'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
