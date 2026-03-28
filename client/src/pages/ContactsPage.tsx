import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Plus, Upload, Trash2, Edit2, Search, BookUser, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import { format } from "date-fns";

interface Contact {
  id: number;
  phone_number: string;
  name: string | null;
  source: "manual" | "imported" | "whatsapp";
  created_at: string;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    manual: "bg-blue-100 text-blue-700",
    imported: "bg-purple-100 text-purple-700",
    whatsapp: "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[source] ?? "bg-muted text-muted-foreground"}`}>
      {source}
    </span>
  );
}

// Simple RFC-4180 CSV parser — handles quoted fields with embedded commas/newlines
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };
  const headers = parseRow(lines[0]).map(h => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).filter(l => l.trim()).map(parseRow);
  return { headers, rows };
}

function detectColumns(headers: string[]): { nameIdx: number | null; phoneIdx: number | null } {
  const lower = headers.map(h => h.toLowerCase());
  const nameIdx = lower.findIndex(h => /name|first|last|contact/.test(h));
  const phoneIdx = lower.findIndex(h => /phone|mobile|number|tel|whatsapp|cell/.test(h));
  return { nameIdx: nameIdx >= 0 ? nameIdx : null, phoneIdx: phoneIdx >= 0 ? phoneIdx : null };
}

