import { useMemo, useState } from "react";
import { localDb } from "../../db/localDb";
import { supabase } from "../../lib/supabaseClient";
import {
  createPurchaseInvoice,
  postPurchaseLine,
  findPurchaseInvoiceDuplicate,
} from "../../lib/purchases";
import { Button } from "../ui/Button";
import { Input, Label, Select } from "../ui/Input";
import { Card } from "../ui/Card";
import { Modal } from "../ui/Modal";
import { formatInr, toNum } from "../../lib/format";
import { buildSearchIndex } from "../../hooks/useSync";
import { businessDateIST } from "../../lib/businessDay";
import { PurchaseInvoiceHistory } from "./PurchaseInvoiceHistory";
import { PurchaseTotalsCheck } from "./PurchaseTotalsCheck";
import { ManualLineCalcHint } from "./ManualLineCalcHint";
import { SupplierSelect } from "./SupplierSelect";
import { compareInvoiceCalculation } from "../../lib/purchaseCalculations";
import { PageHeader } from "../shared/PageHeader";

const UOM_OPTIONS = ["PCS", "SET", "KG", "LTR", "BOX", "PAIR"];

export function PurchaseEntry({ profile, isOwner }) {
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(businessDateIST());
  const [printedTaxable, setPrintedTaxable] = useState("");
  const [printedCgst, setPrintedCgst] = useState("");
  const [printedSgst, setPrintedSgst] = useState("");
  const [printedGrandTotal, setPrintedGrandTotal] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState("");
  const [costPrompt, setCostPrompt] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);

  function emptyLine() {
    return {
      part_number: "",
      description: "",
      quantity: "1",
      uom: "PCS",
      mrp: "",
      unit_cost: "",
      disc_percent: "",
      taxable: "",
      gst_percent: "18",
    };
  }

  function updateLine(idx, patch) {
    setLines((prev) =>
      prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)),
    );
  }

  const totalsCheck = useMemo(() => {
    const activeLines = lines.filter((l) => l.part_number.trim());
    if (!activeLines.length) return null;
    return compareInvoiceCalculation({
      format: "manual",
      calcMode: "simple",
      printedTaxable: printedTaxable,
      printedCgst: printedCgst,
      printedSgst: printedSgst,
      printedGrandTotal: printedGrandTotal,
      lines: activeLines.map((l, i) => ({
        lineNo: i + 1,
        code: l.part_number,
        qty: l.quantity,
        mrp: l.mrp,
        unit_cost: l.unit_cost,
        discPercent: l.disc_percent,
        taxable: l.taxable,
        gstPercent: l.gst_percent,
      })),
    });
  }, [lines, printedTaxable, printedCgst, printedSgst, printedGrandTotal]);

  async function post(decisions = {}) {
    setError("");
    if (!supplierId) {
      setError("Select a supplier or add a new one.");
      return;
    }

    const supplier = await localDb.suppliers.get(supplierId);
    if (!supplier) {
      setError("Supplier not found. Select again or refresh.");
      return;
    }

    const duplicate = await findPurchaseInvoiceDuplicate(supplier.id, invoiceNumber);
    if (duplicate) {
      setError(
        `Duplicate invoice: ${invoiceNumber} already exists for this supplier (dated ${duplicate.invoice_date}).`,
      );
      return;
    }

    const invoice = await createPurchaseInvoice({
      supplierId: supplier.id,
      invoiceNumber,
      invoiceDate,
      createdBy: profile.id,
      status: isOwner ? "POSTED" : "PENDING_APPROVAL",
      source: "MANUAL",
      printedTaxable: printedTaxable || totalsCheck?.computed.taxable,
      printedCgst: printedCgst || totalsCheck?.computed.cgst,
      printedSgst: printedSgst || totalsCheck?.computed.sgst,
      printedGrandTotal: printedGrandTotal || totalsCheck?.computed.grandTotal,
    });

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.part_number.trim()) continue;
      const inward = Number(l.unit_cost) || 0;
      const qty = Number(l.quantity) || 0;
      let activeIdx = 0;
      for (let j = 0; j < i; j++) {
        if (lines[j].part_number.trim()) activeIdx++;
      }
      const lineCheck = totalsCheck?.lineChecks?.[activeIdx];
      const expected = lineCheck?.expected;

      let product = await localDb.products
        .where("part_number")
        .equals(l.part_number.trim().toUpperCase())
        .first();
      if (!product) {
        const sell =
          toNum(l.mrp) > 0 ? toNum(l.mrp) : inward > 0 ? inward * 1.15 : 0;
        product = {
          id: crypto.randomUUID(),
          part_number: l.part_number.trim().toUpperCase(),
          name: l.description || l.part_number,
          purchase_price: inward,
          selling_price: sell,
          stock_quantity: 0,
          min_stock_alert: 5,
          vehicle_compatibility: [],
          uom: l.uom || "PCS",
          updated_at: new Date().toISOString(),
        };
        if (supabase && navigator.onLine) {
          const { data } = await supabase
            .from("products")
            .insert(product)
            .select()
            .single();
          product = data;
        }
        await localDb.products.put(product);
      }

      const oldCost = Number(product.purchase_price) || 0;
      let applyCost = null;
      if (inward !== oldCost) {
        const d = decisions[l.part_number];
        if (d === "apply") applyCost = true;
        else if (d === "keep") applyCost = false;
        else if (isOwner) {
          setCostPrompt({
            line: l,
            product,
            inward,
            oldCost,
            invoiceId: invoice.id,
            index: i,
            expected,
          });
          return;
        } else {
          setError("Cost differs — owner must approve. Saved as pending.");
          await localDb.purchase_invoices.update(invoice.id, {
            status: "PENDING_APPROVAL",
          });
          return;
        }
      }

      await postPurchaseLine({
        productId: product.id,
        partNumber: l.part_number,
        description: l.description,
        quantity: qty,
        unitCost: inward,
        applyCost,
        purchaseInvoiceId: invoice.id,
        lineNo: i + 1,
        mrp: l.mrp || null,
        uom: l.uom || "PCS",
        discPercent: l.disc_percent || 0,
        taxable: l.taxable || expected?.taxable,
        cgstPercent: expected?.cgstPercent,
        cgstAmount: expected?.cgstAmount,
        sgstPercent: expected?.sgstPercent,
        sgstAmount: expected?.sgstAmount,
        lineTotal: expected?.lineTotal,
        gstPercent: l.gst_percent,
        grossAmount: expected?.gross,
      });
    }

    setLines([emptyLine()]);
    setSupplierId("");
    setInvoiceNumber("");
    setInvoiceDate(businessDateIST());
    setPrintedTaxable("");
    setPrintedCgst("");
    setPrintedSgst("");
    setPrintedGrandTotal("");
    setHistoryKey((k) => k + 1);
    const all = await localDb.products.toArray();
    buildSearchIndex(all);
  }

  return (
    <div className="space-y-4 sm:space-y-8">
      <PageHeader title="Purchases" />
      <Card>
        <h2 className="mb-3 font-medium text-ink">New purchase entry</h2>
        <p className="mb-3 text-xs text-fog">
          Unit cost is excl. GST. Default qty is 1 and GST is 18% (9% CGST + 9%
          SGST). Pick unit as Piece (PCS) or Set, etc. Enter printed invoice totals
          to verify.
        </p>
        {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-4">
          <div>
            <Label>Supplier</Label>
            <SupplierSelect value={supplierId} onChange={setSupplierId} />
          </div>
          <div>
            <Label>Invoice no.</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <Label>Invoice date</Label>
            <Input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Printed taxable (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="From invoice"
              value={printedTaxable}
              onChange={(e) => setPrintedTaxable(e.target.value)}
            />
          </div>
          <div>
            <Label>Printed CGST (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={printedCgst}
              onChange={(e) => setPrintedCgst(e.target.value)}
            />
          </div>
          <div>
            <Label>Printed SGST (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={printedSgst}
              onChange={(e) => setPrintedSgst(e.target.value)}
            />
          </div>
          <div>
            <Label>Printed grand total (₹)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={printedGrandTotal}
              onChange={(e) => setPrintedGrandTotal(e.target.value)}
            />
          </div>
        </div>

        {totalsCheck?.hasPrintedTotals && !totalsCheck.ok ? (
          <p className="mb-3 text-sm text-warning">
            Printed totals differ from calculated (grand total diff{" "}
            {formatInr(totalsCheck.variance.grandTotal)}). Review before posting.
          </p>
        ) : null}

        {lines.map((l, idx) => (
          <div key={idx} className="mb-3 space-y-2 rounded-lg border border-ash p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-xs">Part code</Label>
                <Input
                  placeholder="Part code"
                  value={l.part_number}
                  onChange={(e) => updateLine(idx, { part_number: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="1"
                  value={l.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Unit (PCS / SET)</Label>
                <Select
                  value={l.uom}
                  onChange={(e) => updateLine(idx, { uom: e.target.value })}
                >
                  {UOM_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u === "PCS" ? "PCS — Piece" : u === "SET" ? "SET — Set" : u}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-xs">MRP (selling price)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="MRP"
                  value={l.mrp}
                  onChange={(e) => updateLine(idx, { mrp: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Unit cost excl. GST</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Cost"
                  value={l.unit_cost}
                  onChange={(e) => updateLine(idx, { unit_cost: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Disc %</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={l.disc_percent}
                  onChange={(e) => updateLine(idx, { disc_percent: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">GST % (total)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="18"
                  value={l.gst_percent}
                  onChange={(e) => updateLine(idx, { gst_percent: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Taxable (optional — from invoice)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="From invoice"
                  value={l.taxable}
                  onChange={(e) => updateLine(idx, { taxable: e.target.value })}
                />
              </div>
            </div>
            <ManualLineCalcHint line={l} />
          </div>
        ))}

        {totalsCheck ? (
          <PurchaseTotalsCheck
            data={totalsCheck}
            title="Invoice totals — printed vs calculated"
          />
        ) : null}

        <div className="flex flex-col gap-2 mt-4 sm:flex-row">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setLines([...lines, emptyLine()])}>
            Add line
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={() => post()}>Post inward</Button>
        </div>
      </Card>

      <Modal open={Boolean(costPrompt)} onClose={() => setCostPrompt(null)} title="Cost price changed">
        {costPrompt ? (
          <div className="space-y-3 text-sm">
            <p>{costPrompt.line.part_number}</p>
            <p className="text-fog">
              Old {formatInr(costPrompt.oldCost)} → New {formatInr(costPrompt.inward)}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  const exp = costPrompt.expected;
                  await postPurchaseLine({
                    productId: costPrompt.product.id,
                    partNumber: costPrompt.line.part_number,
                    description: costPrompt.line.description,
                    quantity: Number(costPrompt.line.quantity),
                    unitCost: costPrompt.inward,
                    applyCost: true,
                    purchaseInvoiceId: costPrompt.invoiceId,
                    lineNo: costPrompt.index + 1,
                    mrp: costPrompt.line.mrp || null,
                    uom: costPrompt.line.uom || "PCS",
                    discPercent: costPrompt.line.disc_percent || 0,
                    taxable: costPrompt.line.taxable || exp?.taxable,
                    cgstPercent: exp?.cgstPercent,
                    cgstAmount: exp?.cgstAmount,
                    sgstPercent: exp?.sgstPercent,
                    sgstAmount: exp?.sgstAmount,
                    lineTotal: exp?.lineTotal,
                    gstPercent: costPrompt.line.gst_percent,
                  });
                  setCostPrompt(null);
                  await post({ [costPrompt.line.part_number]: "apply" });
                }}
              >
                Update cost
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const exp = costPrompt.expected;
                  await postPurchaseLine({
                    productId: costPrompt.product.id,
                    partNumber: costPrompt.line.part_number,
                    description: costPrompt.line.description,
                    quantity: Number(costPrompt.line.quantity),
                    unitCost: costPrompt.inward,
                    applyCost: false,
                    purchaseInvoiceId: costPrompt.invoiceId,
                    lineNo: costPrompt.index + 1,
                    mrp: costPrompt.line.mrp || null,
                    uom: costPrompt.line.uom || "PCS",
                    discPercent: costPrompt.line.disc_percent || 0,
                    taxable: costPrompt.line.taxable || exp?.taxable,
                    cgstPercent: exp?.cgstPercent,
                    cgstAmount: exp?.cgstAmount,
                    sgstPercent: exp?.sgstPercent,
                    sgstAmount: exp?.sgstAmount,
                    lineTotal: exp?.lineTotal,
                    gstPercent: costPrompt.line.gst_percent,
                  });
                  setCostPrompt(null);
                  await post({ [costPrompt.line.part_number]: "keep" });
                }}
              >
                Keep existing
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <PurchaseInvoiceHistory refreshKey={historyKey} />
    </div>
  );
}
