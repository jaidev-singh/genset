// ComplaintsPage.jsx
// Spreadsheet-style complaint register.
// Columns: No. | Date | Category | Site ID | Site Name | City | KVA | CM/PM No. | CM Nature | Scope | Customer | Phone | Status | Approval Date | Remarks
// Click any row → slide-in edit panel on the right.
// Top toolbar: + New   Search   Category filter   Status filter

import { useState, useMemo, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase"

// ── constants ──────────────────────────────────────────────────────────────
const CATEGORIES = ["Telecom", "Corporate", "Retail", "Other"]

const OFFICES = [
  { id: 1, name: "Bareilly" },
  { id: 2, name: "Pilibhit" },
  { id: 3, name: "Badaun" },
]

const WORK_STATUSES = ["Pending", "In Process", "Closed"]
const APPROVAL_STATUSES = ["Pending", "Rejected", "Approved"]

const WORK_STATUS_STYLE = {
  "Pending":    { bg: "#fee2e2", color: "#dc2626" },
  "In Process": { bg: "#d1fae5", color: "#065f46" },
  "Closed":     { bg: "#f0fdf4", color: "#15803d" },
}
const APPROVAL_STATUS_STYLE = {
  "Pending":  { bg: "#fef9c3", color: "#854d0e" },
  "Rejected": { bg: "#fee2e2", color: "#dc2626" },
  "Approved": { bg: "#dbeafe", color: "#1d4ed8" },
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

const emptyForm = () => ({
  complaint_number: "",
  complaint_date: today(),
  cm_category: "Telecom",
  site_id: null,
  site_name_manual: "",
  city_manual: "",
  kva_manual: "",
  cm_nature: "",
  is_in_scope: true,
  customer_name_manual: "",
  customer_phone_manual: "",
  work_status: "Pending",
  approval_status: "Pending",
  approval_date: "",
  closed_date: "",
  remarks: "",
})

const norm = s => (s ?? "").toString().toLowerCase()

// ── helpers ────────────────────────────────────────────────────────────────
function WorkBadge({ status }) {
  const s = WORK_STATUS_STYLE[status] ?? { bg: "#f3f4f6", color: "#374151" }
  return <span style={{ background: s.bg, color: s.color, padding: "2px 8px", borderRadius: 20, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{status}</span>
}
function ApprovalBadge({ status }) {
  const s = APPROVAL_STATUS_STYLE[status] ?? { bg: "#f3f4f6", color: "#374151" }
  return <span style={{ background: s.bg, color: s.color, padding: "2px 8px", borderRadius: 20, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{status}</span>
}

function Td({ children, style }) {
  return (
    <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 13, whiteSpace: "nowrap", ...style }}>
      {children}
    </td>
  )
}

function FormRow({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d1d5db",
  borderRadius: 7, fontSize: 13, boxSizing: "border-box",
}

// ── main component ─────────────────────────────────────────────────────────
export default function ComplaintsPage() {
  const qc = useQueryClient()

  // filters
  const [search, setSearch]                   = useState("")
  const [catFilter, setCatFilter]               = useState("all")
  const [workStatusFilter, setWorkStatusFilter] = useState("all")
  const [approvalStatusFilter, setApprovalStatusFilter] = useState("all")
  const [officeFilter, setOfficeFilter]         = useState("all")
  const [scopeFilter, setScopeFilter]           = useState("all")   // all | in | out
  const [cmNumFilter, setCmNumFilter]           = useState("all")   // all | blank | filled

  // slide-in panel
  const [panel, setPanel]   = useState(null)   // null | "new" | complaint object (edit)
  const [form, setForm]     = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState("")

  // site autocomplete inside form
  const [siteQuery, setSiteQuery]       = useState("")
  const [showSiteDrop, setShowSiteDrop] = useState(false)
  const siteInputRef = useRef(null)

  // ── queries ──────────────────────────────────────────────────────────────
  const { data: complaints = [], isLoading } = useQuery({
    queryKey: ["complaints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("complaints")
        .select(`
          id, complaint_number, complaint_date, cm_category,
          cm_nature, is_in_scope, customer_name_manual, customer_phone_manual,
          site_name_manual, city_manual, kva_manual,
          work_status, approval_status, approval_date, closed_date, remarks,
          site_id, sites(id, site_id, name, site_location, kva, contact_person, contact_phone, office_id)
        `)
        .order("id", { ascending: false })
      if (error) throw error
      return data
    },
    staleTime: 0,
  })

  const { data: sites = [] } = useQuery({
    queryKey: ["sites-slim"],
    queryFn: async () => {
      const all = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from("sites")
          .select("id, site_id, name, site_location, kva, contact_person, contact_phone, engine_serial_no, office_id")
          .order("id")
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

  // ── filtered rows ─────────────────────────────────────────────────────────
  const WORK_STATUS_ORDER = { "Pending": 0, "In Process": 1, "Closed": 2 }

  // Complaints where the same site appears more than once in the same calendar month
  const dupComplaintIds = useMemo(() => {
    const groups = {}
    complaints.forEach(c => {
      if (!c.site_id || !c.complaint_date) return
      const key = `${c.site_id}::${c.complaint_date.slice(0, 7)}`
      if (!groups[key]) groups[key] = []
      groups[key].push(c.id)
    })
    const s = new Set()
    Object.values(groups).forEach(ids => { if (ids.length > 1) ids.forEach(id => s.add(id)) })
    return s
  }, [complaints])

  const rows = useMemo(() => {
    return complaints
      .filter(c => {
        if (catFilter !== "all" && c.cm_category !== catFilter) return false
        if (workStatusFilter !== "all" && c.work_status !== workStatusFilter) return false
        if (approvalStatusFilter !== "all" && c.approval_status !== approvalStatusFilter) return false
        if (officeFilter !== "all") {
          if (!c.sites || String(c.sites.office_id) !== officeFilter) return false
        }
        if (scopeFilter !== "all") {
          if (scopeFilter === "in"  && c.is_in_scope !== true)  return false
          if (scopeFilter === "out" && c.is_in_scope !== false) return false
        }
        if (cmNumFilter !== "all") {
          const filled = !!(c.complaint_number?.trim())
          if (cmNumFilter === "blank"  &&  filled) return false
          if (cmNumFilter === "filled" && !filled) return false
        }
        if (search) {
          const q = norm(search)
          const siteId   = norm(c.sites?.site_id ?? c.site_name_manual)
          const siteName = norm(c.sites?.name    ?? c.site_name_manual)
          const cmNum    = norm(c.complaint_number)
          const customer = norm(c.customer_name_manual)
          const city     = norm(c.city_manual ?? c.sites?.site_location)
          if (!siteId.includes(q) && !siteName.includes(q) && !cmNum.includes(q) && !customer.includes(q) && !city.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const sa = WORK_STATUS_ORDER[a.work_status] ?? 99
        const sb = WORK_STATUS_ORDER[b.work_status] ?? 99
        if (sa !== sb) return sa - sb
        const da = a.complaint_date ?? ""
        const db = b.complaint_date ?? ""
        if (da !== db) return db.localeCompare(da)
        return b.id - a.id
      })
  }, [complaints, search, catFilter, statusFilter, officeFilter, scopeFilter, cmNumFilter])

  // ── site autocomplete suggestions ─────────────────────────────────────────
  const siteSuggestions = useMemo(() => {
    if (!siteQuery || siteQuery.length < 1) return []
    const q = norm(siteQuery)
    return sites.filter(s =>
      norm(s.site_id).includes(q) ||
      norm(s.name).includes(q) ||
      norm(s.engine_serial_no).includes(q) ||
      norm(s.site_location).includes(q)
    ).slice(0, 8)
  }, [siteQuery, sites])

  // ── form helpers ──────────────────────────────────────────────────────────
  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))
  const setVal = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const openNew = () => {
    setForm(emptyForm())
    setSiteQuery("")
    setSaveErr("")
    setPanel("new")
  }

  const openEdit = (c) => {
    setForm({
      complaint_number:      c.complaint_number       ?? "",
      complaint_date:        c.complaint_date         ?? today(),
      cm_category:           c.cm_category            ?? "Telecom",
      site_id:               c.site_id                ?? null,
      site_name_manual:      c.site_name_manual       ?? "",
      city_manual:           c.city_manual            ?? "",
      kva_manual:            c.kva_manual             ?? "",
      cm_nature:             c.cm_nature              ?? "",
      is_in_scope:           c.is_in_scope            ?? true,
      customer_name_manual:  c.customer_name_manual   ?? "",
      customer_phone_manual: c.customer_phone_manual  ?? "",
      work_status:           c.work_status            ?? "Pending",
      approval_status:       c.approval_status        ?? "Pending",
      approval_date:         c.approval_date          ?? "",
      closed_date:           c.closed_date            ?? "",
      remarks:               c.remarks                ?? "",
    })
    setSiteQuery(c.sites ? `${c.sites.site_id} – ${c.sites.name}` : "")
    setSaveErr("")
    setPanel(c)
  }

  const pickSite = (site) => {
    setVal("site_id", site.id)
    setVal("site_name_manual", site.name)
    setVal("city_manual", site.site_location ?? "")
    setVal("kva_manual", site.kva?.toString() ?? "")
    setVal("customer_name_manual", site.contact_person ?? "")
    setVal("customer_phone_manual", site.contact_phone ?? "")
    setSiteQuery(`${site.site_id} – ${site.name}`)
    setShowSiteDrop(false)
  }

  const handleSave = async () => {
    setSaveErr("")
    setSaving(true)
    try {
      const payload = {
        complaint_number:      form.complaint_number.trim() || null,
        complaint_date:        form.complaint_date || null,
        cm_category:           form.cm_category,
        site_id:               form.site_id || null,
        site_name_manual:      form.site_name_manual || null,
        city_manual:           form.city_manual || null,
        kva_manual:            form.kva_manual || null,
        cm_nature:             form.cm_nature || null,
        is_in_scope:           form.is_in_scope,
        customer_name_manual:  form.customer_name_manual || null,
        customer_phone_manual: form.customer_phone_manual || null,
        work_status:           form.work_status,
        approval_status:       form.approval_status,
        approval_date:         form.approval_date || null,
        closed_date:           form.closed_date || null,
        remarks:               form.remarks || null,
        source:                "manual",
      }

      if (panel === "new") {
        const { error } = await supabase.from("complaints").insert(payload)
        if (error) throw error
      } else {
        const { error } = await supabase.from("complaints").update(payload).eq("id", panel.id)
        if (error) throw error
      }

      qc.invalidateQueries({ queryKey: ["complaints"] })
      setPanel(null)
    } catch (err) {
      setSaveErr(err.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete complaint ${panel.complaint_number}? This cannot be undone.`)) return
    const { error } = await supabase.from("complaints").delete().eq("id", panel.id)
    if (error) { alert("Error: " + error.message); return }
    qc.invalidateQueries({ queryKey: ["complaints"] })
    setPanel(null)
  }

  // ── resolved counts for header ────────────────────────────────────────────
  const openCount     = complaints.filter(c => c.work_status !== "Closed").length
  const resolvedCount = complaints.filter(c => c.work_status === "Closed").length

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "sans-serif" }}>

      {/* ── Main table area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Toolbar */}
        <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <Link to="/" style={{ fontSize: 18, textDecoration: "none", color: "#374151", marginRight: 4 }}>←</Link>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#1e293b", marginRight: 8 }}>⚠️ Complaint Register</span>

          <button
            onClick={openNew}
            style={{ padding: "7px 16px", background: "#dc2626", color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 13 }}
          >
            + New
          </button>

          <input
            placeholder="Search site, CM no., customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, width: 220 }}
          />

          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={workStatusFilter} onChange={e => setWorkStatusFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">Work Status — All</option>
            {WORK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={approvalStatusFilter} onChange={e => setApprovalStatusFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">Approval — All</option>
            {APPROVAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">All Offices</option>
            {OFFICES.map(o => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>

          <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">All Scope</option>
            <option value="in">In-Scope</option>
            <option value="out">Out-of-Scope</option>
          </select>

          <select value={cmNumFilter} onChange={e => setCmNumFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">CM/PM No. — All</option>
            <option value="filled">CM/PM No. filled</option>
            <option value="blank">CM/PM No. blank</option>
          </select>

          <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
            {rows.length} shown &nbsp;·&nbsp; {openCount} open &nbsp;·&nbsp; {resolvedCount} resolved
          </span>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
          {isLoading
            ? <div style={{ padding: 24, color: "#9ca3af" }}>Loading…</div>
            : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 2 }}>
                  {["#","CM/PM No.","Date","Work Status","Approval","Category","Site ID","Site Name","City","KVA","CM Nature","Scope","Customer","Phone","Approval Date","Closed Date","Remarks"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "#475569", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={17} style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>No complaints found</td></tr>
                )}
                {rows.map((c, i) => {
                  const site = c.sites
                  const isSelected = panel && panel !== "new" && panel.id === c.id
                  const isDup = dupComplaintIds.has(c.id)
                  const normalBg = isSelected ? "#eff6ff" : isDup ? "#fff1f2" : (i % 2 === 0 ? "white" : "#fafafa")
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openEdit(c)}
                      style={{ cursor: "pointer", background: normalBg, borderLeft: isDup ? "3px solid #ef4444" : undefined }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = isDup ? "#ffe4e6" : "#f1f5f9" }}
                      onMouseLeave={e => { e.currentTarget.style.background = normalBg }}
                    >
                      <Td style={{ color: "#9ca3af" }}>{c.id}</Td>
                      <Td style={{ fontWeight: 700, color: "#1d4ed8" }}>{c.complaint_number ?? "—"}</Td>
                      <Td>{c.complaint_date ?? "—"}</Td>
                      <Td><WorkBadge status={c.work_status ?? "Pending"} /></Td>
                      <Td><ApprovalBadge status={c.approval_status ?? "Pending"} /></Td>
                      <Td><span style={{ background: "#f1f5f9", padding: "2px 7px", borderRadius: 4, fontSize: 11 }}>{c.cm_category ?? "—"}</span></Td>
                      <Td style={{ fontWeight: 600, color: "#374151" }}>{site?.site_id ?? "—"}</Td>
                      <Td>{site?.name ?? c.site_name_manual ?? "—"}</Td>
                      <Td>{c.city_manual ?? site?.site_location ?? "—"}</Td>
                      <Td>{c.kva_manual ?? site?.kva ?? "—"}</Td>
                      <Td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{c.cm_nature ?? "—"}</Td>
                      <Td>
                        <span style={{ background: c.is_in_scope ? "#d1fae5" : "#fee2e2", color: c.is_in_scope ? "#065f46" : "#dc2626", padding: "2px 7px", borderRadius: 4, fontSize: 11 }}>
                          {c.is_in_scope ? "In" : "Out"}
                        </span>
                      </Td>
                      <Td>{c.customer_name_manual ?? "—"}</Td>
                      <Td>{c.customer_phone_manual ?? "—"}</Td>
                      <Td>{c.approval_date ?? "—"}</Td>
                      <Td style={{ color: c.closed_date ? "#15803d" : "#9ca3af" }}>{c.closed_date ?? "—"}</Td>
                      <Td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", color: "#6b7280" }}>{c.remarks ?? "—"}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Slide-in Edit / New Panel ── */}
      {panel !== null && (
        <>
          {/* backdrop for mobile */}
          <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 99 }} />

          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 100vw)",
            background: "white", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            zIndex: 100, overflowY: "auto", padding: "20px 20px 40px",
          }}>

            {/* Panel header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                {panel === "new" ? "New Complaint" : `Edit — ${panel.complaint_number}`}
              </h3>
              <button onClick={() => setPanel(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            {/* CM/PM Number */}
            <FormRow label="CM / PM No. (optional)">
              <input value={form.complaint_number} onChange={set("complaint_number")} placeholder="e.g. CM-2024-001" style={inputStyle} />
            </FormRow>

            {/* Date */}
            <FormRow label="Date">
              <input type="date" value={form.complaint_date} onChange={set("complaint_date")} style={inputStyle} />
            </FormRow>

            {/* Category */}
            <FormRow label="Category">
              <select value={form.cm_category} onChange={set("cm_category")} style={inputStyle}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormRow>

            {/* Site (optional autocomplete) */}
            <FormRow label="Site (optional — type to search)">
              <div style={{ position: "relative" }}>
                <input
                  ref={siteInputRef}
                  value={siteQuery}
                  onChange={e => { setSiteQuery(e.target.value); setShowSiteDrop(true); if (!e.target.value) { setVal("site_id", null) } }}
                  onFocus={() => setShowSiteDrop(true)}
                  onBlur={() => setTimeout(() => setShowSiteDrop(false), 150)}
                  placeholder="Site ID or name…"
                  style={inputStyle}
                />
                {showSiteDrop && siteSuggestions.length > 0 && (() => {
                  const rect = siteInputRef.current?.getBoundingClientRect()
                  return (
                    <div style={{ position: "fixed", top: rect ? rect.bottom + 2 : 0, left: rect ? rect.left : 0, width: rect ? rect.width : 340, background: "white", border: "1px solid #d1d5db", borderRadius: 7, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 500, maxHeight: 220, overflowY: "auto" }}>
                      {siteSuggestions.map(s => (
                        <div key={s.id} onMouseDown={() => pickSite(s)}
                          style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}
                          onMouseEnter={e => e.currentTarget.style.background = "#f1f5f9"}
                          onMouseLeave={e => e.currentTarget.style.background = "white"}
                        >
                          <b>{s.site_id}</b> <span style={{ color: "#6b7280" }}>– {s.name}</span>
                          {s.site_location && <span style={{ color: "#9ca3af", marginLeft: 4, fontSize: 11 }}>{s.site_location}</span>}
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </FormRow>

            {/* Manual site fields (shown always; auto-filled when site picked) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Site Name</label>
                <input value={form.site_name_manual} onChange={set("site_name_manual")} placeholder="Manual if no site" style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>City / District</label>
                <input value={form.city_manual} onChange={set("city_manual")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>KVA</label>
                <input value={form.kva_manual} onChange={set("kva_manual")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Scope</label>
                <select value={form.is_in_scope ? "in" : "out"} onChange={e => setVal("is_in_scope", e.target.value === "in")} style={{ ...inputStyle, marginTop: 4 }}>
                  <option value="in">In-Scope</option>
                  <option value="out">Out-of-Scope</option>
                </select>
              </div>
            </div>

            {/* CM Nature */}
            <FormRow label="CM Nature / Problem Description">
              <textarea value={form.cm_nature} onChange={set("cm_nature")} rows={2} placeholder="Describe the actual problem or PM/CM type…" style={{ ...inputStyle, resize: "vertical" }} />
            </FormRow>

            {/* Customer */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Customer Name</label>
                <input value={form.customer_name_manual} onChange={set("customer_name_manual")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Customer Phone</label>
                <input value={form.customer_phone_manual} onChange={set("customer_phone_manual")} type="tel" style={{ ...inputStyle, marginTop: 4 }} />
              </div>
            </div>

            {/* Status fields */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Work Status</label>
                <select value={form.work_status} onChange={set("work_status")} style={{ ...inputStyle, marginTop: 4 }}>
                  {WORK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Approval Status</label>
                <select value={form.approval_status} onChange={set("approval_status")} style={{ ...inputStyle, marginTop: 4 }}>
                  {APPROVAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Approval Date</label>
                <input type="date" value={form.approval_date} onChange={set("approval_date")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Closed Date</label>
                <input type="date" value={form.closed_date} onChange={set("closed_date")}
                  style={{ ...inputStyle, marginTop: 4, background: form.closed_date ? "#f0fdf4" : undefined }} />
                <span style={{ fontSize: 10, color: "#9ca3af" }}>Auto-set when deputation is marked done</span>
              </div>
            </div>

            {/* Remarks */}
            <FormRow label="Remarks">
              <textarea value={form.remarks} onChange={set("remarks")} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </FormRow>

            {saveErr && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#dc2626", marginBottom: 12 }}>
                {saveErr}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ flex: 1, padding: "10px", background: saving ? "#93c5fd" : "#1d4ed8", color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: saving ? "default" : "pointer", fontSize: 14 }}
              >
                {saving ? "Saving…" : panel === "new" ? "➕ Add" : "💾 Save"}
              </button>
              {panel !== "new" && (
                <button
                  onClick={handleDelete}
                  style={{ padding: "10px 14px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 7, cursor: "pointer", fontSize: 13 }}
                >
                  🗑
                </button>
              )}
              <button
                onClick={() => setPanel(null)}
                style={{ padding: "10px 14px", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 7, cursor: "pointer", fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
