import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { parsePurchaseWorkbooks } from "../../lib/parsePurchaseExcel";
import { localDb } from "../../db/localDb";
import { supabase } from "../../lib/supabaseClient";
import {
  createPurchaseInvoice,
  postPurchaseLine,
  findPurchaseInvoiceDuplicateBySupplierName,
  findOrCreateSupplier,
  setSellingPriceFromMrp,
} from "../../lib/purchases";
import {
  downloadParsedPurchaseExcel,
  downloadParsedPurchasePdf,
} from "../../lib/exportDownload";
import { formatInr, formatQty, toNum } from "../../lib/format";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";
import { Modal } from "../ui/Modal";
import { DownloadActions } from "../shared/DownloadActions";
import { catalogGetByPart, catalogPut, catalogForIndex } from "../../db/catalogSqlite";
import { upsertSearchProduct, rebuildSearchIndex } from "../../lib/searchClient";
import { hydrateProducts } from "../../lib/productHydrate";
import { FreshKeys, invalidateFresh, markFresh } from "../../lib/freshSync";
import { PurchaseInvoiceHistory } from "./PurchaseInvoiceHistory";
import { PurchaseTotalsCheck } from "./PurchaseTotalsCheck";
import { compareInvoiceCalculation } from "../../lib/purchaseCalculations";
import { PageHeader } from "../shared/PageHeader";

