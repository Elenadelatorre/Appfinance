// src/utils/visuals.js
import {
  LEGACY_ICON_MAP,
  CATEGORY_NAME_ICON_MAP,
  CATEGORY_ICON_COLOR_MAP
} from '../config/constants.js';
import { $, escapeHtml } from '../features/ui/dom.js';

export function normalizeColorValue(value, fallback = '#94a3b8') {
  const input = String(value || '').trim();
  if (!input) return fallback;

  if (/^#[0-9a-f]{3}$/i.test(input)) {
    const r = input[1];
    const g = input[2];
    const b = input[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  if (/^#[0-9a-f]{6}$/i.test(input)) {
    return input.toLowerCase();
  }

  return input;
}

export function inferIconFromCategoryName(categoryName, fallbackIcon = '🧾') {
  const name = String(categoryName || '').trim();
  for (const [pattern, icon] of CATEGORY_NAME_ICON_MAP) {
    if (pattern.test(name)) return String(icon);
  }
  return String(fallbackIcon);
}

export function normalizeCategoryIcon(
  rawIcon,
  categoryName,
  fallbackIcon = '🧾'
) {
  const icon = String(rawIcon || '').trim();
  if (!icon) {
    return inferIconFromCategoryName(categoryName, fallbackIcon);
  }

  const normalized = icon.toLowerCase().replaceAll(/\s+/gu, '_');
  const fromLegacy = LEGACY_ICON_MAP[normalized];
  if (fromLegacy) {
    return String(fromLegacy);
  }

  if (/^[a-z0-9_-]+$/i.test(icon)) {
    return inferIconFromCategoryName(categoryName, fallbackIcon);
  }

  return icon;
}

export function inferColorFromCategory(category, fallbackColor = '#94a3b8') {
  const icon = normalizeCategoryIcon(category?.icon, category?.name, '🧾');
  const fromIcon = CATEGORY_ICON_COLOR_MAP[icon];
  if (fromIcon) return fromIcon;

  const name = String(category?.name || '')
    .trim()
    .toLowerCase();
  if (/ingreso|nomina|nómina|extra|interes|interés|venta/.test(name)) {
    return '#16a34a';
  }
  if (/ahorro|inversion|inversión/.test(name)) {
    return '#0f766e';
  }
  if (/traspas|transfer/.test(name)) {
    return '#0284c7';
  }
  return fallbackColor;
}

export function getCategoryVisual(
  category,
  fallbackIcon = '🧾',
  fallbackColor = '#94a3b8'
) {
  const resolvedColor = normalizeColorValue(
    category?.color,
    inferColorFromCategory(category, fallbackColor)
  );
  return {
    icon: normalizeCategoryIcon(category?.icon, category?.name, fallbackIcon),
    color: resolvedColor,
    imageData: category?.image_data || null,
    bgColor: category?.bg_color || '',
    borderColor: category?.border_color || '',
    name: category?.name || 'Sin categoría'
  };
}

export function getTransferVisual(categoryId) {
  if (categoryId === 'transfer_out') {
    return {
      icon: '🔁',
      color: '#2563eb',
      imageData: null,
      bgColor: '',
      borderColor: '',
      name: 'Traspaso enviado'
    };
  }
  if (categoryId === 'transfer_in') {
    return {
      icon: '🔁',
      color: '#0f766e',
      imageData: null,
      bgColor: '',
      borderColor: '',
      name: 'Traspaso recibido'
    };
  }
  return null;
}

export function hasCustomCategoryVisual(category) {
  if (!category || typeof category !== 'object') return false;
  const icon = String(category.icon || '').trim();
  const imageData = String(category.image_data || '').trim();
  return Boolean(icon || imageData);
}

export function buildCategoryVisualStyle(visual, includeColorToken = true) {
  const styles = [];
  if (includeColorToken && visual?.color) {
    styles.push(`--cat-color:${escapeHtml(visual.color)}`);
  }
  if (visual?.bgColor) {
    styles.push(`background:${escapeHtml(visual.bgColor)}`);
  }
  if (visual?.borderColor) {
    styles.push(`border-color:${escapeHtml(visual.borderColor)}`);
  }
  return styles.join(';');
}

export function renderCategoryVisualContent(
  visual,
  imageClass = 'visual-token-image'
) {
  if (visual?.imageData) {
    return `<img class="${escapeHtml(imageClass)}" src="${escapeHtml(visual.imageData)}" alt="${escapeHtml(visual.name)}" loading="lazy" decoding="async" />`;
  }
  return `<span>${escapeHtml(visual?.icon || '🧾')}</span>`;
}

export function buildVisualPreviewMarkup(imageData, icon, fallbackIcon = '🧾') {
  if (imageData) {
    return `<div class="visual-preview-card"><img class="visual-preview-image" src="${escapeHtml(imageData)}" alt="Vista previa" /></div>`;
  }
  const resolvedIcon = normalizeCategoryIcon(icon, '', fallbackIcon);
  return `<div class="visual-preview-card visual-preview-card--icon"><span>${escapeHtml(resolvedIcon)}</span></div>`;
}

export function renderVisualPreview(
  containerId,
  imageData,
  icon,
  fallbackIcon = '🧾'
) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = buildVisualPreviewMarkup(imageData, icon, fallbackIcon);
}

export function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      resolve(typeof result === 'string' ? result : '');
    };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

export function normalizeRemoteImageUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('La URL de la imagen debe empezar por http o https');
    }
    return parsed.toString();
  } catch {
    throw new Error('Introduce una URL de imagen válida');
  }
}
