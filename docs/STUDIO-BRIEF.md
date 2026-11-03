# Studio screens — conventions for whoever builds one

The studio (`apps/studio`, port 5301) is the seller's console for Klygenix Play. It is a fork of
Klygenix Pay's merchant console (`../klygenix-pay/apps/pay`) and must read like it: same
design system, same page anatomy, same data hooks. Read two Pay pages before writing one
(`../klygenix-pay/apps/pay/src/pages/Items.tsx`, `Customers.tsx`, `Payments.tsx`,
`Settlements.tsx`, `Reports.tsx`) — copy their structure, not their domain.

## Stack and imports
- UI kit: `@klygenixvideo/ui` (`packages/ui/src/index.ts`) — `ListPage`, `PageHeader`, `DataTable`,
  `Drawer`, `DrawerFooter`, `Field`, `Input`, `Textarea`, `Select`, `ToggleField`, `Badge`,
  `StatCard`, `Tabs`, `Button`, `Modal`, `EmptyState`, `Spinner`, `FileDropzone`, `useConfirm`,
  `downloadReport`/`downloadFile` (authenticated blob downloads).
- Data: `@klygenixvideo/client` — `useList`, `useListPage`, `usePagedList`, `useOne`, `useSave`,
  `useRemove`, `useAction`, `formatMoney`, `toMinor`, `formatDate`. `api` (axios with the JWT)
  from `@klygenixvideo/auth` for anything custom.
- Toasts: `sonner` (`toast.success`, `toast.error(err?.response?.data?.detail ?? "…")`).
- Icons: `lucide-react`. Charts: `recharts` (+ `CHART_COLORS` from ui).
- Shared types: `@klygenixvideo/types` (`ProductCard`, `PageBlock`, `StoreProfile`…).
- Studio helpers already written: `src/lib/store.ts` (`useMyStore`, `storeUrl`, `STOREFRONT_URL`,
  `LIBRARY_URL`), `src/lib/kinds.ts` (`KINDS`, `KIND_LABELS`), `src/components/BlockEditor.tsx`
  (the page-builder with live preview — props `blocks`, `onChange`, `ctx`, `mode: "store"|"product"`).

## Rules (these are review-blocking)
1. **Money is integer paise.** Show with `formatMoney(minor, "INR")`; take input in rupees and send
   `toMinor(value)` / `Math.round(Number(v) * 100)`. Never send a float.
2. **A row is edited by clicking it** — `DataTable onRowClick` opens a `Drawer`. No trailing
   edit/delete icon columns. Delete lives in `DrawerFooter`'s `destructive` action and is
   confirmed with `useConfirm()` (destructive variant). `window.confirm`/`alert` are banned.
3. **Field names must match the API exactly** — read the router in `backend/app/store/routers/`
   (studio_catalog.py, studio_pages.py, studio_sales.py, studio_money.py) and the `present.py`
   shapes. Pydantic drops unknown keys silently; a misnamed field loses data with no error.
4. **Every mutation's error is toasted** from `err?.response?.data?.detail`.
5. **Copy is plain and specific**, sentence case, written for a creator selling in India. No
   "AI", no marketing fluff, no ALL-CAPS labels.
6. **Lists that can grow page on the server** — use `usePagedList` + `DataTable serverTotal/
   onServerPage` for orders, buyers, messages, invoices, journals.
7. Authenticated downloads go through axios as a blob (`downloadReport` / `downloadFile` in ui),
   never a bare `<a href>` — the JWT is in an interceptor.

## Verify
- `cd apps/studio && npx tsc --noEmit -p tsconfig.app.json; echo $?` must print 0.
  (The bare `tsc --noEmit` checks zero files — never use it.)
- The API runs at http://localhost:9300 (admin@klygenix.com / admin123). You can hit it with
  curl to confirm a response shape: `POST /api/auth/login` → `access_token`.
- Do not edit files outside your assigned pages (and any new files under
  `src/components/<your-area>/`). Do not commit.