export default function ContactsPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin } = useAuth();
  const { t } = useLanguage();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", phone: "+966" });
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  // Edit modal
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editName, setEditName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // CSV import modal
  const [showImport, setShowImport] = useState(false);
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [nameColIdx, setNameColIdx] = useState<number | null>(null);
  const [phoneColIdx, setPhoneColIdx] = useState<number | null>(null);
  const [importSaving, setImportSaving] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; duplicates: number; invalid: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bulkDeleting, setBulkDeleting] = useState(false);

  // All hooks before early returns
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
    if (!isAuthLoading && isAuthenticated && !isAdmin) setLocation("/");
  }, [isAuthLoading, isAuthenticated, isAdmin, setLocation]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/contacts", { credentials: "include" });
      if (res.ok) setContacts(await res.json());
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (isAuthenticated && isAdmin) fetchContacts();
  }, [isAuthenticated, isAdmin, fetchContacts]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const filtered = search.trim()
    ? contacts.filter(c =>
        c.phone_number.includes(search) ||
        (c.name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : contacts;

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));

  const toggleSelectAll = () => {
    setSelected(prev => {
      const n = new Set(prev);
      if (allSelected) filtered.forEach(c => n.delete(c.id));
      else filtered.forEach(c => n.add(c.id));
      return n;
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(""); setAddSaving(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addForm.name, phone_number: addForm.phone }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.message === "duplicate") setAddError(t("contactsErrorDuplicate"));
        else if (body.message === "invalid_phone") setAddError(t("contactsErrorInvalidPhone"));
        else setAddError(body.message || "Failed to add contact");
        return;
      }
      setShowAdd(false);
      setAddForm({ name: "", phone: "+966" });
      fetchContacts();
    } catch (_) {
      setAddError("Network error");
    } finally {
      setAddSaving(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editContact) return;
    setEditSaving(true); setEditError("");
    try {
      const res = await fetch(`/api/contacts/${editContact.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      if (!res.ok) { const b = await res.json(); setEditError(b.message || "Failed"); return; }
      setEditContact(null);
      fetchContacts();
    } catch (_) {
      setEditError("Network error");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t("contactsDeleteConfirm"))) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE", credentials: "include" });
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    fetchContacts();
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(t("contactsBulkDeleteConfirm").replace("{n}", String(ids.length)))) return;
    setBulkDeleting(true);
    try {
      await fetch("/api/contacts/bulk-delete", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      setSelected(new Set());
      fetchContacts();
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const data = parseCSV(text);
      setCsvData(data);
      setImportResult(null);
      const { nameIdx, phoneIdx } = detectColumns(data.headers);
      setNameColIdx(nameIdx);
      setPhoneColIdx(phoneIdx);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImport = async () => {
    if (!csvData || phoneColIdx === null) return;
    setImportSaving(true);
    const rows = csvData.rows.map(row => ({
      name: nameColIdx !== null ? (row[nameColIdx] ?? "") : "",
      phone: row[phoneColIdx] ?? "",
    }));
    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: rows }),
      });
      if (res.ok) {
        setImportResult(await res.json());
        fetchContacts();
      }
    } finally {
      setImportSaving(false);
    }
  };

  const closeImport = () => {
    setShowImport(false);
    setCsvData(null);
    setImportResult(null);
    setNameColIdx(null);
    setPhoneColIdx(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="h-14 bg-[#0F510F] text-white flex items-center justify-between px-5 flex-shrink-0 shadow-md">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="WAK Solutions" className="h-[36px] shrink-0" />
          <span className="hidden sm:block font-semibold text-sm text-white/90">WAK Solutions</span>
          <span className="hidden sm:block text-white/40">—</span>
          <span className="hidden sm:block text-sm text-white/70">{t("contactsTitle")}</span>
        </div>
        <Link href="/">
          <a className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-white/10">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("dashboard")}</span>
          </a>
        </Link>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-4 pb-8">
        {/* Title + action buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <BookUser className="w-5 h-5 text-[#0F510F]" />
            <h1 className="text-xl font-bold text-foreground">{t("contactsTitle")}</h1>
            <span className="text-sm text-muted-foreground ml-1">
              {contacts.length} {t("contactsTotal")}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.size > 0 && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-60 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {t("contactsBulkDelete")} ({selected.size})
              </button>
            )}
            <button
              onClick={() => { setShowImport(true); setCsvData(null); setImportResult(null); }}
              className="flex items-center gap-1.5 px-4 py-2 border border-[#0F510F] text-[#0F510F] rounded-xl text-sm font-semibold hover:bg-[#0F510F]/5 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {t("contactsImport")}
            </button>
            <button
              onClick={() => { setShowAdd(true); setAddError(""); setAddForm({ name: "", phone: "+966" }); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("contactsAdd")}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("contactsSearch")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:border-[#0F510F] transition-colors"
          />
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-[#0F510F]/20 border-t-[#0F510F] rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-border cursor-pointer"
                        aria-label={t("contactsSelectAll")}
                      />
                    </th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("contactsColName")}</th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("contactsColPhone")}</th>
                    <th className="hidden sm:table-cell text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("contactsColSource")}</th>
                    <th className="hidden md:table-cell text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("contactsColAdded")}</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("contactsColActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(contact => (
                    <tr key={contact.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(contact.id)}
                          onChange={() => setSelected(prev => {
                            const n = new Set(prev);
                            n.has(contact.id) ? n.delete(contact.id) : n.add(contact.id);
                            return n;
                          })}
                          className="rounded border-border cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-foreground">
                        {contact.name || <span className="text-muted-foreground italic text-xs">{t("contactsUnknown")}</span>}
                      </td>
                      <td className="px-3 py-3 font-mono text-sm text-foreground">{contact.phone_number}</td>
                      <td className="hidden sm:table-cell px-3 py-3">
                        <SourceBadge source={contact.source} />
                      </td>
                      <td className="hidden md:table-cell px-3 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {format(new Date(contact.created_at), "MMM d, yyyy")}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditContact(contact); setEditName(contact.name ?? ""); setEditError(""); }}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Edit name"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(contact.id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                        {search ? t("contactsNoResults") : t("contactsNoContacts")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Add Contact Modal */}
      {showAdd && (
        <Modal title={t("contactsModalAddTitle")} onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{t("contactsFormName")}</label>
              <input
                type="text"
                placeholder="Jane Smith"
                value={addForm.name}
                onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{t("contactsFormPhone")}</label>
              <input
                type="tel"
                required
                inputMode="tel"
                placeholder={t("contactsFormPhonePlaceholder")}
                value={addForm.phone}
                onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#0F510F]"
              />
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <button
              type="submit"
              disabled={addSaving}
              className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors"
            >
              {addSaving ? t("saving") : t("contactsBtnAdd")}
            </button>
          </form>
        </Modal>
      )}

      {/* Edit Contact Modal */}
      {editContact && (
        <Modal title={t("contactsModalEditTitle")} onClose={() => setEditContact(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{t("contactsColPhone")}</label>
              <p className="text-sm font-mono text-muted-foreground bg-muted px-3 py-2 rounded-xl">{editContact.phone_number}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">{t("contactsFormName")}</label>
              <input
                type="text"
                autoFocus
                placeholder="Jane Smith"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0F510F]"
              />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <button
              type="submit"
              disabled={editSaving}
              className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors"
            >
              {editSaving ? t("saving") : t("contactsBtnSave")}
            </button>
          </form>
        </Modal>
      )}

      {/* CSV Import Modal */}
      {showImport && (
        <Modal title={t("contactsImportTitle")} onClose={closeImport}>
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />

            {!csvData ? (
              /* Step 1: pick file */
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-xl py-10 flex flex-col items-center gap-2 text-muted-foreground hover:border-[#0F510F]/50 hover:text-[#0F510F] transition-colors"
              >
                <Upload className="w-7 h-7" />
                <span className="text-sm font-medium">{t("contactsImportDrop")}</span>
                <span className="text-xs text-muted-foreground">Name and Phone columns</span>
              </button>
            ) : importResult ? (
              /* Step 3: summary */
              <div className="space-y-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-green-800 mb-2">Import complete</p>
                  <p className="text-sm text-green-700">
                    {t("contactsImportSummary")
                      .replace("{added}", String(importResult.added))
                      .replace("{dupes}", String(importResult.duplicates))
                      .replace("{invalid}", String(importResult.invalid))}
                  </p>
                </div>
                <button onClick={closeImport} className="w-full py-2.5 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] transition-colors">
                  {t("agentsBtnDone")}
                </button>
              </div>
            ) : (
              /* Step 2: map columns + preview */
              <div className="space-y-4">
                {/* Column mapping */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("contactsImportColPhone")} *</label>
                    <select
                      value={phoneColIdx ?? ""}
                      onChange={e => setPhoneColIdx(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#0F510F]"
                    >
                      <option value="">— select —</option>
                      {csvData.headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("contactsImportColName")}</label>
                    <select
                      value={nameColIdx ?? ""}
                      onChange={e => setNameColIdx(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#0F510F]"
                    >
                      <option value="">— optional —</option>
                      {csvData.headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Preview table */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {t("contactsImportPreview")}
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 border-b border-border">
                        <tr>
                          {csvData.headers.map((h, i) => (
                            <th
                              key={i}
                              className={`text-left px-2 py-1.5 font-semibold whitespace-nowrap ${
                                i === phoneColIdx ? "text-[#0F510F]" : i === nameColIdx ? "text-blue-600" : "text-muted-foreground"
                              }`}
                            >
                              {h || `Col ${i + 1}`}
                              {i === phoneColIdx && " ✓"}
                              {i === nameColIdx && " ✓"}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvData.rows.slice(0, 5).map((row, ri) => (
                          <tr key={ri} className="border-b border-border/50 last:border-0">
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-2 py-1.5 text-foreground/80 font-mono max-w-[120px] truncate">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">{csvData.rows.length} rows total</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-2 border border-border rounded-xl text-sm font-medium hover:bg-muted transition-colors"
                  >
                    Change file
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importSaving || phoneColIdx === null}
                    className="flex-[2] py-2 bg-[#0F510F] text-white rounded-xl text-sm font-semibold hover:bg-[#0d4510] disabled:opacity-60 transition-colors"
                  >
                    {importSaving
                      ? t("contactsImporting")
                      : `${t("contactsImportConfirm")} (${csvData.rows.length})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
