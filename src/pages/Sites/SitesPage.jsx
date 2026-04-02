// SitesPage.jsx — View, search and add sites to the sites table
import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase"

const OFFICES = [
  { id: 1, name: "Bareilly" },
  { id: 2, name: "Pilibhit" },
  { id: 3, name: "Badaun" },
]

const norm = s => (s ?? "").toString().toLowerCase()

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d1d5db",
  borderRadius: 7, fontSize: 13, boxSizing: "border-box",
}

const emptyForm = () => ({
  site_id: "", name: "", site_location: "", kva: "",
  office_id: "", contact_person: "", contact_phone: "",
  engine_model: "", engine_serial_no: "",
})

export default function SitesPage() {
  const qc = useQueryClient()

  const [search, setSearch]         = useState("")
  const [officeFilter, setOfficeFilter] = useState("all")
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState(emptyForm())
  const [saving, setSaving]         = useState(false)
  const [saveErr, setSaveErr]       = useState("")
  const [editSite, setEditSite]     = useState(null)  // null = new, object = editing

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["sites-all"],
    queryFn: async () => {
      const all = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from("sites")
          .select("id, site_id, name, site_location, kva, office_id, contact_person, contact_phone, engine_model, engine_serial_no")
          .order("id", { ascending: false })
          .range(from, from + 999)
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
        from += 1000
      }
      return all
    },
    staleTime: 0,
  })

  const rows = useMemo(() => {
    return sites.filter(s => {
      if (officeFilter !== "all" && String(s.office_id) !== officeFilter) return false
      if (search) {
        const q = norm(search)
        if (
          !norm(s.site_id).includes(q) &&
          !norm(s.name).includes(q) &&
          !norm(s.site_location).includes(q) &&
          !norm(s.engine_serial_no).includes(q) &&
          !norm(s.contact_person).includes(q)
        ) return false
      }
      return true
    })
  }, [sites, search, officeFilter])

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }))

  const openNew = () => {
    setForm(emptyForm())
    setSaveErr("")
    setEditSite(null)
    setShowForm(true)
  }

  const openEdit = (s) => {
    setForm({
      site_id:          s.site_id          ?? "",
      name:             s.name             ?? "",
      site_location:    s.site_location    ?? "",
      kva:              s.kva?.toString()  ?? "",
      office_id:        s.office_id?.toString() ?? "",
      contact_person:   s.contact_person   ?? "",
      contact_phone:    s.contact_phone    ?? "",
      engine_model:     s.engine_model     ?? "",
      engine_serial_no: s.engine_serial_no ?? "",
    })
    setSaveErr("")
    setEditSite(s)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.site_id.trim()) { setSaveErr("Site ID is required."); return }
    if (!form.name.trim())    { setSaveErr("Site Name is required."); return }
    setSaving(true); setSaveErr("")
    try {
      const payload = {
        site_id:          form.site_id.trim(),
        name:             form.name.trim(),
        site_location:    form.site_location || null,
        kva:              form.kva ? Number(form.kva) : null,
        office_id:        form.office_id ? Number(form.office_id) : null,
        contact_person:   form.contact_person || null,
        contact_phone:    form.contact_phone || null,
        engine_model:     form.engine_model || null,
        engine_serial_no: form.engine_serial_no || null,
      }
      if (editSite) {
        const { error } = await supabase.from("sites").update(payload).eq("id", editSite.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from("sites").insert(payload)
        if (error) throw error
      }
      qc.invalidateQueries({ queryKey: ["sites-all"] })
      qc.invalidateQueries({ queryKey: ["sites-slim"] })
      qc.invalidateQueries({ queryKey: ["sites-deputation-search"] })
      setShowForm(false)
      setEditSite(null)
    } catch (err) {
      setSaveErr(err.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editSite) return
    if (!window.confirm(`Delete site "${editSite.site_id} – ${editSite.name}"? This cannot be undone.`)) return
    const { error } = await supabase.from("sites").delete().eq("id", editSite.id)
    if (error) { alert("Error: " + error.message); return }
    qc.invalidateQueries({ queryKey: ["sites-all"] })
    qc.invalidateQueries({ queryKey: ["sites-slim"] })
    qc.invalidateQueries({ queryKey: ["sites-deputation-search"] })
    setShowForm(false)
    setEditSite(null)
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "sans-serif" }}>

      {/* Main table area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Toolbar */}
        <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <Link to="/" style={{ fontSize: 18, textDecoration: "none", color: "#374151", marginRight: 4 }}>←</Link>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#1e293b", marginRight: 8 }}>🏗️ Sites Register</span>

          <button
            onClick={openNew}
            style={{ padding: "7px 16px", background: "#16a34a", color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 13 }}
          >
            + Add New Site
          </button>

          <input
            placeholder="Search site ID, name, city, engine no…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, width: 260 }}
          />

          <select value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}>
            <option value="all">All Offices</option>
            {OFFICES.map(o => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>

          <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
            {rows.length} / {sites.length} sites
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
                    {["#", "Site ID", "Name", "City/District", "KVA", "Office", "Contact Person", "Phone", "Engine Model", "Engine Serial"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, fontSize: 12, color: "#475569", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>No sites found</td></tr>
                  )}
                  {rows.map((s, i) => {
                    const isSelected = showForm && editSite?.id === s.id
                    const bg = isSelected ? "#eff6ff" : i % 2 === 0 ? "white" : "#fafafa"
                    const officeName = OFFICES.find(o => o.id === s.office_id)?.name ?? "—"
                    return (
                      <tr key={s.id}
                        onClick={() => openEdit(s)}
                        style={{ cursor: "pointer", background: bg }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f1f5f9" }}
                        onMouseLeave={e => { e.currentTarget.style.background = bg }}
                      >
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", color: "#9ca3af", fontSize: 12 }}>{s.id}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>{s.site_id}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>{s.name}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", color: "#6b7280" }}>{s.site_location ?? "—"}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9" }}>{s.kva ?? "—"}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9" }}>{officeName}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9" }}>{s.contact_person ?? "—"}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9" }}>{s.contact_phone ?? "—"}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", color: "#6b7280" }}>{s.engine_model ?? "—"}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", color: "#6b7280", fontFamily: "monospace", fontSize: 12 }}>{s.engine_serial_no ?? "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>

      {/* Slide-in panel */}
      {showForm && (
        <>
          <div onClick={() => setShowForm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", zIndex: 99 }} />
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: "min(400px, 100vw)",
            background: "white", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            zIndex: 100, overflowY: "auto", padding: "20px 20px 40px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                {editSite ? `Edit — ${editSite.site_id}` : "Add New Site"}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Site ID *</label>
                <input value={form.site_id} onChange={set("site_id")} placeholder="e.g. BLY-001" style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Office</label>
                <select value={form.office_id} onChange={set("office_id")} style={{ ...inputStyle, marginTop: 4 }}>
                  <option value="">— select —</option>
                  {OFFICES.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Site Name *</label>
              <input value={form.name} onChange={set("name")} placeholder="Full site name" style={{ ...inputStyle, marginTop: 4 }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>City / District</label>
                <input value={form.site_location} onChange={set("site_location")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>KVA</label>
                <input value={form.kva} onChange={set("kva")} placeholder="e.g. 15" style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Contact Person</label>
                <input value={form.contact_person} onChange={set("contact_person")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Contact Phone</label>
                <input value={form.contact_phone} onChange={set("contact_phone")} type="tel" style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Engine Model</label>
                <input value={form.engine_model} onChange={set("engine_model")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Engine Serial No.</label>
                <input value={form.engine_serial_no} onChange={set("engine_serial_no")} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
            </div>

            {saveErr && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#dc2626", marginBottom: 12 }}>
                {saveErr}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ flex: 1, padding: "10px", background: saving ? "#86efac" : "#16a34a", color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: saving ? "default" : "pointer", fontSize: 14 }}
              >
                {saving ? "Saving…" : editSite ? "💾 Save Changes" : "➕ Add Site"}
              </button>
              {editSite && (
                <button
                  onClick={handleDelete}
                  style={{ padding: "10px 14px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 7, cursor: "pointer", fontSize: 13 }}
                >
                  🗑
                </button>
              )}
              <button
                onClick={() => setShowForm(false)}
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
