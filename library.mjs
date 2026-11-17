export function variantFor(product, id) {
  return product.variants.find(variant => variant.id === id) ?? product.variants[0];
}

export function filterProducts(products, { query = '', brand = '', type = '', head = '' } = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return products.filter(product => {
    const text = [product.brand, product.name, product.type, ...product.variants.map(v => v.name)].join(' ').toLocaleLowerCase();
    return (!brand || product.brand === brand) && (!type || product.type === type)
      && (!head || product.variants.some(variant => variant.type === head))
      && terms.every(term => text.includes(term));
  });
}

export function readSelection(hash, products) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const mode = params.has('compare') ? 'compare' : 'model';
  const raw = params.get(mode) ?? '';
  const seen = new Set();
  const selected = raw.split(',').flatMap(key => {
    const [id, head] = key.split('~');
    const product = products.find(item => item.id === id && item.variants.length);
    if (!product || seen.has(id)) return [];
    seen.add(id);
    return [{ product, variant: variantFor(product, head) }];
  }).slice(0, mode === 'compare' ? 3 : 1);
  return { mode, selected };
}

export function selectionHash(mode, selected) {
  if (!selected.length) return '';
  return `#${mode}=${selected.map(({ product, variant }) => `${product.id}~${variant.id}`).join(',')}`;
}

export function toggleComparison(current, id) {
  if (current.includes(id)) return current.filter(value => value !== id);
  return current.length < 3 ? [...current, id] : current;
}

export function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
