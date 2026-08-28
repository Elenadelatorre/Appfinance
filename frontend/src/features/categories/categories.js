// src/features/categories/categories.js
import { state } from '../../state/state.js';
import { api } from '../../services/api.js';
import { $, escapeHtml, clearFileInput, setValueIfElement } from '../ui/dom.js';
import { showAlert } from '../../utils/toast.js';
import {
  getCategoryVisual,
  hasCustomCategoryVisual,
  inferIconFromCategoryName,
  normalizeColorValue,
  renderCategoryVisualContent,
  buildCategoryVisualStyle,
  renderVisualPreview,
  readImageFileAsDataUrl
} from '../../utils/visuals.js';
import {
  CATEGORY_ICON_GROUPS,
  CATEGORY_ICON_SET
} from '../../config/constants.js';

let categoryFormImageData = null;
let categoryBgColorOverridden = false;
let categoryDragState = null;

export function normalizeCategoryKeyPart(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('es-ES')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function dedupeCategoryTree(rawTree = []) {
  const mergedSections = new Map();
  for (const section of rawTree || []) {
    const sectionName = normalizeCategoryKeyPart(section?.section);
    const sectionId = String(section?.section_id || '').trim();
    const sectionKey = sectionName || sectionId;
    if (!sectionKey) continue;

    if (!mergedSections.has(sectionKey)) {
      mergedSections.set(sectionKey, {
        section: section?.section || 'Sin sección',
        section_id: sectionId,
        categories: []
      });
    }

    const targetSection = mergedSections.get(sectionKey);
    targetSection.categories.push(...(section?.categories || []));
  }

  return Array.from(mergedSections.values()).map((section) => {
    const seenParents = new Set();
    const dedupedParents = [];

    for (const category of section.categories || []) {
      const parentName = normalizeCategoryKeyPart(category?.name);
      if (!parentName) continue;

      const parentKey = `${section.section_id}|${parentName}`;
      if (seenParents.has(parentKey)) continue;
      seenParents.add(parentKey);

      const seenSubs = new Set();
      const dedupedSubs = [];
      for (const subcategory of category?.subcategories || []) {
        const subName = normalizeCategoryKeyPart(subcategory?.name);
        if (!subName) continue;

        const subKey = `${parentName}|${subName}`;
        if (seenSubs.has(subKey)) continue;
        seenSubs.add(subKey);
        dedupedSubs.push(subcategory);
      }

      dedupedParents.push({
        ...category,
        subcategories: dedupedSubs
      });
    }

    return {
      ...section,
      categories: dedupedParents
    };
  });
}

export function buildCategoryOption(category) {
  const visual = getCategoryVisual(category);
  const catId = String(category?.id || category?._id || '');
  const label = escapeHtml(visual.icon + ' ' + visual.name);
  return `<option value="${escapeHtml(catId)}">${label}</option>`;
}

export function buildSubcategoryOption(category, parentCategory = null) {
  const parentVisual = parentCategory
    ? getCategoryVisual(parentCategory)
    : null;
  const fallbackIcon = parentVisual?.icon || '•';
  const fallbackColor = parentVisual?.color || '#94a3b8';
  const hasCustomVisual = hasCustomCategoryVisual(category);
  const visual = hasCustomVisual
    ? getCategoryVisual(category, fallbackIcon, fallbackColor)
    : {
        ...getCategoryVisual(category, fallbackIcon, fallbackColor),
        icon: fallbackIcon
      };
  const catId = String(category?.id || category?._id || '');
  const label = escapeHtml(visual.icon + ' ' + visual.name);
  return `<option value="${escapeHtml(catId)}">${label}</option>`;
}

export function sortCategoriesByOrder(items = []) {
  return [...(items || [])].sort((a, b) => {
    const aOrder = Number.isInteger(a?.order)
      ? a.order
      : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isInteger(b?.order)
      ? b.order
      : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'es', {
      sensitivity: 'base'
    });
  });
}

export function getSectionOptions() {
  return (state.tree || [])
    .map(
      (section) =>
        `<option value="${escapeHtml(section.section_id)}">${escapeHtml(section.section)}</option>`
    )
    .join('');
}

