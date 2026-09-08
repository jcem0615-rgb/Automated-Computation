# Calculation Rules

Follow this exact order of operations. Do not round intermediate values —
only round for display (2 decimal places).

## 1. Per line item (Bill of Materials)
```
Raw Total      = Quantity × Unit Cost
Marked-Up Price = Raw Total × (1 + Markup % / 100)
```

## 2. Materials Subtotal
```
Total Materials = Sum of all Marked-Up Prices (per line item)
```
Also show the sum of Raw Totals in the "Materials Subtotal" row for
transparency.

## 3. Labor
```
Total Labor = Workers × Daily Rate × Days
```
If a Flat Fee was given instead, `Total Labor = Flat Fee`.

## 4. Direct Project Fees
```
Total Direct Fees = Mobilization/Delivery + Permits/Clearances + Equipment Rental + (any other misc fees)
```

## 5. Subtotal
```
Subtotal = Total Materials + Total Labor + Total Direct Fees
```

## 6. VAT (only if VAT status = 12% VAT)
```
VAT = Subtotal × 0.12
```
If Non-VAT, show ₱0.00 (or "N/A") in the VAT row.

## 7. Grand Total
```
Grand Total = Subtotal + VAT
```

## Formatting
- All currency: `₱` symbol, comma thousands separator, 2 decimal places.
  Example: `₱125,340.50`
- Percentages: show with a `%` sign, no decimals unless the user provided
  a fractional markup (e.g., `15%` or `12.5%`).
