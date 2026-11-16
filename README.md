# budget

A pay-cycle, multi-currency budget app that installs to a phone's home screen and works offline.
All data stays on the device. Nothing is sent to a server.

## Run it

```
npm install
npm test         # calculation engine: one test per row of the PRD's permutation tables
npm run dev      # local preview
npm run build    # production build in dist/
```

## What it does

- Quick add for income and expenses, in any currency in the Rate Table, with an optional billed amount
- Transfers and card payments as one action that writes both legs
- Budget against actual per pay cycle, with tier allocation against a framework
- Dashboard: cycle totals, account balances as of a date, card outstanding, net worth
- Insights: this week against budget, pace in the cycle, month-by-month chart, how long the money lasts, with tier, account and category filters
- Credit card utilisation, shared limits and instalment plans
- Import of a workbook in the `financial_budget` layout, with a reconciliation of every account balance
- Export to Excel, backup file and restore
- Demo Mode with synthetic sample data
- Optional app lock with the device fingerprint or screen lock

## Layout

| Path | Purpose |
| --- | --- |
| `src/engine.js` | All calculations. Pure functions, no browser APIs. |
| `tests/engine.test.js` | Tests for the engine. Synthetic data only. |
| `src/xlsx.js` | Workbook import, reconciliation and Excel export. |
| `src/main.js` | Screens and events. |
| `src/insights.js` | Insights screen and its charts (plain SVG). |
| `src/store.js` | Storage on the device (IndexedDB). |
| `src/demo.js` | Sample data for Demo Mode. |
| `src/lock.js` | App lock. |

## Privacy

No real financial data belongs in this repo. Workbooks and backup files are ignored by git.

## Authorship

Built with AI assistance, with human review, decisions and judgement.