export function getParentCategoryOptions(selectedParentId = '') {
  const parents = [];
  for (const section of state.tree || []) {
    for (const category of section.categories || []) {
      parents.push(category);
    }
  }

  return [
    '<option value="">Sin padre (categoría principal)</option>',
    ...parents.map((category) => {
      const catId = String(category?.id || category?._id || '');
      const visual = getCategoryVisual(category);
      const selected = String(selectedParentId) === catId ? ' selected' : '';
      const label = escapeHtml(visual.icon + ' ' + category.name);
      return `<option value="${escapeHtml(catId)}"${selected}>${label}</option>`;
    })
  ].join('');
}

export function getParentCategoryBackground(parentId, fallback = '#eef2ff') {
  if (!parentId) return fallback;
  const parentCategory = state.catsById.get(parentId);
  return normalizeColorValue(parentCategory?.bg_color, fallback);
}

export function syncSubcategoryBackgroundWithParent({ force = false } = {}) {
  const parentId = $('categoryFormParent')?.value || '';
  if (!parentId) return;
  if (!force && categoryBgColorOverridden) return;

  const bgInput = $('categoryFormBgColor');
  if (!bgInput) return;
  bgInput.value = getParentCategoryBackground(parentId, '#eef2ff');
}

export function renderCategoryIconPicker() {
  const picker = $('categoryIconPicker');
  if (!picker) return;

  const selected = ($('categoryFormIcon')?.value || '').trim();
  const groupedHtml = CATEGORY_ICON_GROUPS.map((group) => {
    const buttons = group.icons
      .map((icon) => {
        const isActive = selected === icon ? ' is-active' : '';
        return `
          <button class="icon-choice${isActive}" type="button" data-icon="${escapeHtml(icon)}" title="${escapeHtml(icon)}">
            <span>${escapeHtml(icon)}</span>
          </button>
        `;
      })
      .join('');

    return `
      <div class="icon-picker-group">
        <p class="icon-picker-group-title">${escapeHtml(group.label)}</p>
        <div class="icon-picker-grid">${buttons}</div>
      </div>
    `;
  }).join('');

  const customSelectedBlock =
    selected && !CATEGORY_ICON_SET.has(selected)
      ? `
      <div class="icon-picker-group">
        <p class="icon-picker-group-title">Personalizado</p>
        <div class="icon-picker-grid">
          <button class="icon-choice is-active" type="button" data-icon="${escapeHtml(selected)}" title="${escapeHtml(selected)}">
            <span>${escapeHtml(selected)}</span>
          </button>
        </div>
      </div>
    `
      : '';

  picker.innerHTML = `${customSelectedBlock}${groupedHtml}`;
}

export function syncCategoryIconSelection() {
  renderCategoryIconPicker();
}

function getCategoryFormTitle(isEditing, parentId) {
  if (isEditing && parentId) return 'Editar subcategoría';
  if (isEditing) return 'Editar categoría';
  if (parentId) return 'Nueva subcategoría';
  return 'Nueva categoría';
}

export function resetCategoryForm(defaults = {}) {
  state.editingCategoryId = defaults.id || null;
  categoryFormImageData = defaults.image_data || null;
  categoryBgColorOverridden = Boolean(defaults.preserveSubcategoryBackground);
  const title = $('categoryFormTitle');
  const name = $('categoryFormName');
  const icon = $('categoryFormIcon');
  const color = $('categoryFormColor');
  const bgColor = $('categoryFormBgColor');
  const borderColor = $('categoryFormBorderColor');
  const section = $('categoryFormSection');
  const parent = $('categoryFormParent');

  if (title) {
    title.textContent = getCategoryFormTitle(
      Boolean(state.editingCategoryId),
      defaults.parent_id
    );
  }

  if (section) {
    section.innerHTML = getSectionOptions();
    section.value = defaults.section_id || state.tree?.[0]?.section_id || '';
  }
  if (parent) {
    parent.innerHTML = getParentCategoryOptions(defaults.parent_id || '');
    parent.value = defaults.parent_id || '';
  }

  setValueIfElement(name, defaults.name || '');
  setValueIfElement(icon, defaults.icon || '');
  setValueIfElement(color, normalizeColorValue(defaults.color, '#4f46e5'));
  setValueIfElement(bgColor, normalizeColorValue(defaults.bg_color, '#eef2ff'));
  setValueIfElement(
    borderColor,
    normalizeColorValue(defaults.border_color, '#c7d2fe')
  );

  clearFileInput('categoryFormImage');
  renderVisualPreview(
    'categoryFormPreview',
    categoryFormImageData,
    defaults.icon || '',
    '🧾'
  );

  syncCategoryFormState();
  syncCategoryIconSelection();
}

