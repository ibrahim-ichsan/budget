// State lives on the device only (IndexedDB). Nothing is sent to a server.
import { get, set, del } from 'idb-keyval';

const KEY = 'budget-state-v1';
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyState() {
  return {
    v: 1, base: 'EUR',
    accounts: [], groups: [], categories: [
      { id: 'c-transfer', name: 'Transfer', type: 'Transfer', tier: 'Transfer' },
      { id: 'c-ccp', name: 'Credit Card Payment', type: 'Transfer', tier: 'Transfer' },
      { id: 'c-fee', name: 'Admin Fee', type: 'Expense', tier: 'Needs' },
    ],
    rates: { IDR: 1, EUR: 20000 }, ratesUpdated: {},
    anchorDay: 1, overrides: {},
    framework: '50/30/20 Standard',
    frameworks: [
      { name: '50/30/20 Standard', needs: 0.5, wants: 0.3, savings: 0.2, giving: 0 },
      { name: '70/20/10 Conservative', needs: 0.7, wants: 0, savings: 0.2, giving: 0.1 },
      { name: 'Custom', needs: 0.4, wants: 0.3, savings: 0.25, giving: 0.05 },
    ],
    budgets: { default: {} }, tx: [], plans: [], investmentsIdr: 0,
    meta: { demo: false, lastBackup: '', dirty: false, cards: { nw: true } },
  };
}

export const store = {
  state: null,
  async load() {
    this.state = (await get(KEY)) || null;
    if (this.state && !this.state.meta) this.state.meta = { demo: false, lastBackup: '', dirty: false, cards: {} };
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return this.state;
  },
  async save(markDirty = true) {
    if (markDirty) this.state.meta.dirty = true;
    await set(KEY, JSON.parse(JSON.stringify(this.state)));
  },
  async replace(next) { this.state = next; if (!next.meta) next.meta = { demo: false, lastBackup: '', dirty: false, cards: {} }; await this.save(false); },
  async clear() { this.state = null; await del(KEY); },
};
