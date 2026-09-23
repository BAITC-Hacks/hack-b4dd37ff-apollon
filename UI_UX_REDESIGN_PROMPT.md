# Apollon: Single-Page UI/UX Redesign Prompt

This document is a redesign prompt, not a separate implementation plan. `BUILD_PLAN.md` remains the single authoritative implementation plan. The instructions below describe the requested redesign; saving this prompt does not execute the redesign.

---

Redesign the entire UI/UX of Apollon, a supplier replenishment application for ТОО «Электрокомплект».

The primary source of product requirements is `case and data/Hackathon_task.md`. Preserve the necessary business logic from `BUILD_PLAN.md`, but replace the multi-page structure with **one workspace without a sidebar**. Update the interface specification in `BUILD_PLAN.md` to reflect these requirements when implementing the redesign.

The interface must immediately communicate to procurement managers and judges that they can **upload their own reports or use an available prepared dataset**, then obtain an actual order calculation, review it, adjust it, approve it, and export it.

This prompt is written in English. Keep the product interface in Russian, using clear procurement terminology. Translate the suggested English labels below naturally for the interface.

## 1. Core User Journey

The entire workflow takes place on one page:

**Choose data → validate data → calculate → review recommendations → adjust quantities → approve → export.**

Users must not navigate between separate upload, analytics, product, and order pages. Use dynamic page states, expandable sections, dialogs, and a product detail drawer. Important actions must not depend on an AI chat.

## 2. Application Header

Include the Apollon name, a **New calculation** action, and **Calculation history**.

Open history in a compact panel or dialog. Do not add a fictional user profile, account menu, or navigation organized around technical subsystems.

**New calculation** returns to data selection. If unsaved changes exist, offer to save them before leaving the current calculation.

## 3. Initial State: Two Equally Visible Ways to Start

Use the heading **Calculate your supplier order**.

Use the supporting text **Upload your own reports or use the prepared case data**.

Display two equally prominent cards:

### Upload your own reports

- A drop zone supporting multiple files.
- A file selection button.
- A clear explanation of the required data.
- Access to supported formats and sample files.

### Use the case data

- The available prepared IEK and Systeme Electric datasets.
- Their contents and reporting periods.
- An action to use the selected dataset.

Do not hide prepared data behind a small header button. Both starting options should be visible without scrolling on a typical laptop screen.

Use truthful source labels: actual partner reports are **Case data**; synthetic datasets are **Demo data**. Only show datasets that are actually available. Never substitute prewritten recommendations for a real calculation.

Both starting options must use the same implemented calculation workflow. Prepared data is a convenient input, not a canned output. History is a separate way to reopen an existing saved calculation.

## 4. Data Validation Before Calculation

After the user chooses a source, show a compact summary of the files, suppliers, sales period, stock snapshot dates, product count, and data scope.

Show warehouses and categories only when supported by the data. Do not invent warehouses or describe suppliers as warehouses.

Explain what was read successfully, what is missing, and what needs attention. Distinguish blocking errors from warnings that allow a provisional calculation.

For each issue, provide a clear next action: replace a file, add information, change a parameter, or review an assumption. Do not show technical exceptions or stack traces.

End this section with the primary action **Calculate order**.

## 5. Calculation Parameters

Keep the main parameters near the calculation action: calculation scope, category, and applicable planning settings.

Put advanced parameters—lead times, review period, growth forecasts, category service policies, and stockout compensation—in an expandable section or dialog. Use understandable labels and explain how each parameter affects the result.

Separate display filters from calculation parameters. Filtering the table must not silently recalculate the order. Changes to calculation inputs must clearly require recalculation.

## 6. Processing State

During upload, validation, and calculation, display the current stage and truthful progress. Do not invent progress percentages or countdowns.

Prevent duplicate submissions of the same operation. On failure, preserve the available context and offer a retry. An interrupted calculation must not appear complete.

## 7. Main Result: Orders Grouped by Supplier

After calculation, collapse the upload area into a compact context bar showing the source, reporting period, data scope, and a **Change data** action.

The central element is a table grouped by supplier, with search and useful filters.

Show:

- Product name and identifiers.
- Unit of measure.
- Available stock.
- Goods in transit.
- Recommended quantity.
- Editable order quantity.
- Urgency.
- A concise explanation.

Use labels such as **Recommended**, **Order quantity**, and **Explanation**. Do not append “AI” to every label.

Do not display unknown stock as zero. Clearly identify estimates, unresolved unit conversions, and other material assumptions.

Keep the system recommendation distinguishable from the manually entered quantity. Provide a way to restore the recommended quantity. Explain which rows will be included in the order: those selected by the user, with positive quantities, and satisfying the required checks.

Show a monetary total only when appropriate price data is available. Do not combine incompatible units into a meaningless total quantity.

## 8. Product Detail Drawer

Clicking a row opens a detail drawer without leaving the page or losing the user's position in the table.

Show actual, cleaned, and adjusted sales; the forecast; identified anomalies; stockout periods; and expected deliveries.

The explanation must account for the specific recommended quantity: forecast demand over the planning horizon, safety stock, available stock, included inbound deliveries, minimum order quantity, and rounding.

Separate confirmed facts from estimates. Show the source and date of material inputs.

Provide the anomaly review and assumption adjustment actions supported by the application logic. Never describe an invoice number as a customer identifier.

## 9. Approval and Export

Use a sticky bottom action bar showing the number of selected order lines, order status, and the next primary action.

Approval must be explicit: **Approve order**, with the responsible person's name and any required acknowledgements of assumptions. After approval, make **Download Excel**, **Download CSV**, and the supported supplier drafts available.

Editing quantities or recalculating invalidates active approval. Immediately explain that approval is required again. Preserve the previously approved version in history.

Do not label an export as compatible with 1C until the format has been verified. Do not add automatic supplier dispatch.

## 10. Calculation History

For each history entry, show the date, data source, suppliers, calculation scope, and status.

Opening a history entry restores the saved result in the same workspace. It must not automatically start a new calculation.

Clearly distinguish between reusing source data, opening a saved result, and creating a new calculation. Preserve access to approved revisions and their exports.

## 11. Visual Style and Accessibility

Use **`#2c7294`** as the primary accent color, with a neutral background, readable typography, and a calm visual hierarchy.

Prioritize table usability: aligned numbers, visible units, sticky column headers, and understandable editing controls.

Communicate urgency and errors with both text and color. Ensure sufficient contrast, keyboard operation, visible focus, and accessible control labels.

On narrow screens, stack the input cards vertically and preserve access to the table and primary actions. The sticky bottom action bar must not obscure content.

## 12. Redesign Boundaries and Acceptance Criteria

Remove separate `/import`, `/trends`, `/checks`, `/backtest`, and product pages from the main user navigation. Do not remove necessary calculations, validation, or quality evidence. Make these available through contextual details or a compact **Calculation validation** action where useful.

If retained, Copilot is an optional panel. The complete primary workflow must work without it.

The redesign is complete when a new user can understand both data input options without explanation and complete the workflow through approved export on one page.

Verify this workflow separately for uploaded reports and a prepared dataset. Also verify upload failures, manual quantity changes, approval invalidation and reapproval, and restoring saved results from history.

Every interface element must connect to actual application services. Do not use fictional totals, customers, warehouses, statuses, charts, or simulated successful actions.