export function syncCategoryFormState() {
  const section = $('categoryFormSection');
  const parent = $('categoryFormParent');
  const parentCategory = parent?.value
    ? state.catsById.get(parent.value)
    : null;
  if (section && parentCategory) {
    section.value = parentCategory.section_id;
    section.disabled = true;
    syncSubcategoryBackgroundWithParent();
  } else if (section) {
    section.disabled = false;
  }

  const iconInput = $('categoryFormIcon');
  const nameInput = $('categoryFormName');
  if (
    iconInput &&
    !iconInput.value &&
    !categoryFormImageData &&
    nameInput?.value
  ) {
    iconInput.value = inferIconFromCategoryName(nameInput.value, '🧾');
  }

  renderVisualPreview(
    'categoryFormPreview',
    categoryFormImageData,
    iconInput?.value || '',
    '🧾'
  );
  syncCategoryIconSelection();
}

export function showCategoryFormCard() {
  const card = $('categoryFormCard');
  if (card) {
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export function hideCategoryFormCard() {
  const card = $('categoryFormCard');
  if (card) card.style.display = 'none';
}

export function openNewCategoryForm() {
  resetCategoryForm({});
  showCategoryFormCard();
}

export function openNewSubcategoryForm(parentId = '') {
  const parentCategory = parentId ? state.catsById.get(parentId) : null;
  const parentVisual = getCategoryVisual(parentCategory, '🧾', '#94a3b8');
  resetCategoryForm({
    parent_id: parentId || '',
    section_id: parentCategory?.section_id || state.tree?.[0]?.section_id || '',
    color: parentVisual.color,
    bg_color: getParentCategoryBackground(parentId, '#eef2ff')
  });
  showCategoryFormCard();
}

export function openEditCategoryForm(categoryId) {
  const category = state.catsById.get(categoryId);
  if (!category) return;
  const parentCategory = category.parent_id
    ? state.catsById.get(category.parent_id)
    : null;
  const parentBackground = normalizeColorValue(parentCategory?.bg_color, '');
  const categoryBackground = normalizeColorValue(
    category.bg_color,
    parentBackground
  );
  const hasOwnBackground =
    category.parent_id && String(category.bg_color || '').trim().length > 0;
  resetCategoryForm({
    id: categoryId,
    name: category.name,
    icon: category.icon,
    color: category.color,
    image_data: category.image_data || null,
    bg_color: category.parent_id ? categoryBackground : category.bg_color || '',
    border_color: category.border_color || '',
    section_id: category.section_id,
    parent_id: category.parent_id || '',
    preserveSubcategoryBackground: hasOwnBackground
  });
  showCategoryFormCard();
}

export function renderCategoryManager() {
  const treeEl = $('categoriesTree');
  if (!treeEl) return;

  const html = (state.tree || [])
    .map((section) => {
      const categories = sortCategoriesByOrder(section.categories || [])
        .map((category) => {
          const catId = String(category._id || category.id || '');
          const visual = getCategoryVisual(category);
          const subs = sortCategoriesByOrder(category.subcategories || [])
            .map((subcategory) => {
              const subId = String(subcategory._id || subcategory.id || '');
              const subVisual = getCategoryVisual(
                subcategory,
                '•',
                visual.color
              );
              return `
                <div class="tree-subcat tree-row tree-row--draggable" draggable="true" data-id="${escapeHtml(subId)}" data-kind="subcategory" data-drag-group="parent:${escapeHtml(catId)}">
                  <div class="tree-row-main">
                    <span class="tree-drag-handle" aria-hidden="true" title="Arrastrar para ordenar">
                      <i class="ph ph-dots-six-vertical"></i>
                    </span>
                    <span class="tree-subcat-icon" style="${buildCategoryVisualStyle(subVisual)}">${renderCategoryVisualContent(subVisual, 'visual-token-image visual-token-image--tree')}</span>
                    <span>${escapeHtml(subcategory.name)}</span>
                  </div>
                  <div class="tree-row-actions">
                    <button class="mini-icon-btn" data-action="move-category-up" data-id="${escapeHtml(subId)}" type="button" title="Subir subcategoría">
                      <i class="ph ph-arrow-up"></i>
                    </button>
                    <button class="mini-icon-btn" data-action="move-category-down" data-id="${escapeHtml(subId)}" type="button" title="Bajar subcategoría">
                      <i class="ph ph-arrow-down"></i>
                    </button>
                    <button class="mini-icon-btn" data-action="edit-category" data-id="${escapeHtml(subId)}" type="button" title="Editar subcategoría">
                      <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="mini-icon-btn danger" data-action="delete-category" data-id="${escapeHtml(subId)}" type="button" title="Eliminar subcategoría">
                      <i class="ph ph-trash"></i>
                    </button>
                  </div>
                </div>
              `;
            })
            .join('');

          return `
            <div class="tree-cat-card tree-row tree-row--draggable" draggable="true" data-id="${escapeHtml(catId)}" data-kind="category" data-drag-group="section:${escapeHtml(section.section_id)}">
              <div class="tree-cat-header">
                <div class="tree-row-main">
                  <span class="tree-drag-handle" aria-hidden="true" title="Arrastrar para ordenar">
                    <i class="ph ph-dots-six-vertical"></i>
                  </span>
                  <div class="tree-cat-icon" style="${buildCategoryVisualStyle(visual)}">${renderCategoryVisualContent(visual, 'visual-token-image visual-token-image--tree')}</div>
                  <div>
                    <div class="tree-cat-name">${escapeHtml(category.name)}</div>
                    <div class="tree-cat-meta">${escapeHtml(section.section)}</div>
                  </div>
                </div>
                <div class="tree-row-actions">
                  <button class="mini-icon-btn" data-action="move-category-up" data-id="${escapeHtml(catId)}" type="button" title="Subir categoría">
                    <i class="ph ph-arrow-up"></i>
                  </button>
                  <button class="mini-icon-btn" data-action="move-category-down" data-id="${escapeHtml(catId)}" type="button" title="Bajar categoría">
                    <i class="ph ph-arrow-down"></i>
                  </button>
                  <button class="mini-icon-btn" data-action="add-subcategory" data-id="${escapeHtml(catId)}" type="button" title="Añadir subcategoría">
                    <i class="ph ph-plus"></i>
                  </button>
                  <button class="mini-icon-btn" data-action="edit-category" data-id="${escapeHtml(catId)}" type="button" title="Editar categoría">
                    <i class="ph ph-pencil-simple"></i>
                  </button>
                  <button class="mini-icon-btn danger" data-action="delete-category" data-id="${escapeHtml(catId)}" type="button" title="Eliminar categoría">
                    <i class="ph ph-trash"></i>
                  </button>
                </div>
              </div>
              ${subs ? `<div class="tree-subcats">${subs}</div>` : ''}
            </div>
          `;
        })
        .join('');

      return `
        <div class="tree-section">
          <h4 class="tree-section-title">${escapeHtml(section.section)}</h4>
          <div class="tree-cats">${categories || '<div class="muted">Sin categorías</div>'}</div>
        </div>
      `;
    })
    .join('');

  treeEl.innerHTML =
    html || '<div class="muted">No hay categorías disponibles.</div>';
}

export function updateCategoriesForType() {
  const type = $('txType')?.value || 'expense';
  const categoryMap = {
    expense: ['Gastos', 'Ahorro e Inversión'],
    income: ['Ingresos', 'Ahorro e Inversión']
  };

  const allowedSections = categoryMap[type] || [];
  const flatCats = [];

  for (const section of state.tree || []) {
    const sectionName = section.section || '';
    if (
      allowedSections.some(
        (allowed) => allowed.toLowerCase() === sectionName.toLowerCase()
      )
    ) {
      for (const cat of section.categories || []) {
        flatCats.push(cat);
      }
    }
  }

  // Si no hubiera coincidencia por nombre de sección, cargar todas como fallback seguro
  const sourceCats =
    flatCats.length > 0
      ? flatCats
      : (state.tree || []).flatMap((s) => s.categories || []);

  // Ordenar alfabéticamente por nombre
  const sortedCats = [...sourceCats].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'es-ES', {
      sensitivity: 'base'
    })
  );

  const catSel = $('txCategory');
  if (catSel) {
    catSel.innerHTML =
      `<option value="">Seleccionar Categoría</option>` +
      sortedCats.map((c) => buildCategoryOption(c)).join('');
    catSel.value = '';
  }

  const subSel = $('txSubcategory');
  if (subSel) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
  }
}