export function ExcelImport({ profile, isOwner }) {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [parsedQueue, setParsedQueue] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [shop, setShop] = useState(null);
  const [error, setError] = useState("");
  const [costPrompt, setCostPrompt] = useState(null);
  const [mrpPrompt, setMrpPrompt] = useState(null);
  const [mrpInput, setMrpInput] = useState("");
  const [activeImport, setActiveImport] = useState(null);
  const [pending, setPending] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [importState, setImportState] = useState(null);

  useEffect(() => {
    localDb.shop_settings.get("default").then(setShop);
  }, []);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setImportState(null);
    setActiveImport(null);
    setParsedQueue([]);
    setPreviewIndex(0);
    try {
      const buffer = await file.arrayBuffer();
      const parsedList = parsePurchaseWorkbooks(buffer);
      if (!parsedList.length) {
        throw new Error("No invoices found in file.");
      }

      const duplicates = [];
      for (const parsed of parsedList) {
        const duplicate = await findPurchaseInvoiceDuplicateBySupplierName(
          parsed.supplier.name,
          parsed.invoiceNumber,
          parsed.supplier,
        );
        if (duplicate) duplicates.push(parsed.invoiceNumber);
      }
      if (duplicates.length) {
        setPreview(null);
        setParsedQueue([]);
        setError(
          `Duplicate invoice(s): ${duplicates.join(", ")} already imported.`,
        );
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      setParsedQueue(parsedList);
      setPreviewIndex(0);
      setPreview(parsedList[0]);
    } catch (err) {
      setError(err.message || "Could not read file.");
    }
  }

  function effectiveMrp(line, mrpOverrides) {
    const override = mrpOverrides[line.code];
    if (override != null && toNum(override) > 0) return String(override);
    return line.mrp;
  }

  async function resolveProduct(code, description, inwardCost, mrp, brand) {
    const sell = toNum(mrp);
    let product = await catalogGetByPart(code.toUpperCase());
    if (!product && supabase) {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("part_number", code.toUpperCase())
        .maybeSingle();
      product = data;
      if (data) {
        await catalogPut(data);
        upsertSearchProduct(data);
      }
    }
    if (!product) {
      const newP = {
        id: crypto.randomUUID(),
        part_number: code.toUpperCase(),
        name: description,
        purchase_price: inwardCost,
        selling_price: sell,
        stock_quantity: 0,
        min_stock_alert: 5,
        vehicle_compatibility: [],
        uom: "PCS",
        brand: brand?.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (supabase && navigator.onLine) {
        const { data, error: err } = await supabase
          .from("products")
          .insert(newP)
          .select()
          .single();
        if (err) throw err;
        product = data;
      } else {
        product = newP;
      }
      await catalogPut(product);
      upsertSearchProduct(product);
    }
    return product;
  }

  async function processLine(line, invoiceId, costDecisions, mrpOverrides) {
    const inwardCost = Number(line.rate) || 0;
    const qty = Number(line.qty) || 0;
    const mrp = effectiveMrp(line, mrpOverrides);

    if (toNum(mrp) <= 0) {
      return { needsMrpPrompt: true, line, inwardCost };
    }

    const product = await resolveProduct(
      line.code,
      line.description,
      inwardCost,
      mrp,
      line.brand,
    );
    await setSellingPriceFromMrp(product.id, mrp);

    const oldCost = Number(product.purchase_price) || 0;
    let applyCost = null;
    if (inwardCost !== oldCost) {
      const decision = costDecisions?.[line.code];
      if (decision === "apply") applyCost = true;
      else if (decision === "keep") applyCost = false;
      else if (!isOwner) return { pending: true, line, product, inwardCost, oldCost };
      else return { needsPrompt: true, line, product, inwardCost, oldCost };
    }

    await postPurchaseLine({
      productId: product.id,
      partNumber: line.code,
      description: line.description,
      quantity: qty,
      unitCost: inwardCost,
      applyCost,
      purchaseInvoiceId: invoiceId,
      lineNo: line.lineNo,
      hsn: line.hsn,
      brand: line.brand,
      uom: line.uom,
      mrp,
      discPercent: line.discPercent,
      disc2Percent: line.disc2Percent,
      taxable: line.taxable,
      cgstPercent: line.cgstPercent,
      cgstAmount: line.cgstAmount,
      sgstPercent: line.sgstPercent,
      sgstAmount: line.sgstAmount,
      lineTotal: line.lineTotal,
      grossAmount: line.grossAmount,
      gstPercent: line.gstPercent,
      rawData: line.rawData,
    });
    return { done: true };
  }

  async function importAll(costDecisions = {}, mrpOverrides = {}) {
    if (!preview) return;
    setPending(true);
    setError("");
    setImportState({ phase: "preparing" });
    try {
      let invoiceId = activeImport?.invoiceId;
      let mergedCost = { ...(activeImport?.costDecisions ?? {}), ...costDecisions };
      let mergedMrp = { ...(activeImport?.mrpOverrides ?? {}), ...mrpOverrides };

      if (!invoiceId) {
        const duplicate = await findPurchaseInvoiceDuplicateBySupplierName(
          preview.supplier.name,
          preview.invoiceNumber,
          preview.supplier,
        );
        if (duplicate) {
          throw new Error(
            `Duplicate invoice: ${preview.invoiceNumber} from ${preview.supplier.name} was already imported on ${duplicate.invoice_date}.`,
          );
        }

        const supplier = await findOrCreateSupplier(preview.supplier);

        const status = isOwner ? "POSTED" : "PENDING_APPROVAL";
        const invoice = await createPurchaseInvoice({
          supplierId: supplier.id,
          invoiceNumber: preview.invoiceNumber || `IMP-${Date.now()}`,
          invoiceDate: preview.invoiceDate,
          createdBy: profile.id,
          status,
          source: "EXCEL",
          notes: preview.notes,
          invoiceType: preview.invoiceType,
          printedSubTotal: preview.printedSubTotal,
          printedDiscount: preview.printedDiscount,
          printedTaxable: preview.printedTaxable,
          printedCgst: preview.printedCgst,
          printedSgst: preview.printedSgst,
          printedGrandTotal: preview.printedGrandTotal,
        });
        invoiceId = invoice.id;
      }

      setActiveImport({
        invoiceId,
        costDecisions: mergedCost,
        mrpOverrides: mergedMrp,
      });

      const posted = await localDb.purchase_lines
        .where("purchase_invoice_id")
        .equals(invoiceId)
        .toArray();
      const postedNos = new Set(posted.map((l) => l.line_no));
      const linesToRun = preview.lines.filter((l) => !postedNos.has(l.lineNo));
      const totalLines = preview.lines.length;

      const pendingLines = [];
      for (const line of linesToRun) {
        const overallIdx =
          preview.lines.findIndex((l) => l.lineNo === line.lineNo) + 1;
        setImportState({
          phase: "processing",
          current: overallIdx,
          total: totalLines,
          invoiceNumber: preview.invoiceNumber,
          label: line.description || line.code,
          fileInvoiceIndex: previewIndex + 1,
          fileInvoiceTotal: parsedQueue.length,
        });

        const result = await processLine(
          line,
          invoiceId,
          mergedCost,
          mergedMrp,
        );

        if (result?.needsMrpPrompt) {
          setMrpPrompt({
            line,
            inwardCost: result.inwardCost,
          });
          setMrpInput("");
          setPending(false);
          return;
        }

        if (result?.needsPrompt && isOwner) {
          setCostPrompt({
            line,
            product: result.product,
            inwardCost: result.inwardCost,
            oldCost: result.oldCost,
          });
          setPending(false);
          return;
        }
        if (result?.pending) pendingLines.push(result);
      }

      const invoice = await localDb.purchase_invoices.get(invoiceId);
      const hasMoreInFile = previewIndex + 1 < parsedQueue.length;

      if (pendingLines.length && !isOwner) {
        await localDb.purchase_invoices.update(invoiceId, {
          status: "PENDING_APPROVAL",
        });
        setError("Some lines need owner cost approval. Invoice saved as pending.");
      }

      if (hasMoreInFile) {
        const nextIdx = previewIndex + 1;
        setPreviewIndex(nextIdx);
        setPreview(parsedQueue[nextIdx]);
        setActiveImport(null);
        setPending(false);
        await importAll();
        return;
      }

      const totalLinesAll = parsedQueue.reduce((s, p) => s + p.lines.length, 0);
      setImportState({
        phase: "done",
        invoiceNumber:
          parsedQueue.length > 1
            ? `${parsedQueue.length} invoices`
            : invoice?.invoice_number ?? preview.invoiceNumber,
        lineCount: totalLinesAll,
        supplier: preview.supplier.name,
        warning: pendingLines.length > 0 && !isOwner,
        invoiceCount: parsedQueue.length,
      });

      setPreview(null);
      setParsedQueue([]);
      setPreviewIndex(0);
      setActiveImport(null);
      setMrpPrompt(null);
      setCostPrompt(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setHistoryKey((k) => k + 1);

      await hydrateProducts();
      await markFresh(FreshKeys.PRODUCTS);
      await invalidateFresh(FreshKeys.PURCHASES, FreshKeys.DASHBOARD);
      const chunks = await catalogForIndex();
      await rebuildSearchIndex(chunks);
    } catch (err) {
      setError(err.message || "Import failed.");
      setImportState(null);
      setActiveImport(null);
    } finally {
      setPending(false);
    }
  }

  async function onMrpSubmit() {
    if (!mrpPrompt || !activeImport) return;
    const val = toNum(mrpInput);
    if (val <= 0) {
      setError("Enter a valid selling price (MRP) in ₹.");
      return;
    }
    setError("");
    const nextMrp = {
      ...activeImport.mrpOverrides,
      [mrpPrompt.line.code]: val,
    };
    setMrpPrompt(null);
    setMrpInput("");
    await importAll(activeImport.costDecisions, nextMrp);
  }

  async function onCostDecision(apply) {
    if (!costPrompt || !activeImport) return;
    const { line, product, inwardCost } = costPrompt;
    const mrp = effectiveMrp(line, activeImport.mrpOverrides);
    const nextCost = {
      ...activeImport.costDecisions,
      [line.code]: apply ? "apply" : "keep",
    };

    await postPurchaseLine({
      productId: product.id,
      partNumber: line.code,
      description: line.description,
      quantity: Number(line.qty),
      unitCost: inwardCost,
      applyCost: apply,
      purchaseInvoiceId: activeImport.invoiceId,
      lineNo: line.lineNo,
      hsn: line.hsn,
      brand: line.brand,
      uom: line.uom,
      mrp,
      discPercent: line.discPercent,
      disc2Percent: line.disc2Percent,
      taxable: line.taxable,
      cgstPercent: line.cgstPercent,
      cgstAmount: line.cgstAmount,
      sgstPercent: line.sgstPercent,
      sgstAmount: line.sgstAmount,
      lineTotal: line.lineTotal,
      grossAmount: line.grossAmount,
      gstPercent: line.gstPercent,
      rawData: line.rawData,
    });
    setCostPrompt(null);
    await importAll(nextCost, activeImport.mrpOverrides);
  }

  const progressPct =
    importState?.phase === "processing" && importState.total
      ? Math.round((importState.current / importState.total) * 100)
      : 0;

  const missingMrpCount =
    preview?.lines.filter((l) => toNum(l.mrp) <= 0).length ?? 0;

  const previewTotalsCheck = preview
    ? compareInvoiceCalculation(preview)
    : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Excel import"
        description="Upload one supplier invoice at a time. Selling price is taken from MRP on each line — you will be asked if MRP is missing."
      />

      <Card>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ash p-6 transition-colors hover:border-smoke hover:bg-paper">
          <Upload className="h-8 w-8 shrink-0 text-fog" />
          <div>
            <p className="font-medium text-ink">Choose Excel file</p>
            <p className="text-xs text-fog">.xlsx, .xls, or .csv</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFile}
            className="hidden"
            disabled={pending}
          />
        </label>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </Card>

      {importState?.phase === "preparing" ? (
        <Card className="border-smoke">
          <p className="text-sm text-fog">Preparing invoice…</p>
        </Card>
      ) : null}

      {importState?.phase === "processing" ? (
        <Card className="border-smoke">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-fog animate-pulse" />
            <p className="font-medium text-ink">
              Importing {importState.invoiceNumber}
            </p>
          </div>
          <p className="mt-2 text-sm text-fog">
            Line {importState.current} of {importState.total}
          </p>
          {importState.label ? (
            <p className="mt-1 truncate text-xs text-silver">
              {importState.label}
            </p>
          ) : null}
          {importState.fileInvoiceTotal > 1 ? (
            <p className="mt-0.5 text-xs text-silver">
              File invoice {importState.fileInvoiceIndex} of{" "}
              {importState.fileInvoiceTotal}
            </p>
          ) : null}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper">
            <div
              className="h-full rounded-full bg-white transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-right text-xs tabular-nums text-silver">
            {progressPct}%
          </p>
        </Card>
      ) : null}

      {importState?.phase === "done" ? (
        <Card className="border-success/40 bg-success/10">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-success">Done!</p>
              <p className="mt-1 text-sm text-ink">
                <span className="font-mono">{importState.invoiceNumber}</span>
                posted for {importState.supplier}
              </p>
              <p className="text-sm text-fog">
                {importState.lineCount} lines imported
                {importState.invoiceCount > 1
                  ? ` · ${importState.invoiceCount} invoices`
                  : " · stock updated"}
              </p>
              {importState.warning ? (
                <p className="mt-2 text-sm text-warning">
                  Some lines need owner approval for cost changes.
                </p>
              ) : null}
              <Button
                variant="secondary"
                className="mt-3 text-xs"
                onClick={() => {
                  setImportState(null);
                  fileInputRef.current?.click();
                }}
              >
                Upload next invoice
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {preview ? (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-medium text-ink">{preview.supplier.name}</p>
              <p className="text-sm text-fog">
                {preview.invoiceNumber} · {preview.invoiceDate} ·{" "}
                {preview.lines.length} lines
              </p>
            </div>
            <DownloadActions
              className="shrink-0"
              onExcel={() => downloadParsedPurchaseExcel(preview, shop)}
              onPdf={() => downloadParsedPurchasePdf(preview, shop)}
            />
          </div>
          {previewTotalsCheck && !previewTotalsCheck.ok ? (
            <p className="mt-2 text-sm text-warning">
              Printed invoice totals differ from line calculations — review
              variance below before importing.
            </p>
          ) : null}
          {parsedQueue.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {parsedQueue.map((p, idx) => (
                <button
                  key={p.invoiceNumber}
                  type="button"
                  onClick={() => {
                    setPreviewIndex(idx);
                    setPreview(p);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-mono transition-colors ${
                    idx === previewIndex
                      ? "bg-action text-canvas"
                      : "bg-paper text-fog hover:text-ink"
                  }`}
                >
                  {p.invoiceNumber} ({p.lines.length})
                </button>
              ))}
              <p className="text-xs text-silver self-center">
                {parsedQueue.length} invoices in this file — all will import
              </p>
            </div>
          ) : null}
          {missingMrpCount > 0 ? (
            <p className="mt-2 text-sm text-warning">
              {missingMrpCount} line(s) have no MRP — you will be asked for
              selling price during import.
            </p>
          ) : null}
          {previewTotalsCheck ? (
            <div className="mt-4">
              <PurchaseTotalsCheck
                data={previewTotalsCheck}
                title="Printed on invoice vs calculated from lines"
              />
            </div>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-canvas text-fog shadow-[0_1px_0_0_#e5e5e5]">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Code</th>
                  <th className="px-2 py-1.5 font-semibold">Description</th>
                  <th className="px-2 py-1.5 font-semibold">Brand</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                  <th className="px-2 py-1.5 text-right font-semibold">UOM</th>
                  <th className="px-2 py-1.5 text-right font-semibold">MRP</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Cost</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Disc %</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Taxable</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.lineNo} className="border-t border-ash">
                    <td className="px-2 py-1 font-mono text-xs">{l.code}</td>
                    <td className="px-2 py-1 max-w-[200px] truncate">{l.description}</td>
                    <td className="px-2 py-1 text-xs text-fog">
                      {l.brand || "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatQty(l.qty)}
                    </td>
                    <td className="px-2 py-1 text-right text-xs text-fog">
                      {l.uom || "PCS"}
                    </td>
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${
                        toNum(l.mrp) <= 0 ? "text-warning font-medium" : ""
                      }`}
                    >
                      {toNum(l.mrp) > 0 ? formatInr(l.mrp) : "Missing"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatInr(l.rate)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {l.discPercent ? `${l.discPercent}%` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatInr(l.taxable)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">
                      {l.lineTotal ? formatInr(l.lineTotal) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            className="mt-4"
            disabled={pending}
            onClick={() => importAll()}
          >
            {pending
              ? "Importing…"
              : parsedQueue.length > 1
                ? `Post ${parsedQueue.length} invoices & update stock`
                : "Post and update stock"}
          </Button>
        </Card>
      ) : null}

      <Modal
        open={Boolean(mrpPrompt)}
        onClose={() => setMrpPrompt(null)}
        title="MRP missing — enter selling price"
      >
        {mrpPrompt ? (
          <div className="space-y-3 text-sm">
            <p className="text-ink">{mrpPrompt.line.description}</p>
            <p className="font-mono text-xs text-fog">
              {mrpPrompt.line.code}
            </p>
            <p className="text-fog">
              This line has no MRP on the invoice. Enter the selling price for
              POS (purchase cost: {formatInr(mrpPrompt.inwardCost)}).
            </p>
            <div>
              <Label>Selling price / MRP (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="mt-1"
                value={mrpInput}
                onChange={(e) => setMrpInput(e.target.value)}
                placeholder="e.g. 150"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={onMrpSubmit}>Continue import</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setMrpPrompt(null);
                  setActiveImport(null);
                  setImportState(null);
                  setError("Import cancelled.");
                }}
              >
                Cancel import
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(costPrompt)}
        onClose={() => setCostPrompt(null)}
        title="Cost price changed"
      >
        {costPrompt ? (
          <div className="space-y-3 text-sm">
            <p className="text-ink">{costPrompt.line.description}</p>
            <p className="text-fog">
              Old cost: {formatInr(costPrompt.oldCost)} → New:{" "}
              {formatInr(costPrompt.inwardCost)}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => onCostDecision(true)}>Update cost</Button>
              <Button variant="secondary" onClick={() => onCostDecision(false)}>
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
