import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { localDb } from "../../db/localDb";
import { normalizeSupplierName } from "../../lib/normalizeSupplier";
import { findOrCreateSupplier } from "../../lib/purchases";
import { FreshKeys, invalidateFresh } from "../../lib/freshSync";
import { syncSuppliersIfNeeded } from "../../lib/hybridSync";
import { Input, Label, Select } from "../ui/Input";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

function dedupeSuppliers(list) {
  const byKey = new Map();
  for (const s of list) {
    const key = (s.gstin || "").toUpperCase() || normalizeSupplierName(s.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, s);
      continue;
    }
    // Prefer row whose name matches canonical normalized form
    const canonical = normalizeSupplierName(s.name);
    if (normalizeSupplierName(existing.name) !== canonical) {
      byKey.set(key, s);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function SupplierSelect({ value, onChange, disabled }) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGstin, setNewGstin] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addError, setAddError] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      await syncSuppliersIfNeeded(force);
      const rows = dedupeSuppliers(
        await localDb.suppliers.orderBy("name").toArray(),
      );
      setSuppliers(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  async function saveNewSupplier() {
    const name = newName.trim();
    if (!name) {
      setAddError("Supplier name is required.");
      return;
    }
    const canonical = normalizeSupplierName(name);
    const existing = suppliers.find(
      (s) => normalizeSupplierName(s.name) === canonical,
    );
    if (existing) {
      onChange(existing.id);
      setAddOpen(false);
      setNewName("");
      setAddError("");
      return;
    }

    setSaving(true);
    setAddError("");
    try {
      const supplier = await findOrCreateSupplier({
        name: newName,
        gstin: newGstin,
        phone: newPhone,
        address: newAddress,
      });
      await invalidateFresh(FreshKeys.SUPPLIERS);
      await refresh(true);
      onChange(supplier.id);
      setAddOpen(false);
      setNewName("");
      setNewGstin("");
      setNewPhone("");
      setNewAddress("");
    } catch (err) {
      setAddError(err.message || "Could not save supplier.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select
          value={value || ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new__") {
              setAddOpen(true);
              return;
            }
            onChange(v);
          }}
          disabled={disabled || loading}
          className="min-w-0 flex-1"
        >
          <option value="">
            {loading ? "Loading suppliers…" : "Select supplier"}
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.gstin ? ` · ${s.gstin}` : ""}
            </option>
          ))}
          <option value="__new__">+ Add new supplier…</option>
        </Select>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 px-3"
          onClick={() => setAddOpen(true)}
          disabled={disabled}
          title="Add new supplier"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setAddError("");
        }}
        title="Add supplier"
      >
        <div className="space-y-3 text-sm">
          {addError ? <p className="text-danger">{addError}</p> : null}
          <div>
            <Label>Name *</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Kumar Auto Stores"
              autoFocus
            />
          </div>
          <div>
            <Label>GSTIN</Label>
            <Input
              value={newGstin}
              onChange={(e) => setNewGstin(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <Label>Address</Label>
            <Input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" disabled={saving} onClick={saveNewSupplier}>
              {saving ? "Saving…" : "Save supplier"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