export function onCategoryChange() {
  const catId = $('txCategory')?.value;
  const subSel = $('txSubcategory');
  if (!subSel) return;

  if (!catId) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
    return;
  }

  const parent = state.catsById.get(catId);
  const subs = parent?.subcategories || [];

  if (!subs.length) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
    return;
  }

  // Ordenar subcategorías alfabéticamente por nombre
  const sortedSubs = [...subs].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'es-ES', {
      sensitivity: 'base'
    })
  );

  subSel.disabled = false;
  subSel.innerHTML =
    `<option value="">(Opcional) Subcategoría</option>` +
    sortedSubs.map((sc) => buildSubcategoryOption(sc, parent)).join('');
}

export async function loadCategoryTree() {
  const rawTree = await api('/categories/tree');
  const tree = Array.isArray(rawTree) ? rawTree : [];
  state.tree = dedupeCategoryTree(tree);

  state.catsById = new Map();
  for (const section of state.tree) {
    for (const cat of section.categories || []) {
      const parentId = String(cat._id || cat.id || '');
      if (parentId) state.catsById.set(parentId, cat);
      if (cat._id) state.catsById.set(String(cat._id), cat);
      if (cat.id) state.catsById.set(String(cat.id), cat);

      for (const sc of cat.subcategories || []) {
        const subId = String(sc._id || sc.id || '');
        if (subId) state.catsById.set(subId, sc);
        if (sc._id) state.catsById.set(String(sc._id), sc);
        if (sc.id) state.catsById.set(String(sc.id), sc);
      }
    }
  }

  updateCategoriesForType();
  renderCategoryManager();

  const subSel = $('txSubcategory');
  if (subSel) {
    subSel.innerHTML = `<option value="">(Opcional) Subcategoría</option>`;
    subSel.disabled = true;
  }
}

