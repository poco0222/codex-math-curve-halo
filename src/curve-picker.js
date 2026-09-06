import { curveFamilies, curveProfiles, getCurveAnimationSettings, getCurveFamily, getCurveProfile, sampleCurve } from './curves.js';
import { createHaloRenderer } from './halo.js';
import { getCurveLabel, getText } from './i18n.js';

const PREVIEW_COLOR = '#CFD6DF';

export function drawCurveThumbnail(canvas, id, settings) {
  const context = canvas.getContext('2d');
  context.setTransform(canvas.width / 110, 0, 0, canvas.height / 110, canvas.width / 22, canvas.height / 22);
  context.clearRect(-5, -5, 110, 110);
  context.beginPath();
  // Use the full domain at a fixed detail phase; open curves keep both endpoints.
  sampleCurve(getCurveProfile(id), 0, 1, settings).forEach(({ x, y }, index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = PREVIEW_COLOR;
  context.lineWidth = 1.65;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
}

export function createCurveSelection({ store, changeCurve, save, onChange = () => {} }) {
  const selection = {
    get pending() { return store.getUiState().curveApplying === true; },
    get error() { return store.getUiState().curveApplyError === true; },
    async apply(id) {
      if (selection.pending || !curveProfiles.some((curve) => curve.id === id)) return { ok: false };
      if (id === store.getSettings().curve_id && !selection.error) return { ok: true, unchanged: true };
      return persist(id);
    },
    retry() { return selection.pending ? Promise.resolve({ ok: false }) : persist(); },
  };

  async function persist(id) {
    store.setUi({ curveApplying: true, curveApplyError: false });
    onChange();
    let result;
    try {
      if (id && id !== store.getSettings().curve_id) changeCurve(id);
      result = await save();
    } catch {
      result = { ok: false };
    }
    // Completion changes feedback only. Settings may have received a newer event.
    store.setUi({ curveApplying: false, curveApplyError: !result?.ok });
    onChange();
    return result;
  }

  return selection;
}

export function createCurvePicker({ root, store, selection, isReady }) {
  const openButton = root.querySelector?.('#curve-picker-open');
  if (!openButton) return null;
  const document = root.ownerDocument;
  const dialog = root.querySelector('#curve-picker-dialog');
  const grid = root.querySelector('#curve-picker-grid');
  const familyGrid = root.querySelector('#curve-picker-families');
  const variantsHeading = root.querySelector('#curve-picker-variants-heading');
  const closeButton = root.querySelector('#curve-picker-close');
  const retryButton = root.querySelector('#curve-picker-retry');
  const status = root.querySelector('#curve-picker-status');
  const currentCanvas = root.querySelector('#curve-picker-current');
  const currentName = root.querySelector('#curve-picker-name');
  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const previewCanvas = document.createElement('canvas');
  previewCanvas.id = 'curve-picker-preview';
  previewCanvas.setAttribute('aria-hidden', 'true');
  let renderer;
  let activeButton;
  let session = 0;
  let destroyed = false;
  let listening = false;
  let browsingFamilyId = getCurveFamily(store.getSettings().curve_id).id;
  const familyButtons = curveFamilies.map((family) => {
    const single = family.profileIds.length === 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'curve-picker-family';
    button.dataset.familyId = family.id;
    if (single) button.dataset.curveId = family.profileIds[0];
    button.tabIndex = family.id === browsingFamilyId ? 0 : -1;
    const picture = document.createElement('span');
    picture.className = 'curve-picker-picture';
    const canvas = document.createElement('canvas');
    canvas.className = 'curve-picker-family-thumbnail curve-picker-thumbnail';
    canvas.width = 160;
    canvas.height = 160;
    canvas.setAttribute('aria-hidden', 'true');
    drawCurveThumbnail(canvas, family.profileIds[0]);
    const name = document.createElement('span');
    name.className = 'curve-picker-family-name';
    const count = document.createElement('span');
    count.className = 'curve-picker-family-count';
    picture.append(canvas);
    button.append(picture, name, count);
    button.addEventListener('pointerenter', () => { if (single) preview(button); else stopPreview(); });
    button.addEventListener('pointerleave', () => { if (activeButton === button) stopPreview(); });
    button.addEventListener('focus', () => {
      for (const item of familyButtons) item.tabIndex = item === button ? 0 : -1;
      if (single) preview(button);
      else stopPreview();
    });
    button.addEventListener('blur', () => { if (activeButton === button) stopPreview(); });
    button.addEventListener('click', () => {
      if (single && selection.pending) return;
      stopPreview();
      browsingFamilyId = family.id;
      render();
      if (single) submit(() => selection.apply(family.profileIds[0]));
    });
    return button;
  });
  familyGrid.replaceChildren(...familyButtons);
  const buttons = curveProfiles.map((curve) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'curve-picker-item';
    button.dataset.curveId = curve.id;
    button.tabIndex = -1;
    const picture = document.createElement('span');
    picture.className = 'curve-picker-picture';
    const canvas = document.createElement('canvas');
    canvas.className = 'curve-picker-thumbnail';
    canvas.width = 200;
    canvas.height = 200;
    canvas.setAttribute('aria-hidden', 'true');
    drawCurveThumbnail(canvas, curve.id);
    const name = document.createElement('span');
    name.className = 'curve-picker-label';
    const current = document.createElement('span');
    current.className = 'curve-picker-current-label';
    current.setAttribute('aria-hidden', 'true');
    picture.append(canvas);
    button.append(picture, name, current);
    button.addEventListener('pointerenter', () => preview(button));
    button.addEventListener('pointerleave', () => { if (activeButton === button) stopPreview(); });
    button.addEventListener('focus', () => {
      for (const item of buttons) item.tabIndex = item === button ? 0 : -1;
      preview(button);
    });
    button.addEventListener('blur', () => { if (activeButton === button) stopPreview(); });
    button.addEventListener('click', () => submit(() => selection.apply(curve.id)));
    return button;
  });
  grid.replaceChildren(...buttons);

  function stopPreview() {
    renderer?.stop();
    activeButton?.classList.remove('is-previewing');
    activeButton = null;
    previewCanvas.remove();
  }

  function preview(button) {
    stopPreview();
    if (button.hidden || !dialog.open || destroyed || document.hidden || media?.matches || selection.pending) return;
    startListening();
    const settings = store.getSettings();
    const id = button.dataset.curveId;
    button.querySelector('.curve-picker-picture').append(previewCanvas);
    const previewSettings = {
      ...(id === settings.curve_id ? settings : { ...getCurveAnimationSettings(id), curve_parameters: {} }),
      enabled: true,
      opacity: 1,
      idle_color: PREVIEW_COLOR,
    };
    renderer ??= createHaloRenderer(previewCanvas, { curve: id, state: 'idle', phaseOffset: 0 });
    renderer.setCurve(id);
    renderer.setSettings(previewSettings);
    previewCanvas.getContext('2d').clearRect(0, 0, 100, 100);
    activeButton = button;
    button.classList.add('is-previewing');
    renderer.start();
  }

  function suspendPreview() {
    if (document.hidden || media?.matches) stopPreview();
    if (document.hidden) stopListening();
  }

  function startListening() {
    if (listening || document.hidden) return;
    document.addEventListener('visibilitychange', suspendPreview);
    media?.addEventListener?.('change', suspendPreview);
    listening = true;
  }

  function stopListening() {
    if (!listening) return;
    document.removeEventListener('visibilitychange', suspendPreview);
    media?.removeEventListener?.('change', suspendPreview);
    listening = false;
  }

  function restoreFocus() {
    const target = !destroyed && openButton.isConnected
      ? openButton
      : document.querySelector('[data-view-target][aria-selected="true"]');
    target?.focus();
  }

  function close() {
    session += 1;
    stopPreview();
    stopListening();
    if (dialog.open) dialog.close();
    restoreFocus();
  }

  function render() {
    if (destroyed) return;
    const settings = store.getSettings();
    const language = settings.language;
    const currentFamily = getCurveFamily(settings.curve_id);
    const browsingFamily = curveFamilies.find(({ id }) => id === browsingFamilyId) ?? currentFamily;
    browsingFamilyId = browsingFamily.id;
    for (const [index, family] of curveFamilies.entries()) {
      const button = familyButtons[index];
      const single = family.profileIds.length === 1;
      const current = family.profileIds[0] === settings.curve_id;
      // Single cards apply a preset; multi-preset cards select the browsed family.
      button.setAttribute('aria-pressed', String(single ? current : family.id === browsingFamilyId));
      button.setAttribute('aria-disabled', String(single && selection.pending));
      button.querySelector('.curve-picker-family-name').textContent = getText(language, `settings.curveFamilies.${family.id}`);
      button.querySelector('.curve-picker-family-count').textContent = single
        ? getText(language, 'settings.useCurveDirect')
        : getText(language, 'settings.curveVariantCount').replace('{count}', family.profileIds.length);
      if (single) drawCurveThumbnail(button.querySelector('.curve-picker-thumbnail'), family.profileIds[0], current ? settings : undefined);
    }
    grid.hidden = variantsHeading.hidden = browsingFamily.profileIds.length === 1;
    variantsHeading.textContent = `${getText(language, `settings.curveFamilies.${browsingFamilyId}`)} · ${getText(language, 'settings.curveVariants')}`;
    currentName.textContent = `${getText(language, `settings.curveFamilies.${currentFamily.id}`)} · ${getCurveLabel(language, settings.curve_id)}`;
    drawCurveThumbnail(currentCanvas, settings.curve_id, settings);
    openButton.disabled = !isReady();
    openButton.setAttribute('aria-label', `${getText(language, 'settings.changeCurve')}: ${currentName.textContent}`);
    dialog.setAttribute('aria-busy', String(selection.pending));
    const visibleButtons = grid.hidden ? [] : buttons.filter((button) => browsingFamily.profileIds.includes(button.dataset.curveId));
    const focusedButton = visibleButtons.includes(document.activeElement) ? document.activeElement : null;
    const tabButton = focusedButton
      ?? visibleButtons.find((button) => button.dataset.curveId === settings.curve_id)
      ?? visibleButtons[0];
    for (const button of buttons) {
      const current = button.dataset.curveId === settings.curve_id;
      button.hidden = !visibleButtons.includes(button);
      button.tabIndex = button === tabButton ? 0 : -1;
      if (current || button.getAttribute('aria-pressed') === 'true') {
        drawCurveThumbnail(button.querySelector('.curve-picker-thumbnail'), button.dataset.curveId, current ? settings : undefined);
      }
      button.setAttribute('aria-pressed', String(current));
      button.setAttribute('aria-disabled', String(selection.pending));
      button.querySelector('.curve-picker-label').textContent = getCurveLabel(language, button.dataset.curveId);
      button.querySelector('.curve-picker-current-label').textContent = current ? getText(language, 'settings.currentCurve') : '';
    }
    status.textContent = selection.pending
      ? getText(language, 'settings.saveStatus.saving')
      : selection.error ? getText(language, 'settings.curveSaveFailed') : '';
    status.dataset.status = selection.error ? 'error' : '';
    if (!selection.error && document.activeElement === retryButton) closeButton.focus();
    retryButton.hidden = !selection.error;
    retryButton.disabled = selection.pending;
    if (selection.pending) stopPreview();
    else if (activeButton?.hidden) stopPreview();
    else if (activeButton) preview(activeButton);
  }

  async function submit(action) {
    if (selection.pending) return;
    const openedSession = session;
    stopPreview();
    const result = await action();
    if (destroyed || openedSession !== session || !dialog.open) return;
    render();
    if (result?.ok) close();
  }

  function open() {
    if (destroyed || dialog.open || !isReady()) return;
    session += 1;
    browsingFamilyId = getCurveFamily(store.getSettings().curve_id).id;
    for (const button of familyButtons) button.tabIndex = button.dataset.familyId === browsingFamilyId ? 0 : -1;
    render();
    startListening();
    dialog.showModal();
    const current = [...familyButtons, ...buttons].find((button) => button.dataset.curveId === store.getSettings().curve_id) ?? buttons[0];
    current.focus({ preventScroll: true });
    current.scrollIntoView({ block: 'nearest' });
  }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  retryButton.addEventListener('click', () => submit(() => selection.retry()));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    // A queued native close event may arrive after the same dialog reopened.
    if (dialog.open) return;
    stopPreview();
    stopListening();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) close();
  });
  dialog.addEventListener('keydown', (event) => {
    const visibleButtons = buttons.filter((button) => !button.hidden);
    const inFamilyGrid = familyButtons.includes(document.activeElement);
    const gridButtons = inFamilyGrid ? familyButtons : visibleButtons;
    const index = gridButtons.indexOf(document.activeElement);
    if (index >= 0) {
      const columns = globalThis.getComputedStyle(inFamilyGrid ? familyGrid : grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const next = {
        ArrowLeft: index - 1,
        ArrowRight: index + 1,
        ArrowUp: index - columns,
        ArrowDown: index + columns,
        Home: 0,
        End: gridButtons.length - 1,
      }[event.key];
      if (next !== undefined) {
        event.preventDefault();
        gridButtons[Math.max(0, Math.min(gridButtons.length - 1, next))].focus();
      }
    }
    if (event.key === 'Tab') {
      const focusable = [closeButton, ...familyButtons.filter((button) => button.tabIndex === 0), ...visibleButtons.filter((button) => button.tabIndex === 0), ...(!retryButton.hidden && !retryButton.disabled ? [retryButton] : [])];
      const current = focusable.indexOf(document.activeElement);
      const next = current < 0 ? (event.shiftKey ? focusable.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[next].focus();
    }
  });

  render();
  return {
    render,
    destroy() {
      const wasOpen = dialog.open;
      destroyed = true;
      session += 1;
      stopPreview();
      stopListening();
      if (wasOpen) { dialog.close(); restoreFocus(); }
      renderer = null;
    },
  };
}
