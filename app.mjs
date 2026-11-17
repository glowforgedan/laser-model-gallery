import { filterProducts, readSelection, selectionHash, toggleComparison, variantFor, formatBytes } from './library.mjs';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function mountGallery(document, products, options = {}) { return new GalleryApp(document, products, options); }
class GalleryApp {
  constructor(document, products, { loadViewer = () => import("./viewer.mjs") }) {
    this.document = document;
    this.products = products;
    this.loadViewer = loadViewer;
    this.window = document.defaultView;
    this.$ = selector => document.querySelector(selector);
    this.dialog = this.$('#model-dialog');
    this.grid = this.$('#grid');
    this.comparison = [];
    this.selection = [];
    this.mode = 'model';
    this.viewer = undefined;
    this.generation = 0;
    this.previousFocus = undefined;
    this.threeRequested = false;
    this.disposed = false;
    this.listeners = [];
    this.on = this.on.bind(this);
    this.filters = this.filters.bind(this);
    this.renderGrid = this.renderGrid.bind(this);
    this.renderDock = this.renderDock.bind(this);
    this.changeComparison = this.changeComparison.bind(this);
    this.navigate = this.navigate.bind(this);
    this.openProduct = this.openProduct.bind(this);
    this.stopViewer = this.stopViewer.bind(this);
    this.renderSelection = this.renderSelection.bind(this);
    this.resetStage = this.resetStage.bind(this);
    this.syncHash = this.syncHash.bind(this);
    this.start3d = this.start3d.bind(this);
    this.fail3d = this.fail3d.bind(this);
    this.closeViewer = this.closeViewer.bind(this);
    this.clearFilters = this.clearFilters.bind(this);
    this.dispose = this.dispose.bind(this);
    this.connect();
  }
  on(target, event, listener) {
    target.addEventListener(event, listener);
    this.listeners.push(() => target.removeEventListener(event, listener));
  }
  filters() {
    return Object.fromEntries(['query', 'brand', 'type', 'head'].map(name => [name, this.$(`[name="${name}"]`).value]));
  }
  renderGrid() {
    const current = this.filters();
    const shown = filterProducts(this.products, current);
    this.$('#result-count').textContent = `${shown.filter(p => p.variants.length).length} models${shown.some(p => !p.variants.length) ? ' · 1 unresolved entry' : ''}`;
    this.$('#clear-filters').hidden = !Object.values(current).some(Boolean);
    this.$('#empty').hidden = shown.length > 0;
    this.grid.innerHTML = shown.map(product => {
      const variant = product.variants[0];
      const chosen = this.comparison.includes(product.id);
      return `<article class="model-card"><div class="card-art">${variant ? `<button class="card-open" data-open="${product.id}" aria-label="Explore ${escape(product.brand)} ${escape(product.name)}"><img src="${variant.posters.thumbnail}" width="420" height="420" loading="lazy" decoding="async" alt="Authored ${escape(product.name)} model"><span class="explore-hint" aria-hidden="true">↗</span></button><button class="compare-toggle" data-compare="${product.id}" aria-label="${chosen ? 'Remove' : 'Add'} ${escape(product.name)} ${chosen ? 'from' : 'to'} comparison" aria-pressed="${chosen}">${chosen ? '✓' : '+'}</button>${product.provisional ? '<span class="provisional-badge">Provisional</span>' : ''}` : '<div class="held-art"><span class="held-symbol" aria-hidden="true">?</span><p>Identity unresolved</p></div>'}</div><div class="card-meta"><div><p class="card-brand">${escape(product.brand)}</p><h3 class="card-title">${escape(product.name.replace(' (provisional)', ''))}</h3><p class="card-type">${escape(product.type)}</p></div>${variant ? `<span class="head-count">${product.variants.length} head${product.variants.length === 1 ? '' : 's'}</span>` : ''}</div>${!variant ? `<p class="held-note">${escape(product.note)}</p>` : ''}</article>`;
    }).join('');
  }
  renderDock() {
    this.$('#compare-dock').hidden = this.comparison.length === 0;
    this.$('#compare-count').textContent = `${this.comparison.length} / 3 selected`;
    this.$('#compare-open').disabled = this.comparison.length < 2;
    this.$('#compare-items').innerHTML = this.comparison.map(id => {
      const product = this.products.find(p => p.id === id);
      return `<div class="compare-chip"><img src="${product.variants[0].posters.thumbnail}" alt="" width="41" height="37"><span>${escape(product.name)}</span><button data-remove="${id}" aria-label="Remove ${escape(product.name)} from comparison">×</button></div>`;
    }).join('');
    for (const button of this.grid.querySelectorAll('[data-compare]')) {
      const selected = this.comparison.includes(button.dataset.compare);
      const product = this.products.find(p => p.id === button.dataset.compare);
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${product.name} ${selected ? 'from' : 'to'} comparison`);
      button.textContent = selected ? '✓' : '+';
      button.disabled = this.comparison.length === 3 && !selected;
    }
  }
  changeComparison(id) {
    this.comparison = toggleComparison(this.comparison, id);
    this.renderDock();
  }
  navigate(nextMode, selected) {
    const hash = selectionHash(nextMode, selected);
    if (this.window.location.hash === hash)
      this.syncHash();
    else
      this.window.location.hash = hash;
  }
  openProduct(id) {
    const product = this.products.find(p => p.id === id);
    if (product?.variants.length)
      this.navigate('model', [{ product, variant: product.variants[0] }]);
  }
  stopViewer() {
    this.generation++;
    this.viewer?.dispose();
    this.viewer = undefined;
    this.$('#canvas-host').replaceChildren();
    this.$('#viewer-controls').hidden = true;
    this.$('#turntable').setAttribute('aria-pressed', 'false');
  }
  renderSelection() {
    const multiple = this.mode === 'compare';
    this.$('#viewer-kicker').textContent = multiple ? 'SIDE BY SIDE / SHARED MODEL SCALE' : `${this.selection[0].product.brand} / A CLOSER LOOK`;
    this.$('#viewer-title').textContent = multiple ? `${this.selection.length} machines. One perspective.` : this.selection[0].product.name;
    this.$('#scale-note').textContent = multiple ? 'SAME MODELED SCALE · NOT VERIFIED PHYSICAL SIZE' : 'AUTHORED APPEARANCE MODEL';
    this.$('#stage-help').textContent = '3D loads only when you choose it.';
    this.$('#poster-stage').innerHTML = this.selection.map(({ product, variant }) => `<figure><img src="${variant.posters.hero}" alt="Authored ${escape(product.name)} ${escape(variant.name)} model" width="700" height="700"><figcaption>${multiple ? `${escape(product.name)} · ${escape(variant.name)}` : ''}</figcaption></figure>`).join('');
    // Poster renders are independently framed; only the actual 3D scene shares scale.
    if (multiple)
      this.$('#stage-help').textContent = 'Posters fit each tile. Load 3D for shared scale.';
    this.$('#viewer-details').innerHTML = this.selection.map(({ product, variant }, index) => `<section class="detail-model"><p class="card-brand">${escape(product.brand)} / ${escape(product.type)}</p><h3>${escape(product.name)}</h3><p class="description">${escape(product.description)}</p>${product.provisional ? '<p class="quality-tag">● PROVISIONAL SCALE &amp; IDENTITY</p>' : ''}<label class="field-label" for="variant-${index}">Head configuration</label><select class="variant-select" id="variant-${index}" data-variant="${index}" aria-label="Head configuration for ${escape(product.name)}">${product.variants.map(head => `<option value="${head.id}" ${head.id === variant.id ? 'selected' : ''}>${escape(head.name)}</option>`).join('')}</select><span class="field-label">Modeled bounds · W × D × H</span><p class="modeled-size">${variant.size.join(' × ')} <small>mm</small></p><p class="size-note">Measured from this mesh and pose. Includes modeled projections; not verified hardware dimensions or work area.</p><div class="detail-stats"><span>${variant.components} mesh components</span><span>${Math.round(variant.triangles / 1000)}k preview triangles</span></div><details class="quality-note" ${product.provisional ? 'open' : ''}><summary>What’s known &amp; what’s inferred</summary><p>${escape(product.note)}</p><p>Appearance reconstruction. Export validation does not establish physical accuracy, fit or clearance.</p></details><a class="download-link" href="${variant.ui}" download="${product.id}-${variant.id}-preview.glb">Download preview GLB <span>${formatBytes(variant.uiBytes)} ↓</span></a><a class="download-link" href="${variant.detail}" download="${product.id}-${variant.id}-detail.glb">Download detailed GLB <span>${formatBytes(variant.detailBytes)} ↓</span></a><div class="still-links"><a class="download-link" href="${variant.posters.rear}" target="_blank" rel="noopener">Authored rear view <span>WebP ↗</span></a><a class="download-link" href="${variant.posters.detail}" target="_blank" rel="noopener">Authored detail view <span>WebP ↗</span></a></div></section>`).join('');
  }
  resetStage() {
    this.stopViewer();
    this.$('#poster-stage').hidden = false;
    this.$('#start-3d').hidden = false;
    this.$('#start-3d').disabled = false;
    this.$('#start-3d').innerHTML = 'Explore in 3D <span aria-hidden="true">↗</span>';
    this.$('#viewer-status').textContent = '';
    this.$('#viewer-status').classList.remove('error');
  }
  syncHash() {
    const next = readSelection(this.window.location.hash, this.products);
    if (!next.selected.length) {
      if (this.dialog.open)
        this.closeViewer(false);
      return;
    }
    const activeVariant = this.document.activeElement?.dataset?.variant;
    const reload = this.dialog.open && this.threeRequested;
    this.selection = next.selected;
    this.mode = next.mode;
    this.resetStage();
    this.renderSelection();
    this.$('#share-status').textContent = '';
    this.$('#share-fallback').hidden = true;
    if (!this.dialog.open) {
      this.previousFocus = this.document.activeElement;
      this.dialog.showModal();
      this.document.body.classList.add('dialog-open');
      this.$('#close-dialog').focus();
    }
    if (activeVariant !== undefined)
      this.$(`[data-variant="${activeVariant}"]`)?.focus();
    if (reload)
      this.start3d(false);
  }
  async start3d(moveFocus = true) {
    this.stopViewer();
    const token = this.generation;
    this.threeRequested = true;
    this.$('#start-3d').disabled = true;
    this.$('#viewer-status').textContent = `Preparing ${this.selection.length === 1 ? 'model' : 'shared-scale scene'} · ${formatBytes(this.selection.reduce((sum, item) => sum + item.variant.uiBytes, 0))}`;
    try {
      const { createViewer } = await this.loadViewer();
      if (this.disposed || token !== this.generation || !this.dialog.open)
        return;
      this.viewer = createViewer(this.$('#canvas-host'), {
        onStatus: message => {
          if (token === this.generation)
            this.$('#viewer-status').textContent = message;
        },
        onError: error => {
          if (token === this.generation)
            this.fail3d(error);
        },
      });
      await this.viewer.load(this.selection);
      if (this.disposed || token !== this.generation || !this.dialog.open)
        return;
      this.$('#poster-stage').hidden = true;
      this.$('#start-3d').hidden = true;
      this.$('#viewer-controls').hidden = false;
      this.$('#stage-help').textContent = 'Drag to orbit · Scroll or pinch to zoom';
      this.$('#viewer-status').textContent = '';
      if (moveFocus)
        this.viewer.focus();
    }
    catch (error) {
      if (token === this.generation)
        this.fail3d(error);
    }
  }
  fail3d(error) {
    this.stopViewer();
    console.warn(JSON.stringify({ severity: 'warning', event: 'gallery.preview_failed', message: String(error?.message ?? error) }));
    this.$('#poster-stage').hidden = false;
    this.$('#viewer-status').textContent = '3D could not load. You can still explore the authored still views and download the model, or try again.';
    this.$('#viewer-status').classList.add('error');
    this.$('#start-3d').hidden = false;
    this.$('#start-3d').disabled = false;
    this.$('#start-3d').textContent = 'Try 3D again ↗';
  }
  closeViewer(updateHash = true) {
    this.stopViewer();
    this.threeRequested = false;
    if (this.document.fullscreenElement)
      this.document.exitFullscreen?.().catch(() => { });
    if (this.dialog.open)
      this.dialog.close();
    this.document.body.classList.remove('dialog-open');
    if (updateHash)
      this.window.history.replaceState(null, '', this.window.location.pathname + this.window.location.search);
    this.previousFocus?.focus();
  }
  clearFilters() {
    this.$('#filters').reset();
    this.renderGrid();
    this.renderDock();
    this.$('#search').focus();
  }
  dispose() {
    this.disposed = true;
    this.closeViewer(false);
    this.listeners.forEach(remove => remove());
  }
  connect() {
    this.on(this.$('#filters'), 'submit', event => event.preventDefault());
    this.on(this.$('#filters'), 'input', () => { this.renderGrid(); this.renderDock(); });
    this.on(this.$('#filters'), 'change', () => { this.renderGrid(); this.renderDock(); });
    this.on(this.grid, 'click', event => {
      const open = event.target.closest('[data-open]');
      const compare = event.target.closest('[data-compare]');
      if (open)
        this.openProduct(open.dataset.open);
      if (compare)
        this.changeComparison(compare.dataset.compare);
    });
    this.on(this.$('#hero-open'), 'click', () => this.openProduct('algolaser-pixi'));
    this.on(this.$('#hero-action'), 'click', () => this.openProduct('algolaser-pixi'));
    this.on(this.$('#clear-filters'), 'click', this.clearFilters);
    this.on(this.$('#empty-clear'), 'click', this.clearFilters);
    this.on(this.$('#compare-items'), 'click', event => {
      const button = event.target.closest('[data-remove]');
      if (button)
        this.changeComparison(button.dataset.remove);
    });
    this.on(this.$('#compare-clear'), 'click', () => { this.comparison = []; this.renderDock(); });
    this.on(this.$('#compare-open'), 'click', () => this.navigate('compare', this.comparison.map(id => { const product = this.products.find(p => p.id === id); return { product, variant: product.variants[0] }; })));
    this.on(this.$('#viewer-details'), 'change', event => {
      if (!event.target.matches('[data-variant]'))
        return;
      const index = Number(event.target.dataset.variant);
      this.selection[index].variant = variantFor(this.selection[index].product, event.target.value);
      this.navigate(this.mode, this.selection);
    });
    this.on(this.$('#close-dialog'), 'click', () => this.closeViewer());
    this.on(this.dialog, 'cancel', event => { event.preventDefault(); this.closeViewer(); });
    this.on(this.dialog, 'click', event => {
      if (event.target === this.dialog) {
        const rect = this.dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
          this.closeViewer();
      }
    });
    this.on(this.$('#start-3d'), 'click', () => this.start3d());
    this.on(this.$('#viewer-controls'), 'click', event => {
      const button = event.target.closest('[data-view]');
      if (button) {
        this.viewer?.preset(button.dataset.view);
        this.$('#turntable').setAttribute('aria-pressed', 'false');
      }
    });
    this.on(this.$('#turntable'), 'click', () => { const active = this.viewer?.toggleRotation() ?? false; this.$('#turntable').setAttribute('aria-pressed', String(active)); });
    this.on(this.$('#fullscreen'), 'click', async () => {
      try {
        if (this.document.fullscreenElement)
          await this.document.exitFullscreen();
        else if (this.$('#viewer-stage').requestFullscreen)
          await this.$('#viewer-stage').requestFullscreen();
        else
          this.$('#share-status').textContent = 'Fullscreen is unavailable in this browser.';
      }
      catch {
        this.$('#share-status').textContent = 'Fullscreen is unavailable in this browser.';
      }
    });
    this.on(this.$('#share'), 'click', async () => {
      try {
        await this.window.navigator.clipboard.writeText(this.window.location.href);
        this.$('#share-status').textContent = 'View link copied.';
      }
      catch {
        const input = this.$('#share-fallback');
        input.hidden = false;
        input.value = this.window.location.href;
        input.focus();
        input.select();
        this.$('#share-status').textContent = 'Copy this link to share the selected heads.';
      }
    });
    this.on(this.window, 'hashchange', this.syncHash);
    this.on(this.document, 'keydown', event => {
      if (event.key === '/' && !this.dialog.open && !event.ctrlKey && !event.metaKey && !event.altKey && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) {
        event.preventDefault();
        this.$('#search').focus();
      }
    });
    this.on(this.window, 'pagehide', () => this.stopViewer());
    this.renderGrid();
    this.renderDock();
    this.syncHash();
  }
}
if (typeof document !== 'undefined' && document.querySelector('[data-gallery-auto]')) {
  fetch('catalog.json').then(response => { if (!response.ok)
    throw new Error(`Catalog HTTP ${response.status}`); return response.json(); }).then(products => mountGallery(document, products)).catch(error => {
    document.querySelector('#result-count').textContent = 'The collection could not load. Refresh to try again.';
    console.error(JSON.stringify({ severity: 'error', event: 'gallery.catalog_failed', message: String(error.message) }));
  });
}
