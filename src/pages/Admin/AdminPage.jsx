import { useQuery } from "@tanstack/react-query"
import { useState, useMemo, useRef, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { supabase } from "../../lib/supabase"
import LocationApproval from "./LocationApproval"
import PmUpload         from "./PmUpload"
import PmPlanUpload     from "../PmPlan/PmPlanUpload"

const OFFICES = [
  { id: 1, name: "Bareilly" },
  { id: 2, name: "Pilibhit" },
  { id: 3, name: "Badaun" },
]

const GENSET_STATUS = ["Active", "Inactive"]
const FOLD_STATUS = ["In-fold", "De-fold", ""]
const WARRANTY_STATUS = ["In Warranty", "Out of Warranty", ""]
const PM_TYPES = ["PM", "CM", "Inspection", ""]
const AMC_TYPES = ["Full AMC", "Parts AMC", "No AMC", ""]

function EditCell({ editMode, displayValue, children }) {
  return <td style={{ minWidth: "120px", padding: "4px 6px", whiteSpace: "nowrap" }}>
    {editMode ? children : (displayValue ?? "—")}
  </td>
}

const normalize = (str) =>
  (str || "").toLowerCase().replace(/[^a-z0-9]/g, "")

// Tab definitions — add new admin sections here
const TABS = [
  { key: "edit",       label: "✏️  Site Edit",         desc: "Inline-edit all site fields with search and pagination." },
  { key: "location",   label: "📍 Approve Locations",   desc: "Review and approve GPS location updates submitted by field workers." },
  { key: "pm-upload",  label: "📊 PM Bulk Upload",      desc: "Upload an Excel sheet to bulk-update last PM date, type, technician and remarks." },
  { key: "pm-plan",    label: "📋 PM Plan Upload",      desc: "Upload a PM schedule from Excel into the pm_plan table. Upserts on PM request number." },
  { key: "deputation", label: "📅 Deputation",          desc: "Create and approve daily deputation orders. Marks PM plans as done on approval." },
]

export default function AdminPage() {
  const navigate = useNavigate()
  // null = show the home menu; a tab key = show that panel
  const [activeTab, setActiveTab] = useState(null)

  const PAGE_SIZE = 100
  const [page, setPage] = useState(0)
  const [editRow, setEditRow] = useState(null)
  const [formData, setFormData] = useState({})
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const searchRef = useRef(null)

  // Only run the filter 1 second after the user stops typing
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 1000)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: sites = [], isLoading, refetch } = useQuery({
    queryKey: ["sites-admin"],
    queryFn: async () => {
      // Supabase caps at 1000 rows per request — fetch all pages
      const allData = []
      let from = 0
      const batchSize = 1000
      while (true) {
        const { data, error } = await supabase
          .from("sites")
          .select(`
            id, site_id, name, site_location, address, latitude, longitude,
            genset_status, fold_status, warranty_status, amc_type,
            last_service_date, last_service_type, reason_inactive,
            contact_phone, contact_person, office_id, customer_id,
            engine_serial_no, engine_model, kva,
            customers(id, name)
          `)
          .order("id", { ascending: true })
          .range(from, from + batchSize - 1)
        if (error) throw error
        allData.push(...data)
        if (data.length < batchSize) break
        from += batchSize
      }
      return allData
    },
  })

  // Client-side filtering — runs 1s after user stops typing
  const filteredSites = useMemo(() => {
    const q = debouncedSearch.trim()
    if (!q) return sites
    const tokens = q.split(/[\s\-_]+/).map(normalize).filter(Boolean)
    return sites.filter(site => {
      const normalizedSiteId = normalize(site.site_id)
      const normalizedEngine = normalize(site.engine_serial_no)
      const normalizedName = normalize(site.name)
      const normalizedCustomer = normalize(site.customers?.name)
      const normalizedLocation = normalize(site.site_location)
      return tokens.every(token =>
        normalizedSiteId.includes(token) ||
        normalizedEngine.includes(token) ||
        normalizedName.includes(token) ||
        normalizedCustomer.includes(token) ||
        normalizedLocation.includes(token)
      )
    })
  }, [sites, debouncedSearch])

  const totalCount = filteredSites.length
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const pagedSites = filteredSites.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name").order("name")
      if (error) throw error
      return data
    }
  })

  // Only blank on the very first load
  if (isLoading) return <div style={{ padding: 20 }}>Loading data, please wait...</div>

  const handleEdit = (site) => {
    setEditRow(site.id)
    setFormData({
      site_id: site.site_id,
      name: site.name,
      site_location: site.site_location,
      address: site.address,
      latitude: site.latitude,
      longitude: site.longitude,
      genset_status: site.genset_status,
      fold_status: site.fold_status,
      warranty_status: site.warranty_status,
      amc_type: site.amc_type,
      last_service_date: site.last_service_date,
      last_service_type: site.last_service_type,
      reason_inactive: site.reason_inactive,
      contact_phone: site.contact_phone,
      contact_person: site.contact_person,
      office_id: site.office_id,
      customer_id: site.customer_id,
    })
  }

  const handleSave = async () => {
    const { error } = await supabase.from("sites").update(formData).eq("id", editRow)
    if (error) {
      alert("Update failed ❌\n" + error.message)
      console.error(error)
    } else {
      alert("Saved ✅")
      setEditRow(null)
      refetch()
    }
  }

  const set = (field) => (e) =>
    setFormData((prev) => ({ ...prev, [field]: e.target.value }))

  const handlePageChange = (newPage) => {
    setEditRow(null)
    setPage(newPage)
  }

  // ── Home menu ──────────────────────────────────────────────────────────────
  if (activeTab === null) {
    return (
      <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Link to="/" style={{ fontSize: 18, textDecoration: "none", color: "#374151" }}>←</Link>
          <h2 style={{ margin: 0 }}>Admin Panel</h2>
        </div>
        <p style={{ color: "#555", marginBottom: 24 }}>Select a section to manage:</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => tab.key === "deputation" ? navigate("/deputation") : setActiveTab(tab.key)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "16px 20px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: "white",
                cursor: "pointer",
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                textAlign: "left"
              }}
            >
              <span style={{ fontWeight: "bold", fontSize: 15 }}>{tab.label}</span>
              <span style={{ color: "#666", fontSize: 12, marginTop: 4 }}>{tab.desc}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }
  // ── PM Plan Upload panel ──────────────────────────────────────────
  if (activeTab === "pm-plan") {
    return (
      <div style={{ padding: "16px", maxWidth: "100vw", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={() => setActiveTab(null)} style={{ padding: "4px 10px", cursor: "pointer" }}>← Back</button>
          <h2 style={{ margin: 0 }}>PM Plan Upload</h2>
        </div>
        <PmPlanUpload />
      </div>
    )
  }
  // ── PM Bulk Upload panel ─────────────────────────────────────────────────
  if (activeTab === "pm-upload") {
    return (
      <div style={{ padding: "16px", maxWidth: "100vw", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={() => setActiveTab(null)} style={{ padding: "4px 10px", cursor: "pointer" }}>← Back</button>
          <h2 style={{ margin: 0 }}>PM Bulk Upload</h2>
        </div>
        <PmUpload />
      </div>
    )
  }

  // ── Location Approval panel ────────────────────────────────────────────────
  if (activeTab === "location") {
    return (
      <div style={{ padding: "16px", maxWidth: "100vw", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={() => setActiveTab(null)} style={{ padding: "4px 10px", cursor: "pointer" }}>← Back</button>
          <h2 style={{ margin: 0 }}>Approve Location Updates</h2>
        </div>
        <LocationApproval />
      </div>
    )
  }

  // ── Site Edit panel ────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "16px", maxWidth: "100vw", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button onClick={() => setActiveTab(null)} style={{ padding: "4px 10px", cursor: "pointer" }}>← Back</button>
        <h2 style={{ margin: 0 }}>Site Edit</h2>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          ref={searchRef}
          autoFocus
          placeholder="Search by site ID, name, customer or location..."
          value={searchInput}
          onChange={(e) => { setSearchInput(e.target.value); setPage(0) }}
          style={{ padding: "6px 10px", width: 320, borderRadius: 5, border: "1px solid #ccc" }}
        />
        {searchInput && (
          <button
            onClick={() => { setSearchInput(""); setDebouncedSearch(""); setPage(0); searchRef.current?.focus() }}
            style={{ padding: "4px 8px" }}
          >✕ Clear</button>
        )}
        <span style={{ fontSize: 13, color: "#555" }}>
          {totalCount} results &nbsp;| Page {page + 1} of {totalPages || 1} &nbsp;({sites.length} loaded)
          {searchInput !== debouncedSearch && <span style={{ color: "#f59e0b" }}> &nbsp;⏳ searching...</span>}
        </span>
        <button disabled={page === 0} onClick={() => handlePageChange(0)} style={{ padding: "4px 8px" }}>« First</button>
        <button disabled={page === 0} onClick={() => handlePageChange(page - 1)} style={{ padding: "4px 8px" }}>‹ Prev</button>
        <button disabled={page + 1 >= totalPages} onClick={() => handlePageChange(page + 1)} style={{ padding: "4px 8px" }}>Next ›</button>
        <button disabled={page + 1 >= totalPages} onClick={() => handlePageChange(totalPages - 1)} style={{ padding: "4px 8px" }}>Last »</button>
      </div>

      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 180px)", width: "100%", boxSizing: "border-box", border: "1px solid #ddd" }}>
        <table border="1" cellPadding="4" style={{ fontSize: 13, borderCollapse: "collapse", width: "2000px" }}>
          <thead style={{ background: "#f0f0f0", position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th style={{ minWidth: 80 }}>Action</th>
              <th>Customer</th>
              <th>AMC Type</th>
              <th>Genset Status</th>
              <th>DB id</th>
              <th>Site ID</th>
              <th>Site Name</th>
              <th>Location</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Fold Status</th>
              <th>Warranty</th>
              <th>Last Service</th>
              <th>PM Type</th>
              <th>Reason Inactive</th>
              <th>Contact Phone</th>
              <th>Contact Person</th>
              <th>Address</th>
              <th>Office</th>
            </tr>
          </thead>
          <tbody>
            {pagedSites.map((site) => {
              const editing = editRow === site.id
              return (
                <tr key={site.id} style={{ background: editing ? "#fffbe6" : "white" }}>

                  {/* ACTION */}
                  <td style={{ textAlign: "center", whiteSpace: "nowrap", padding: "4px 8px" }}>
                    {editing ? (
                      <>
                        <button onClick={handleSave} style={{ background: "#22c55e", color: "white", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontWeight: "bold" }}>Save</button>
                        {" "}
                        <button onClick={() => setEditRow(null)} style={{ background: "#ef4444", color: "white", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>Cancel</button>
                      </>
                    ) : (
                      <button onClick={() => handleEdit(site)} style={{ background: "#3b82f6", color: "white", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>Edit</button>
                    )}
                  </td>

                  {/* Customer */}
                  <EditCell editMode={editing} displayValue={site.customers?.name}>
                    <select value={formData.customer_id || ""} onChange={set("customer_id")}>
                      <option value="">— select —</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </EditCell>

                  {/* AMC Type (category) */}
                  <EditCell editMode={editing} displayValue={site.amc_type}>
                    <select value={formData.amc_type || ""} onChange={set("amc_type")}>
                      {AMC_TYPES.map(v => <option key={v} value={v}>{v || "—"}</option>)}
                    </select>
                  </EditCell>

                  {/* Genset Status */}
                  <EditCell editMode={editing} displayValue={site.genset_status}>
                    <select value={formData.genset_status || ""} onChange={set("genset_status")}>
                      {GENSET_STATUS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </EditCell>

                  {/* DB id (read-only, for reference) */}
                  <td style={{ padding: "4px 6px", whiteSpace: "nowrap", color: "#888" }}>{site.id}</td>

                  {/* Site ID */}
                  <EditCell editMode={editing} displayValue={site.site_id}>
                    <input value={formData.site_id || ""} onChange={set("site_id")} style={{ width: 130 }} />
                  </EditCell>

                  {/* Site Name */}
                  <EditCell editMode={editing} displayValue={site.name}>
                    <input value={formData.name || ""} onChange={set("name")} style={{ width: 130 }} />
                  </EditCell>

                  {/* Location */}
                  <EditCell editMode={editing} displayValue={site.site_location}>
                    <input value={formData.site_location || ""} onChange={set("site_location")} style={{ width: 120 }} />
                  </EditCell>

                  {/* Latitude */}
                  <EditCell editMode={editing} displayValue={site.latitude}>
                    <input type="number" step="any" value={formData.latitude || ""} onChange={set("latitude")} style={{ width: 100 }} />
                  </EditCell>

                  {/* Longitude */}
                  <EditCell editMode={editing} displayValue={site.longitude}>
                    <input type="number" step="any" value={formData.longitude || ""} onChange={set("longitude")} style={{ width: 100 }} />
                  </EditCell>

                  {/* Fold Status */}
                  <EditCell editMode={editing} displayValue={site.fold_status}>
                    <select value={formData.fold_status || ""} onChange={set("fold_status")}>
                      {FOLD_STATUS.map(v => <option key={v} value={v}>{v || "—"}</option>)}
                    </select>
                  </EditCell>

                  {/* Warranty Status */}
                  <EditCell editMode={editing} displayValue={site.warranty_status}>
                    <select value={formData.warranty_status || ""} onChange={set("warranty_status")}>
                      {WARRANTY_STATUS.map(v => <option key={v} value={v}>{v || "—"}</option>)}
                    </select>
                  </EditCell>

                  {/* Last Service Date */}
                  <EditCell editMode={editing} displayValue={site.last_service_date}>
                    <input type="date" value={formData.last_service_date || ""} onChange={set("last_service_date")} />
                  </EditCell>

                  {/* PM Type */}
                  <EditCell editMode={editing} displayValue={site.last_service_type}>
                    <select value={formData.last_service_type || ""} onChange={set("last_service_type")}>
                      {PM_TYPES.map(v => <option key={v} value={v}>{v || "—"}</option>)}
                    </select>
                  </EditCell>

                  {/* Reason Inactive */}
                  <EditCell editMode={editing} displayValue={site.reason_inactive}>
                    <input value={formData.reason_inactive || ""} onChange={set("reason_inactive")} style={{ width: 140 }} />
                  </EditCell>

                  {/* Contact Phone */}
                  <EditCell editMode={editing} displayValue={site.contact_phone}>
                    <input value={formData.contact_phone || ""} onChange={set("contact_phone")} style={{ width: 110 }} />
                  </EditCell>

                  {/* Contact Person */}
                  <EditCell editMode={editing} displayValue={site.contact_person}>
                    <input value={formData.contact_person || ""} onChange={set("contact_person")} style={{ width: 120 }} />
                  </EditCell>

                  {/* Address */}
                  <EditCell editMode={editing} displayValue={site.address}>
                    <input value={formData.address || ""} onChange={set("address")} style={{ width: 180 }} />
                  </EditCell>

                  {/* Office */}
                  <EditCell editMode={editing} displayValue={OFFICES.find(o => o.id === site.office_id)?.name}>
                    <select value={formData.office_id || ""} onChange={(e) => setFormData(p => ({ ...p, office_id: Number(e.target.value) }))}>
                      <option value="">— select —</option>
                      {OFFICES.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </EditCell>

                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
