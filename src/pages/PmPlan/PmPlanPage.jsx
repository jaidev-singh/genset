// PmPlanPage.jsx
// Spreadsheet-style PM Plan register.
// Columns: PM No. | Date | Site ID | Site Name | District | KVA | Type | Plan Type | AMC | Customer | Phone | Status | Remarks
// + New button → slide-in form with site autocomplete
// + Upload Excel button → PmPlanUpload component

import { useState, useMemo, useRef, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase"
import PmPlanUpload from "./PmPlanUpload"
import * as XLSX from "xlsx"

// ── constants ───────────────────────────────────────────────────────────────
const SERVICE_TYPES = ["PM Service", "Top Up", "PM Visit"]
const PLAN_TYPES    = ["Customer", "Internal"]
const AMC_TYPES     = ["AMC", "Non-AMC"]
const FOLD_STATUSES = ["In-fold", "Out-fold"]
const STATUSES      = ["Pending", "Assigned", "Done", "Cancelled"]

const STATUS_STYLE = {
  Pending:   { bg: "#eff6ff", color: "#1d4ed8" },
  Assigned:  { bg: "#fef9c3", color: "#854d0e" },
  Done:      { bg: "#f0fdf4", color: "#15803d" },
  Cancelled: { bg: "#fef2f2", color: "#dc2626" },
}

const monthStr = m => m.toString().padStart(2, "0")
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const now = new Date()
const EMPTY_FORM = {
  pm_request_number: "",
  planned_date: localDate(),
  service_type: "PM Service",
  plan_type: "Customer",
  amc_type: "AMC",
  fold_status: "",
  status: "Pending",
  remarks: "",
  // site lookup
  site_id_fk: null,   // UUID FK
  site_id_text: "",   // display text
}

const norm = s => (s ?? "").toString().toLowerCase()

function Badge({ status }) {
  const s = STATUS_STYLE[status] ?? { bg: "#f3f4f6", color: "#374151" }
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 8px", borderRadius: 20, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>
      {status}
    </span>
  )
}