export async function ensureCategoriesLoaded() {
  if (
    Array.isArray(state.tree) &&
    state.tree.length > 0 &&
    state.catsById?.size > 0
  )
    return;
  await loadCategoryTree();
}

export async function saveCategoryForm() {
  const name = ($('categoryFormName')?.value || '').trim();
  const icon = ($('categoryFormIcon')?.value || '').trim();
  const rawColor = $('categoryFormColor')?.value || '#4f46e5';
  const bgInput = $('categoryFormBgColor');
  const rawBgColor = bgInput?.value || '#eef2ff';
  const rawBorderColor = $('categoryFormBorderColor')?.value || '#c7d2fe';
  const section_id = $('categoryFormSection')?.value || '';
  const parent_id = $('categoryFormParent')?.value || null;

  const color = normalizeColorValue(rawColor, '#4f46e5');
  const bg_color = normalizeColorValue(rawBgColor, '#eef2ff');
  const border_color = normalizeColorValue(rawBorderColor, '#c7d2fe');

  const inheritedBgColor = parent_id
    ? getParentCategoryBackground(parent_id, '')
    : bg_color;
  const isCreatingSubcategory = !state.editingCategoryId && Boolean(parent_id);
  const parentVisualColor = parent_id
    ? getCategoryVisual(state.catsById.get(parent_id), '🧾', '#94a3b8').color
    : color;

  if (!name) {
    showAlert('Introduce un nombre para la categoría', 'error');
    return;
  }
  if (!section_id) {
    showAlert('Selecciona una sección', 'error');
    return;
  }

  const resolvedBgColor =
    isCreatingSubcategory || (parent_id && !categoryBgColorOverridden)
      ? inheritedBgColor
      : bg_color;
  const resolvedColor = isCreatingSubcategory ? parentVisualColor : color;
  const resolvedIcon = icon || inferIconFromCategoryName(name, '🧾');

  const payload = {
    name,
    icon: resolvedIcon,
    color: normalizeColorValue(resolvedColor, '#4f46e5'),
    image_data: categoryFormImageData,
    bg_color: normalizeColorValue(resolvedBgColor, '#eef2ff'),
    border_color: normalizeColorValue(border_color, '#c7d2fe'),
    section_id,
    parent_id,
    order: 0
  };

  try {
    if (state.editingCategoryId) {
      await api(`/categories/${state.editingCategoryId}`, {
        method: 'PATCH',
        json: true,
        body: JSON.stringify(payload)
      });
    } else {
      await api('/categories', {
        method: 'POST',
        json: true,
        body: JSON.stringify(payload)
      });
    }

    hideCategoryFormCard();
    resetCategoryForm({});
    await loadCategoryTree();
  } catch (err) {
    showAlert(
      'Error guardando categoría: ' + (err?.message || String(err)),
      'error'
    );
  }
}

