## Phase 3 — Generic ledger & onboarding

- **Guided setup with an empty ledger** (no templates, no fake amounts)
- **Editable categories with 7 defaults** (not hardcoded, can be renamed/deleted/added)
- **Remove the bank/allocation section entirely**
- **Currency picker with ~12 currencies and locale-aware formatting**

Data model (in `__meta`):
- `currency`: 3-letter code (INR, USD, EUR, etc)
- `categories`: array of { name, bucket, icon, color }
- `items`: array of { key, name, category, kind, fixed }
- `onboarded`: boolean (true if the user has finished setup)

Legacy fields for migration (will be dropped later):
- `customItems`, `hiddenItems`, `nameOverrides`, `categoryBudgets`

`ledger.js` holds the ledger definitions and formatting rules. The page only
renders what it returns.

### Implementation notes

- `ledger.js` exports a `Ledger` object with methods for migration, formatting, and category management
- The page includes `<script src="/ledger.js">` and replaces `CATEGORY_MAP` with `Ledger.categoryMap(getMeta().categories)`
- All hardcoded `₹`/`en-IN` formatting replaced with `Ledger.formatCurrency(amount, getCurrencyCode())`
- Bank/allocation section removed from markup, JS, and CSS
- Onboarding modal shows for new accounts: currency picker, optional income, optional quick-pick items
- Category management available from budget modal: rename, change bucket, add/remove
- Settings route preserves Phase 3 keys when older clients omit them
- Server validates items against the supplied category list
- Tests added for currency detection, formatting, migration, and category logic