// ── main component ──────────────────────────────────────────────────────────
export default function PmPlanPage() {
  const qc = useQueryClient()

  // view state
  const [showUpload, setShowUpload] = useState(false)
  const [panel, setPanel] = useState(null)   // null | { mode: "new"|"edit", row? }
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState("")

  // filters
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1)
  const [filterYear,  setFilterYear]  = useState(now.getFullYear())
  const [filterStatus, setFilterStatus] = useState("all")
  const [filterType,   setFilterType]   = useState("all")
  const [search, setSearch] = useState("")

  // form state
  const [form, setForm] = useState(EMPTY_FORM)
  const set = f => e => setForm(p => ({ ...p, [f]: e.target.value }))

  // site autocomplete
  const [siteQuery, setSiteQuery] = useState("")
  const [siteSuggestions, setSiteSuggestions] = useState([])
  const [siteInfo, setSiteInfo] = useState(null)   // full site obj
  const [dropRect, setDropRect] = useState(null)
  const siteInputRef = useRef(null)

  // ── fetch all sites (for autocomplete) ─────────────────────────────────
  const { data: allSites = [] } = useQuery({
    queryKey: ["sites-pmplan"],
    queryFn: async () => {
      const all = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from("sites")
          .select("id, site_id, name, site_location, engine_serial_no, kva, contact_person, contact_phone, office_id")
          .order("site_id")
          .range(from, from + 999)
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
        from += 1000
      }
      return all
    },
    staleTime: 300000,
  })

  const handleSiteInput = useCallback((val) => {
    setSiteQuery(val)
    setForm(p => ({ ...p, site_id_fk: null, site_id_text: val }))
    setSiteInfo(null)
    if (val.length < 1) { setSiteSuggestions([]); return }
    const q = norm(val)
    const matches = allSites.filter(s =>
      norm(s.site_id).includes(q) ||
      norm(s.name).includes(q) ||
      norm(s.engine_serial_no).includes(q) ||
      norm(s.site_location).includes(q)
    ).slice(0, 8)
    setSiteSuggestions(matches)
    // position fixed dropdown
    if (siteInputRef.current) {
      const r = siteInputRef.current.getBoundingClientRect()
      setDropRect({ top: r.bottom + window.scrollY, left: r.left, width: r.width })
    }
  }, [allSites])

  const pickSite = (site) => {
    setSiteQuery(site.site_id + (site.name ? ` · ${site.name}` : ""))
    setForm(p => ({ ...p, site_id_fk: site.id, site_id_text: site.site_id }))
    setSiteInfo(site)
    setSiteSuggestions([])
  }

  // ── fetch pm_plan for the selected month ────────────────────────────────
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["pm-plans-page", filterYear, filterMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pm_plan")
        .select(`id, pm_request_number, planned_date, service_type, plan_type, amc_type,
                 fold_status, status, done_date, remarks, month, year, assigned_to,
                 sites(id, site_id, name, site_location, kva, contact_person, contact_phone),
                 technicians(name)`)
        .eq("month", filterMonth)
        .eq("year", filterYear)
        .order("planned_date")
      if (error) throw error
      return data
    },
    staleTime: 0,
  })

  // ── apply filters ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return plans.filter(p => {
      if (filterStatus !== "all" && p.status !== filterStatus) return false
      if (filterType   !== "all" && p.service_type !== filterType) return false
      if (search) {
        const q = norm(search)
        if (!norm(p.pm_request_number).includes(q) &&
            !norm(p.sites?.site_id).includes(q) &&
            !norm(p.sites?.name).includes(q) &&
            !norm(p.sites?.site_location).includes(q)) return false
      }
      return true
    })
  }, [plans, filterStatus, filterType, search])

  // ── month navigation ────────────────────────────────────────────────────
  const prevMonth = () => {
    if (filterMonth === 1) { setFilterMonth(12); setFilterYear(y => y - 1) }
    else setFilterMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (filterMonth === 12) { setFilterMonth(1); setFilterYear(y => y + 1) }
    else setFilterMonth(m => m + 1)
  }
  // ── excel export ─────────────────────────────────────────────────────────
  const exportExcel = () => {
    const headers = ["#", "PM No.", "Date", "Status", "Site ID", "Site Name", "District",
      "KVA", "Type", "Plan", "AMC", "Customer", "Phone", "Technician", "Done Date", "Remarks"]
    const data = [headers, ...filtered.map((p, i) => [
      i + 1,
      p.pm_request_number ?? "",
      p.planned_date ?? "",
      p.status,
      p.sites?.site_id ?? "",
      p.sites?.name ?? "",
      p.sites?.site_location ?? "",
      p.sites?.kva ?? "",
      p.service_type ?? "",
      p.plan_type ?? "",
      p.amc_type ?? "",
      p.sites?.contact_person ?? "",
      p.sites?.contact_phone ?? "",
      p.technicians?.name ?? "",
      p.done_date ?? "",
      p.remarks ?? "",
    ])]
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "PM Plan")
    XLSX.writeFile(wb, `pm-plan-${MONTHS[filterMonth-1]}-${filterYear}.xlsx`)
  }
  // ── open panel ──────────────────────────────────────────────────────────
  const openNew = () => {
    setForm(EMPTY_FORM)
    setSiteQuery("")
    setSiteInfo(null)
    setSaveErr("")
    setPanel({ mode: "new" })
  }

  const openEdit = (row) => {
    setForm({
      pm_request_number: row.pm_request_number ?? "",
      planned_date: row.planned_date ?? localDate(),
      service_type: row.service_type ?? "PM Service",
      plan_type:    row.plan_type    ?? "Customer",
      amc_type:     row.amc_type     ?? "AMC",
      fold_status:  row.fold_status  ?? "",
      status:       row.status       ?? "Pending",
      remarks:      row.remarks      ?? "",
      site_id_fk:   row.sites?.id    ?? null,
      site_id_text: row.sites?.site_id ?? "",
    })
    setSiteQuery(row.sites ? `${row.sites.site_id}${row.sites.name ? " · " + row.sites.name : ""}` : "")
    setSiteInfo(row.sites ?? null)
    setSaveErr("")
    setPanel({ mode: "edit", row })
  }

  // ── save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveErr("")
    if (!form.pm_request_number.trim()) { setSaveErr("PM Request Number is required."); return }
    if (!form.planned_date)             { setSaveErr("Planned date is required.");       return }
    if (!form.site_id_fk)               { setSaveErr("Please select a site.");           return }

    setSaving(true)
    const d = new Date(form.planned_date)
    const payload = {
      pm_request_number: form.pm_request_number.trim(),
      planned_date:  form.planned_date,
      service_type:  form.service_type,
      plan_type:     form.plan_type,
      amc_type:      form.amc_type || null,
      fold_status:   form.fold_status || null,
      status:        form.status,
      remarks:       form.remarks || null,
      site_id:       form.site_id_fk,
      month:         d.getMonth() + 1,
      year:          d.getFullYear(),
    }

    let error
    if (panel.mode === "new") {
      ;({ error } = await supabase.from("pm_plan").insert(payload))
    } else {
      ;({ error } = await supabase.from("pm_plan").update(payload).eq("id", panel.row.id))
    }

    setSaving(false)
    if (error) { setSaveErr(error.message); return }
    qc.invalidateQueries({ queryKey: ["pm-plans-page"] })
    qc.invalidateQueries({ queryKey: ["pm-plans-map"] })
    setPanel(null)
  }

  // ── delete ──────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!window.confirm(`Delete PM plan ${panel.row.pm_request_number}? This cannot be undone.`)) return
    const { error } = await supabase.from("pm_plan").delete().eq("id", panel.row.id)
    if (error) { setSaveErr(error.message); return }
    qc.invalidateQueries({ queryKey: ["pm-plans-page"] })
    qc.invalidateQueries({ queryKey: ["pm-plans-map"] })
    setPanel(null)
  }

  // ── render ──────────────────────────────────────────────────────────────
  if (showUpload) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "0 20px", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", height: 54, gap: 16 }}>
            <button onClick={() => setShowUpload(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#374151" }}>←</button>
            <span style={{ fontWeight: 700, fontSize: 16 }}>PM Plan — Excel Upload</span>
          </div>
        </div>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
          <PmPlanUpload />
        </div>
      </div>
    )
  }

  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }
  const inputStyle = { width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, boxSizing: "border-box" }

  const doneCount    = plans.filter(p => p.status === "Done").length
  const pendingCount = plans.filter(p => p.status === "Pending" || p.status === "Assigned").length

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* ── Header ── */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "0 20px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, height: 54, flexWrap: "wrap" }}>
          <Link to="/" style={{ fontSize: 18, textDecoration: "none", color: "#374151" }}>←</Link>
          <span style={{ fontWeight: 700, fontSize: 16 }}>PM Plan Register</span>

          {/* Month navigation */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <button onClick={prevMonth} style={{ padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", background: "white" }}>‹</button>
            <span style={{ fontWeight: 600, fontSize: 14, minWidth: 90, textAlign: "center" }}>{MONTHS[filterMonth - 1]} {filterYear}</span>
            <button onClick={nextMonth} style={{ padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", background: "white" }}>›</button>
          </div>

          {/* Summary pills */}
          <span style={{ fontSize: 12, background: "#f0fdf4", color: "#15803d", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>✓ {doneCount} Done</span>
          <span style={{ fontSize: 12, background: "#eff6ff", color: "#1d4ed8", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>⏳ {pendingCount} Pending</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={exportExcel} disabled={filtered.length === 0}
              style={{ padding: "6px 14px", background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: 7, cursor: filtered.length === 0 ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
              ⬇ Excel
            </button>
            <button onClick={() => setShowUpload(true)}
              style={{ padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: 7, cursor: "pointer", background: "white", fontSize: 13 }}>
              📥 Upload Excel
            </button>
            <button onClick={openNew}
              style={{ padding: "6px 16px", background: "#1a73e8", color: "white", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              + New PM
            </button>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ background: "white", borderBottom: "1px solid #f1f5f9", padding: "10px 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Search PM no., site ID, site name…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, minWidth: 220 }}
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">All Status</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">All Types</option>
            {SERVICE_TYPES.map(s => <option key={s}>{s}</option>)}
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{filtered.length} records</span>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px 40px" }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "#9ca3af" }}>No PM plans for {MONTHS[filterMonth - 1]} {filterYear}</div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 2 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "white", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                  {["#", "PM No.", "Date", "Status", "Site ID", "Site Name", "District", "KVA", "Type", "Plan", "AMC", "Customer", "Phone", "Technician", "Remarks"].map(h => (
                    <th key={h} style={{ padding: "10px 10px", textAlign: "left", fontWeight: 700, color: "#374151", whiteSpace: "nowrap", fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr key={p.id}
                    onClick={() => openEdit(p)}
                    style={{
                      borderBottom: "1px solid #f3f4f6",
                      cursor: "pointer",
                      background: p.status === "Done" ? "#fafffe" : "white",
                      opacity: p.status === "Cancelled" ? 0.5 : 1,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                    onMouseLeave={e => e.currentTarget.style.background = p.status === "Done" ? "#fafffe" : "white"}
                  >
                    <td style={{ padding: "8px 10px", color: "#9ca3af" }}>{i + 1}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>{p.pm_request_number}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{p.planned_date ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}><Badge status={p.status} /></td>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{p.sites?.site_id ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{p.sites?.name ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{p.sites?.site_location ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{p.sites?.kva ?? "—"}</td>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{p.service_type}</td>
                    <td style={{ padding: "8px 10px" }}>{p.plan_type ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{p.amc_type ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{p.sites?.contact_person ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{p.sites?.contact_phone ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>{p.technicians?.name ?? "—"}</td>
                    <td style={{ padding: "8px 10px", color: "#6b7280", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.remarks ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Slide-in panel ── */}
      {panel && (
        <>
          <div onClick={() => setPanel(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 200 }} />
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: "min(100vw, 420px)",
            background: "white", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)", zIndex: 201,
            display: "flex", flexDirection: "column", overflowY: "auto"
          }}>
            {/* Panel header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{panel.mode === "new" ? "New PM Plan" : "Edit PM Plan"}</span>
              <button onClick={() => setPanel(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            {/* Form */}
            <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* PM Request Number */}
              <div>
                <label style={labelStyle}>PM Request No. <span style={{ color: "#ef4444" }}>*</span></label>
                <input value={form.pm_request_number} onChange={set("pm_request_number")} placeholder="e.g. PM-2026-041" style={inputStyle} />
              </div>

              {/* Site autocomplete */}
              <div style={{ position: "relative" }}>
                <label style={labelStyle}>Site <span style={{ color: "#ef4444" }}>*</span></label>
                <input
                  ref={siteInputRef}
                  value={siteQuery}
                  onChange={e => handleSiteInput(e.target.value)}
                  onFocus={e => { if (siteQuery.length > 0) handleSiteInput(siteQuery) }}
                  placeholder="Type site ID or name…"
                  style={inputStyle}
                  autoComplete="off"
                />
                {siteInfo && (
                  <div style={{ marginTop: 6, padding: "8px 10px", background: "#f0f9ff", borderRadius: 6, fontSize: 12, color: "#1d4ed8" }}>
                    {siteInfo.kva && <span>⚡ {siteInfo.kva} KVA</span>}
                    {siteInfo.site_location && <span style={{ marginLeft: 10 }}>📍 {siteInfo.site_location}</span>}
                    {siteInfo.contact_person && <span style={{ marginLeft: 10 }}>👤 {siteInfo.contact_person}</span>}
                    {siteInfo.contact_phone  && <span style={{ marginLeft: 10 }}>📞 {siteInfo.contact_phone}</span>}
                  </div>
                )}
              </div>

              {/* Planned Date */}
              <div>
                <label style={labelStyle}>Planned Date <span style={{ color: "#ef4444" }}>*</span></label>
                <input type="date" value={form.planned_date} onChange={set("planned_date")} style={inputStyle} />
              </div>

              {/* Service Type */}
              <div>
                <label style={labelStyle}>Service Type</label>
                <select value={form.service_type} onChange={set("service_type")} style={inputStyle}>
                  {SERVICE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              {/* Plan Type + AMC — side by side */}
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Plan Type</label>
                  <select value={form.plan_type} onChange={set("plan_type")} style={inputStyle}>
                    {PLAN_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>AMC Type</label>
                  <select value={form.amc_type} onChange={set("amc_type")} style={inputStyle}>
                    <option value="">—</option>
                    {AMC_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Fold Status + Status — side by side */}
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Fold Status</label>
                  <select value={form.fold_status} onChange={set("fold_status")} style={inputStyle}>
                    <option value="">—</option>
                    {FOLD_STATUSES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Status</label>
                  <select value={form.status} onChange={set("status")} style={inputStyle}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label style={labelStyle}>Remarks</label>
                <textarea value={form.remarks} onChange={set("remarks")} rows={2}
                  placeholder="Any notes…"
                  style={{ ...inputStyle, resize: "vertical" }} />
              </div>

              {saveErr && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#dc2626" }}>
                  {saveErr}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10 }}>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: "10px", background: saving ? "#93c5fd" : "#1a73e8", color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>
                {saving ? "Saving…" : panel.mode === "new" ? "Add PM Plan" : "Save Changes"}
              </button>
              {panel.mode === "edit" && (
                <button onClick={handleDelete}
                  style={{ padding: "10px 16px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600 }}>
                  🗑
                </button>
              )}
              <button onClick={() => setPanel(null)}
                style={{ padding: "10px 16px", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 7, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Site suggestion dropdown (fixed, escapes overflow) ── */}
      {siteSuggestions.length > 0 && dropRect && (
        <ul style={{
          position: "fixed",
          top: dropRect.top + 4,
          left: dropRect.left,
          width: Math.max(dropRect.width, 320),
          background: "white",
          border: "1px solid #d1d5db",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
          zIndex: 500,
          margin: 0,
          padding: 0,
          listStyle: "none",
          maxHeight: 240,
          overflowY: "auto",
        }}>
          {siteSuggestions.map(s => (
            <li key={s.id}
              onMouseDown={() => pickSite(s)}
              style={{ padding: "9px 14px", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
              onMouseLeave={e => e.currentTarget.style.background = "white"}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{s.site_id}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {s.name}{s.site_location ? ` · ${s.site_location}` : ""}{s.kva ? ` · ${s.kva} KVA` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