export async function deleteCategoryItem(categoryId) {
  if (!confirm('¿Eliminar esta categoría o subcategoría?')) return;
  try {
    await api(`/categories/${categoryId}`, { method: 'DELETE' });
    if (state.editingCategoryId === categoryId) {
      hideCategoryFormCard();
      resetCategoryForm({});
    }
    await loadCategoryTree();
  } catch (err) {
    showAlert(
      'Error eliminando categoría: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function getCategorySiblingsInfo(categoryId) {
  const id = String(categoryId || '');
  if (!id) return null;

  for (const section of state.tree || []) {
    const categories = sortCategoriesByOrder(section.categories || []);
    const categoryIndex = categories.findIndex(
      (item) => String(item?._id || item?.id || '') === id
    );
    if (categoryIndex >= 0) {
      return { siblings: categories, index: categoryIndex };
    }

    for (const category of categories) {
      const subcategories = sortCategoriesByOrder(category.subcategories || []);
      const subIndex = subcategories.findIndex(
        (item) => String(item?._id || item?.id || '') === id
      );
      if (subIndex >= 0) {
        return { siblings: subcategories, index: subIndex };
      }
    }
  }
  return null;
}

function getCategorySiblingContext(categoryId) {
  const id = String(categoryId || '');
  if (!id) return null;

  for (const section of state.tree || []) {
    const categories = sortCategoriesByOrder(section.categories || []);
    const categoryIndex = categories.findIndex(
      (item) => String(item?._id || item?.id || '') === id
    );
    if (categoryIndex >= 0) {
      return {
        siblings: categories,
        index: categoryIndex,
        kind: 'category',
        group: `section:${section.section_id}`
      };
    }

    for (const category of categories) {
      const subcategories = sortCategoriesByOrder(category.subcategories || []);
      const subIndex = subcategories.findIndex(
        (item) => String(item?._id || item?.id || '') === id
      );
      if (subIndex >= 0) {
        return {
          siblings: subcategories,
          index: subIndex,
          kind: 'subcategory',
          group: `parent:${category._id || category.id}`
        };
      }
    }
  }
  return null;
}

async function persistCategorySiblingOrder(siblings = []) {
  const updates = siblings
    .map((item, index) => {
      const itemId = String(item?._id || item?.id || '');
      if (!itemId || item?.order === index) return null;
      return api(`/categories/${itemId}`, {
        method: 'PATCH',
        json: true,
        body: JSON.stringify({ order: index })
      });
    })
    .filter(Boolean);

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

export async function moveCategoryItem(categoryId, direction) {
  const info = getCategorySiblingsInfo(categoryId);
  if (!info) {
    showAlert('No se pudo localizar la categoría para mover', 'error');
    return;
  }

  const step = direction === 'up' ? -1 : 1;
  const targetIndex = info.index + step;
  if (targetIndex < 0 || targetIndex >= info.siblings.length) return;

  const reordered = [...info.siblings];
  const [moved] = reordered.splice(info.index, 1);
  reordered.splice(targetIndex, 0, moved);

  try {
    await persistCategorySiblingOrder(reordered);
    await loadCategoryTree();
    showAlert('Orden actualizado', 'info');
  } catch (err) {
    showAlert(
      'No se pudo actualizar el orden: ' + (err?.message || String(err)),
      'error'
    );
  }
}

function clearCategoryDragStyles() {
  document
    .querySelectorAll(
      '#categoriesTree .is-dragging, #categoriesTree .is-drop-target-before, #categoriesTree .is-drop-target-after'
    )
    .forEach((element) => {
      element.classList.remove(
        'is-dragging',
        'is-drop-target-before',
        'is-drop-target-after'
      );
    });
}

function getDragPlacement(targetElement, clientY) {
  const rect = targetElement.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  return clientY > midY ? 'after' : 'before';
}

async function moveCategoryItemByDrop(draggedId, targetId, placement) {
  const draggedContext = getCategorySiblingContext(draggedId);
  const targetContext = getCategorySiblingContext(targetId);
  if (!draggedContext || !targetContext) return;
  if (
    draggedContext.kind !== targetContext.kind ||
    draggedContext.group !== targetContext.group
  )
    return;

  const reordered = [...draggedContext.siblings];
  const draggedIndex = reordered.findIndex(
    (item) => String(item?._id || item?.id || '') === String(draggedId)
  );
  if (draggedIndex < 0) return;

  const [draggedItem] = reordered.splice(draggedIndex, 1);
  const targetIndex = reordered.findIndex(
    (item) => String(item?._id || item?.id || '') === String(targetId)
  );
  if (targetIndex < 0) return;

  const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
  reordered.splice(insertIndex, 0, draggedItem);

  await persistCategorySiblingOrder(reordered);
  await loadCategoryTree();
  showAlert('Orden actualizado', 'info');
}

export function initCategoryListeners() {
  const btnNewCategory = $('btnNewCategory');
  const btnNewSubcategory = $('btnNewSubcategory');
  const btnSaveCategory = $('btnSaveCategory');
  const btnCancelCategory = $('btnCancelCategory');
  const btnClearCategoryImage = $('btnClearCategoryImage');
  const categoryParent = $('categoryFormParent');
  const categoryName = $('categoryFormName');
  const categoryIcon = $('categoryFormIcon');
  const categoryBgColor = $('categoryFormBgColor');
  const categoryImage = $('categoryFormImage');
  const categoryIconPicker = $('categoryIconPicker');
  const categoriesTree = $('categoriesTree');
  const catSel = $('txCategory');
  const typeSel = $('txType');

  if (btnNewCategory)
    btnNewCategory.addEventListener('click', openNewCategoryForm);
  if (btnNewSubcategory)
    btnNewSubcategory.addEventListener('click', () => openNewSubcategoryForm());
  if (btnSaveCategory)
    btnSaveCategory.addEventListener('click', saveCategoryForm);
  if (btnCancelCategory)
    btnCancelCategory.addEventListener('click', () => {
      hideCategoryFormCard();
      resetCategoryForm({});
    });
  if (btnClearCategoryImage)
    btnClearCategoryImage.addEventListener('click', () => {
      categoryFormImageData = null;
      clearFileInput('categoryFormImage');
      syncCategoryFormState();
    });
  if (categoryParent)
    categoryParent.addEventListener('change', () => {
      syncCategoryFormState();
    });
  if (categoryName) {
    categoryName.addEventListener('blur', () => {
      const iconInput = $('categoryFormIcon');
      if (iconInput && !iconInput.value.trim() && !categoryFormImageData) {
        iconInput.value = inferIconFromCategoryName(categoryName.value, '🧾');
        syncCategoryIconSelection();
      }
    });
    categoryName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveCategoryForm();
    });
  }
  if (categoryIcon)
    categoryIcon.addEventListener('input', syncCategoryFormState);
  if (categoryBgColor)
    categoryBgColor.addEventListener('input', () => {
      categoryBgColorOverridden = true;
    });
  if (categoryImage)
    categoryImage.addEventListener('change', async () => {
      const file = categoryImage.files?.[0];
      if (!file) return;
      try {
        categoryFormImageData = await readImageFileAsDataUrl(file);
        syncCategoryFormState();
      } catch (err) {
        showAlert(err?.message || 'No se pudo cargar la imagen', 'error');
      }
    });
  if (categoryIconPicker)
    categoryIconPicker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-icon]');
      if (!button) return;
      const icon = button.dataset.icon || '';
      const iconInput = $('categoryFormIcon');
      if (iconInput) {
        iconInput.value = icon;
        syncCategoryFormState();
      }
    });

  if (categoriesTree) {
    categoriesTree.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const categoryId = button.dataset.id;
      if (!categoryId) return;

      if (action === 'edit-category') openEditCategoryForm(categoryId);
      else if (action === 'delete-category') deleteCategoryItem(categoryId);
      else if (action === 'add-subcategory') openNewSubcategoryForm(categoryId);
      else if (action === 'move-category-up')
        moveCategoryItem(categoryId, 'up');
      else if (action === 'move-category-down')
        moveCategoryItem(categoryId, 'down');
    });

    categoriesTree.addEventListener('dragstart', (event) => {
      const row = event.target.closest(
        '[draggable="true"][data-id][data-kind]'
      );
      if (!row || event.target.closest('.tree-row-actions')) {
        event.preventDefault();
        return;
      }
      categoryDragState = {
        id: row.dataset.id || '',
        kind: row.dataset.kind || '',
        group: row.dataset.dragGroup || ''
      };
      row.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', categoryDragState.id);
      }
    });

    categoriesTree.addEventListener('dragover', (event) => {
      const row = event.target.closest(
        '[draggable="true"][data-id][data-kind]'
      );
      if (!row || !categoryDragState) return;
      if (
        row.dataset.id === categoryDragState.id ||
        row.dataset.kind !== categoryDragState.kind ||
        row.dataset.dragGroup !== categoryDragState.group
      )
        return;

      event.preventDefault();
      const placement = getDragPlacement(row, event.clientY);
      clearCategoryDragStyles();
      row.classList.add(
        placement === 'after' ? 'is-drop-target-after' : 'is-drop-target-before'
      );
    });

    categoriesTree.addEventListener('drop', async (event) => {
      const row = event.target.closest(
        '[draggable="true"][data-id][data-kind]'
      );
      if (!row || !categoryDragState) return;
      if (
        row.dataset.id === categoryDragState.id ||
        row.dataset.kind !== categoryDragState.kind ||
        row.dataset.dragGroup !== categoryDragState.group
      )
        return;

      event.preventDefault();
      const draggedId = categoryDragState.id;
      const targetId = row.dataset.id || '';
      const placement = getDragPlacement(row, event.clientY);
      clearCategoryDragStyles();
      categoryDragState = null;

      try {
        await moveCategoryItemByDrop(draggedId, targetId, placement);
      } catch (err) {
        showAlert(
          'No se pudo actualizar el orden: ' + (err?.message || String(err)),
          'error'
        );
      }
    });

    categoriesTree.addEventListener('dragend', () => {
      categoryDragState = null;
      clearCategoryDragStyles();
    });
  }

  if (catSel) catSel.addEventListener('change', onCategoryChange);
  if (typeSel) typeSel.addEventListener('change', updateCategoriesForType);
}
