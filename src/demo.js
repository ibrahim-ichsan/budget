// Synthetic sample data for Demo Mode (BG-09). None of it belongs to a real person.
import { emptyState } from './store.js';

export function demoState(today) {
  const s = emptyState();
  s.meta.demo = true;
  s.rates = { IDR: 1, EUR: 20000, USD: 18000 };
  s.ratesUpdated = { EUR: today, USD: today };
  s.accounts = [
    { id: 'a-main', name: 'Sample Current Account', type: 'Bank', ccy: 'EUR', opening: 1800 },
    { id: 'a-save', name: 'Sample Savings', type: 'Bank', ccy: 'EUR', opening: 5000 },
    { id: 'a-cash', name: 'Sample Cash', type: 'Cash', ccy: 'EUR', opening: 60 },
    { id: 'a-home', name: 'Sample Home Bank', type: 'Bank', ccy: 'IDR', opening: 12000000 },
    { id: 'a-card', name: 'Sample Credit Card', type: 'Credit Card', ccy: 'IDR', opening: -1500000, limit: 20000000 },
  ];
  s.categories = [
    { id: 'c-salary', name: 'Salary', type: 'Income', tier: 'Income' },
    { id: 'c-side', name: 'Side Income', type: 'Income', tier: 'Income' },
    { id: 'c-rent', name: 'Rent', type: 'Expense', tier: 'Needs' },
    { id: 'c-food', name: 'Groceries', type: 'Expense', tier: 'Needs' },
    { id: 'c-transport', name: 'Transport', type: 'Expense', tier: 'Needs' },
    { id: 'c-out', name: 'Eating Out', type: 'Expense', tier: 'Wants' },
    { id: 'c-subs', name: 'Subscriptions', type: 'Expense', tier: 'Wants' },
    { id: 'c-invest', name: 'Investing', type: 'Expense', tier: 'Savings' },
    { id: 'c-gift', name: 'Gifts', type: 'Expense', tier: 'Giving' },
    { id: 'c-fee', name: 'Admin Fee', type: 'Expense', tier: 'Needs' },
    { id: 'c-transfer', name: 'Transfer', type: 'Transfer', tier: 'Transfer' },
    { id: 'c-ccp', name: 'Credit Card Payment', type: 'Transfer', tier: 'Transfer' },
  ];
  s.budgets.default = { 'c-salary': 2400, 'c-rent': 900, 'c-food': 220, 'c-transport': 60, 'c-out': 120, 'c-subs': 30, 'c-invest': 300, 'c-gift': 40 };
  const ym = today.slice(0, 8);
  const d = (n) => ym + String(Math.min(n, Number(today.slice(8, 10)))).padStart(2, '0');
  let n = 0;
  const add = (date, desc, cat, type, acct, ccy, amt, extra = {}) => s.tx.push({ id: `d${++n}`, date, desc, cat, type, acct, ccy, amt, billed: null, notes: '', ...extra });
  add(d(1), 'Monthly salary', 'c-salary', 'Income', 'a-main', 'EUR', 2400);
  add(d(1), 'Rent', 'c-rent', 'Expense', 'a-main', 'EUR', -900);
  add(d(2), 'Supermarket', 'c-food', 'Expense', 'a-main', 'EUR', -42.3);
  add(d(3), 'Bus pass', 'c-transport', 'Expense', 'a-main', 'EUR', -32);
  add(d(4), 'Coffee with a friend', 'c-out', 'Expense', 'a-cash', 'EUR', -7.5);
  add(d(5), 'Music subscription', 'c-subs', 'Expense', 'a-card', 'EUR', -11.99, { billed: -243000 });
  add(d(6), 'Supermarket', 'c-food', 'Expense', 'a-main', 'EUR', -38.9);
  add(d(7), 'Index fund', 'c-invest', 'Expense', 'a-main', 'EUR', -300);
  add(d(8), 'Dinner out', 'c-out', 'Expense', 'a-main', 'EUR', -54);
  add(d(9), 'Move to savings', 'c-transfer', 'Transfer', 'a-main', 'EUR', -400, { link: 'dl1' });
  add(d(9), 'Move to savings', 'c-transfer', 'Transfer', 'a-save', 'EUR', 400, { link: 'dl1' });
  add(d(10), 'Pay credit card', 'c-ccp', 'Transfer', 'a-home', 'IDR', -1500000, { link: 'dl2' });
  add(d(10), 'Pay credit card', 'c-ccp', 'Transfer', 'a-card', 'IDR', 1500000, { link: 'dl2' });
  add(d(11), 'Birthday gift', 'c-gift', 'Expense', 'a-main', 'EUR', -35);
  add(d(12), 'Supermarket', 'c-food', 'Expense', 'a-main', 'EUR', -51.2);
  s.plans = [{ id: 'dp1', item: 'Sample laptop', card: 'a-card', date: ym.slice(0, 7) + '-01', total: 12000000, tenor: 12, monthly: null }];
  return s;
}
