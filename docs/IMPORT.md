# Importing bank and broker data

You can type every expense by hand, but the fastest way to get a complete picture is to import what your bank already gives you. Files are read **on your own server** and the parsed rows are encrypted like the rest of your data. Nothing is sent to an AI unless you allow the specific feature that needs it.

## What can be imported, and where

| What | Where in the app | Formats |
|---|---|---|
| Bank account and card transactions | *Movimenti → Importa estratto conto* | CSV, Excel `.xlsx`, `.xls` (including the old binary format), PDF (needs Anthropic AI, off by default) |
| Portfolio snapshot (positions, quantities, prices) | *Investimenti → Posizioni → Importa* | Excel `.xls`/`.xlsx`, CSV |
| Securities movements (buy/sell with ISIN) | *Investimenti → Storico → Importa operazioni* | Excel `.xlsx`, CSV |

The app recognises which kind of file you gave it, so any import button works with any of them.

## Tested banks

EyeCash has been tested end to end with the exports of the Italian bank **Fineco**:

| Fineco export | Used for |
|---|---|
| Account and card transactions (Excel) | transactions, categories, credit cards, trades found in the descriptions |
| *Portafoglio di sintesi* (`.xls`) | current positions, quantities, average cost, ISIN |
| *Movimenti Dossier Titoli* (Excel) | exact investment history matched by ISIN |

Other banks and brokers go through the generic importer described below. Reports about what works (and what does not) for your bank are very welcome: open an issue with the bank name and **only the column headers** of the file, never real rows.

## How a statement is read

1. **Saved formats.** If the header row matches a format seen before, its mapping is reused.
2. **Automatic detection.** Common column names are recognised in Italian and English: *data/date/valuta*, *descrizione/causale/operazione/esercente*, *importo/amount* or separate *addebiti/uscite* and *accrediti/entrate* columns. Dates and decimal formats (`1.234,56` or `1,234.56`) are detected.
3. **AI, once per format (optional).** If the layout is still unknown and *Riconoscimento formato banca* is on, the AI receives the column headers and up to 12 rows **with the digits of amounts masked**. It answers which column is which, and the mapping is saved so the AI is not needed for that bank again.

Before anything is saved you see a **preview**: new rows, exact duplicates, and rows matching expenses you had typed by hand.

### Duplicates and your manual entries

Import the same file twice and nothing is duplicated. If you had already typed *"12,50 pizza"* and the bank row for the same amount on the same account arrives a few days later with its own description, it is recognised as the **same payment**: your entry is kept, with your category and note, and the bank's description is attached to it. In the preview you can choose to add the bank rows anyway.

### Categories

Categories are assigned by built-in rules (supermarkets, fuel, transport, utilities…) and by what you taught the app. When you correct a category, the merchant is remembered for the next imports. If *Categorizzazione spese* is on, rows still without a category can be suggested by the AI (it receives only their description and amount).

### Credit cards

Card spending is shown on the card account, and the monthly debit on the current account is recognised as a card payment, so expenses are **not counted twice**. Balances match what you see at the bank.

### Investments from bank statements

Rows like *"Compravendita Titoli … Qta …"* become **trades** in the investment history. Bank descriptions often abbreviate names, so trades are matched to your positions by comparing quantities and costs; you can fix any match with *Abbina*. When you also import the broker's securities movements, trades are matched by ISIN and nothing is duplicated, in whatever order you import the two files.

## Privacy checklist

- Files are parsed on your server; the parsed rows are encrypted with your key before being stored.
- PDF reading is **off by default** because it would send the whole document to the AI. Prefer CSV or Excel.
- IBANs and card numbers are masked before any text reaches an AI.
- Never attach real statements to GitHub issues. Headers and invented rows are enough to reproduce a problem.

## Adding support for a bank

Most banks already work through automatic detection. If yours needs special handling:

1. Look at `importRows()` and `applyMapping()` in [`public/js/import.js`](../public/js/import.js) (bank statements), and at `portfolioRows()` and `dossierRows()` in `import.js` and `history.js` (broker files).
2. Add a test with a **synthetic** file (invented names and amounts) under `tests/fixtures/`.
3. Open a pull request. See [CONTRIBUTING.md](../CONTRIBUTING.md).
