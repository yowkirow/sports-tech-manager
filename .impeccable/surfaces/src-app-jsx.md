---
version: 1
slug: "src-app-jsx"
primary_target: "src/App.jsx"
related_targets: ["src/components/Orders/OrderManagement.jsx","src/components/POS/POSInterface.jsx","src/components/DashboardStats.jsx","src/components/Production/PrintQueue.jsx","src/components/Production/ProductionManager.jsx"]
---

# Back office: admin shell, POS, orders, money, stock, club, settings, production and print queue

Scope: `/admin` (App shell plus every tab) and `/print`. Visitor mode: **Operate**.

Audience and job: the owner runs the day on a phone and on a desktop, covering POS, orders,
payments, stock, expenses, vouchers, suppliers, ads, the Downtown Dinks ledger and print releases.
Resellers sell at ₱400 and edit only their own unpaid pending orders. The print employee works
`/print` on a phone at the press and sees only released jobs, with no customer or money data.
Frequency: all day, repeatedly, often one-handed.
Important states: loading or syncing, sync error with retry, the read-only staging and maintenance
banner, empty lists, saving, and destructive confirms.
Constraints: no change to API contracts, pricing, permissions or data isolation. The
read-only banner must always be visible.

## Direction contract

THESIS: The storefront's athletic standard is carried into a calm, dense console, at the level of
Shopify admin or a performance-brand ops tool. The task, the number and the status lead. It
refuses decorative glass, gradient icon tiles and hover-scaling cards.

OWN-WORLD: The same near-black ground and charcoal surfaces as the store, with one red for primary
action and selection. Page titles and KPI figures use Barlow Condensed in uppercase; everything
else uses the system sans. Figures are tabular. Status chips carry a text label, never colour
alone. Hairline tables and 8px radii throughout.

STORY: Staff open a tab, read the state at a glance, act with one primary button, and see the
result confirmed in a toast.

FIRST VIEWPORT: On desktop, a 248px grouped sidebar (Sell, Money, Stock, Club, Make, Overview)
sits beside a 64px header with the condensed uppercase page title, sync state and a user chip. On a
phone, a compact header plus a bottom tab bar (POS, Orders, Dashboard, Menu) with 48px targets. The
print queue is a single column of large job cards with the progress action in thumb reach.

FORM: category standard (canon) carried into Operate; seed key 19228f6d. Signature interaction:
a mobile bottom tab bar whose Menu opens the full grouped drawer.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
