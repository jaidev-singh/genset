// DeputationForm.jsx
// Smart daily deputation creation form.
//
// UX:
//   1. Pick date + technician
//   2. Type site_id / site name / engine no â†’ live autocomplete
//   3. Site auto-fills: KVA, engine model, contact person + phone
//   4. If a Pending pm_plan exists for that site â†’ shown automatically, pmPlanId pre-filled
//   5. Pick work type â†’ if CM: show open complaints for that site
//   6. Notes field (optional)
//   7. Save â†’ inserts deputation row; if pm_plan linked, marks it Assigned

import { useState, useMemo, useRef, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "../../lib/supabase"

const norm = s => (s ?? "").toString().toLowerCase()

const WORK_TYPES = [
  "PM Service", "Top Up", "PM Visit",
  "CM", "Commissioning",
  "Payment Visit", "Invoice Submission",
  "Office Work", "Other"
]
const PM_WORK_TYPES  = new Set(["PM Service", "Top Up", "PM Visit"])
const CM_WORK_TYPES  = new Set(["CM", "Commissioning"])

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

function FieldLabel({ children, required }) {
  return (
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
      {children}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
    </label>
  )
}

function FieldWrap({ children, style }) {
  return <div style={{ marginBottom: 14, ...style }}>{children}</div>
}

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d1d5db",
  borderRadius: 7, fontSize: 13, boxSizing: "border-box",
  outline: "none", background: "white"
}

export default function DeputationForm({ onSaved }) {
  const qc = useQueryClient()

  // â”€â”€ form fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [depDate,       setDepDate]       = useState(today())
  const [techId,        setTechId]        = useState("")
  const [workType,      setWorkType]      = useState("PM Service")
  const [notes,         setNotes]         = useState("")
  const [otherDesc,     setOtherDesc]     = useState("")
  const [complaintId,   setComplaintId]   = useState("")
  const [pmPlanId,      setPmPlanId]      = useState(null)   // auto-set from pending plan
  const [refNumber,     setRefNumber]     = useState("")     // manual PM/CM no. when no plan/complaint linked

  // â”€â”€ site search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [query,          setQuery]         = useState("")
  const [showSugg,       setShowSugg]      = useState(false)
  const [site,           setSite]          = useState(null)   // selected site object
  const [pendingPlan,    setPendingPlan]   = useState(null)   // pm_plan for the site
  const [openComplaints, setOpenComplaints]= useState([])
  const [finding,        setFinding]       = useState(false)  // loading plan/complaints
  const [saving,         setSaving]        = useState(false)
  const [error,          setError]         = useState("")

  const suggRef = useRef(null)

  // â”€â”€ data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const { data: sites = [] } = useQuery({
    queryKey: ["sites-deputation-search"],
    queryFn: async () => {
      const all = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from("sites")
          .select("id, site_id, name, site_location, engine_serial_no, engine_model, kva, contact_person, contact_phone")
          .order("id").range(from, from + 999)
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
        from += 1000
      }
      return all
    },
    staleTime: 5 * 60 * 1000
  })

  // PM plans register â€” site source when work type is PM Service / Top Up / PM Visit
  const { data: pendingPlans = [] } = useQuery({
    queryKey: ["pending-pm-plans-deputation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pm_plan")
        .select("id, pm_request_number, planned_date, service_type, plan_type, sites(id, site_id, name, site_location, kva, engine_serial_no, engine_model, contact_person, contact_phone)")
        .in("status", ["Pending", "Assigned"])
        .order("planned_date")
      if (error) throw error
      return data.filter(p => p.sites)
    },
    staleTime: 2 * 60 * 1000
  })

  // Open complaints register â€” site source when work type is CM / Commissioning
  const { data: openComplaintsGlobal = [] } = useQuery({
    queryKey: ["open-complaints-deputation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("complaints")
        .select("id, complaint_number, cm_category, cm_nature, complaint_date, sites(id, site_id, name, site_location, kva, engine_serial_no, engine_model, contact_person, contact_phone)")
        .not("status", "eq", "Closed")
        .order("complaint_date", { ascending: false })
      if (error) throw error
      return data.filter(c => c.sites)
    },
    staleTime: 2 * 60 * 1000
  })

  const { data: technicians = [] } = useQuery({
    queryKey: ["technicians-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("technicians").select("id, name, phone, office_id").eq("is_active", true).order("name")
      if (error) throw error
      return data
    },
    staleTime: 10 * 60 * 1000
  })

  // â”€â”€ effects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Close suggestions on outside click
  useEffect(() => {
    const handler = e => { if (suggRef.current && !suggRef.current.contains(e.target)) setShowSugg(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Source type derived from work type â€” controls which register is searched
  const suggestionType = PM_WORK_TYPES.has(workType) ? "pm"
                       : CM_WORK_TYPES.has(workType)  ? "complaint"
                       : "all"

  const suggestions = useMemo(() => {
    if (!query.trim()) return []
    const q = norm(query)

    if (suggestionType === "pm") {
      return pendingPlans
        .filter(p =>
          norm(p.sites.site_id).includes(q) ||
          norm(p.sites.name).includes(q) ||
          norm(p.sites.site_location).includes(q) ||
          norm(p.pm_request_number).includes(q)
        )
        .slice(0, 8)
        .map(p => ({ ...p.sites, _planId: p.id, _planNum: p.pm_request_number, _planDate: p.planned_date, _serviceType: p.service_type }))
    }

    if (suggestionType === "complaint") {
      return openComplaintsGlobal
        .filter(c =>
          norm(c.sites.site_id).includes(q) ||
          norm(c.sites.name).includes(q) ||
          norm(c.complaint_number).includes(q) ||
          norm(c.cm_nature).includes(q)
        )
        .slice(0, 8)
        .map(c => ({ ...c.sites, _complaintId: c.id, _complaintNum: c.complaint_number, _cmCategory: c.cm_category, _cmNature: c.cm_nature }))
    }

    return sites
      .filter(s =>
        norm(s.site_id).includes(q) ||
        norm(s.name).includes(q) ||
        norm(s.engine_serial_no).includes(q) ||
        norm(s.site_location).includes(q)
      ).slice(0, 8)
  }, [query, suggestionType, sites, pendingPlans, openComplaintsGlobal])

  // When site changes â†’ fetch pending pm_plan + open complaints
  // Only runs for 'all' source â€” register sources set data directly in selectSite
  useEffect(() => {
    if (!site) { setPendingPlan(null); setPmPlanId(null); setOpenComplaints([]); return }
    if (suggestionType !== "all") return
    let cancelled = false
    setFinding(true)

    Promise.all([
      supabase.from("pm_plan")
        .select("id, pm_request_number, planned_date, service_type, plan_type")
        .eq("site_id", site.id)
        .in("status", ["Pending"])
        .order("planned_date")
        .limit(1)
        .maybeSingle(),

      supabase.from("complaints")
        .select("id, complaint_number, cm_category, complaint_date")
        .eq("site_id", site.id)
        .in("status", ["Open", "Approved"])
        .order("complaint_date", { ascending: false })
        .limit(10)
    ]).then(([planRes, compRes]) => {
      if (cancelled) return
      const plan = planRes.data
      setPendingPlan(plan ?? null)
      setPmPlanId(plan?.id ?? null)
      setOpenComplaints(compRes.data ?? [])
      setFinding(false)
    })

    return () => { cancelled = true }
  }, [site, suggestionType])

  // â”€â”€ handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const selectSite = item => {
    const { _planId, _planNum, _planDate, _serviceType, _complaintId, _complaintNum, _cmCategory, _cmNature, ...siteData } = item
    setSite(siteData)
    setQuery(siteData.site_id)
    setShowSugg(false)
    if (_planId) {
      setPmPlanId(_planId)
      setPendingPlan({ id: _planId, pm_request_number: _planNum, planned_date: _planDate, service_type: _serviceType })
      setOpenComplaints([])
      setComplaintId("")
    } else if (_complaintId) {
      setComplaintId(String(_complaintId))
      setOpenComplaints([{ id: _complaintId, complaint_number: _complaintNum, cm_category: _cmCategory, cm_nature: _cmNature }])
      setPendingPlan(null)
      setPmPlanId(null)
    } else {
      setPmPlanId(null)
      setPendingPlan(null)
      setOpenComplaints([])
      setComplaintId("")
    }
  }

  const clearSite = () => {
    setSite(null)
    setQuery("")
    setPendingPlan(null)
    setPmPlanId(null)
    setOpenComplaints([])
    setComplaintId("")
  }

  const handleSave = async () => {
    setError("")
    if (!depDate)    { setError("Date is required."); return }
    if (!techId)     { setError("Technician is required."); return }
    if (!workType)   { setError("Work type is required."); return }
    if (workType !== "Office Work" && workType !== "Other" && !site) {
      setError("Site is required for this work type."); return
    }
    if (workType === "Other" && !otherDesc.trim()) { setError("Please describe the other task."); return }

    setSaving(true)
    try {
      // Insert deputation
      const { data: dep, error: depErr } = await supabase
        .from("deputation")
        .insert({
          deputation_date: depDate,
          technician_id:   Number(techId),
          site_id:         site?.id ?? null,
          work_type:       workType,
          complaint_id:    complaintId ? Number(complaintId) : null,
          pm_plan_id:      pmPlanId ?? null,
          notes:           notes.trim() || null,
          other_task_desc: workType === "Other" ? otherDesc.trim() : null,
          ref_number:      refNumber.trim() || null,
          status:          "Planned",
        })
        .select("id")
        .single()

      if (depErr) throw depErr

      // If a pm_plan was linked â†’ mark it Assigned and record which tech
      if (pmPlanId) {
        await supabase.from("pm_plan")
          .update({ status: "Assigned", assigned_to: Number(techId) })
          .eq("id", pmPlanId)
          .eq("status", "Pending")  // only if still pending (avoid overwriting Done)
      }

      qc.invalidateQueries({ queryKey: ["deputation-list"] })
      qc.invalidateQueries({ queryKey: ["pm-plans-map"] })

      // Reset only site/work fields â€” keep date + tech so the admin can
      // quickly add the next job for the same technician on the same day
      setQuery(""); setSite(null); setPendingPlan(null); setPmPlanId(null)
      setOpenComplaints([]); setNotes(""); setOtherDesc(""); setComplaintId("")
      setRefNumber(""); setWorkType("PM Service")
      // techId and depDate are intentionally kept

      if (onSaved) onSaved(dep.id)
      else alert("Deputation saved âœ…")

    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px" }}>
      <h3 style={{ margin: "0 0 18px", fontSize: 17, fontWeight: 700 }}>New Deputation</h3>

      {/* Date + Technician row */}
      <div style={{ display: "flex", gap: 12 }}>
        <FieldWrap style={{ flex: 1 }}>
          <FieldLabel required>Date</FieldLabel>
          <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)} style={inputStyle} />
        </FieldWrap>

        <FieldWrap style={{ flex: 2 }}>
          <FieldLabel required>Technician</FieldLabel>
          <select value={techId} onChange={e => setTechId(e.target.value)} style={inputStyle}>
            <option value="">â€” select â€”</option>
            {technicians.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </FieldWrap>
      </div>

      {/* Work type */}
      <FieldWrap>
        <FieldLabel required>Work Type</FieldLabel>
        <select value={workType} onChange={e => {
          const next = e.target.value
          const prevSrc = PM_WORK_TYPES.has(workType) ? "pm" : CM_WORK_TYPES.has(workType) ? "complaint" : "all"
          const nextSrc = PM_WORK_TYPES.has(next)     ? "pm" : CM_WORK_TYPES.has(next)     ? "complaint" : "all"
          if (prevSrc !== nextSrc) clearSite()
          setWorkType(next); setComplaintId("")
        }} style={inputStyle}>
          {WORK_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </FieldWrap>

      {/* Other task desc (only when work_type = Other) */}
      {workType === "Other" && (
        <FieldWrap>
          <FieldLabel required>Describe Task</FieldLabel>
          <input value={otherDesc} onChange={e => setOtherDesc(e.target.value)} placeholder="What will be done?" style={inputStyle} />
        </FieldWrap>
      )}

      {/* Site search (hidden for office / other work without site) */}
      {workType !== "Office Work" && (
        <FieldWrap>
          <FieldLabel required={workType !== "Other"}>Site</FieldLabel>

          {/* Search box + suggestions */}
          {!site && (
            <div ref={suggRef} style={{ position: "relative" }}>
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setShowSugg(true) }}
                onFocus={() => suggestions.length > 0 && setShowSugg(true)}
                placeholder={
                  suggestionType === "pm"         ? "Type site ID, PM no. or site nameâ€¦" :
                  suggestionType === "complaint"  ? "Type site ID, complaint no. or site nameâ€¦" :
                                                   "Type site ID, name or engine noâ€¦"
                }
                style={inputStyle}
                autoComplete="off"
              />
              {suggestionType !== "all" && (
                <div style={{ fontSize: 11, color: suggestionType === "pm" ? "#1d4ed8" : "#c2410c", marginTop: 3, marginLeft: 2 }}>
                  {suggestionType === "pm" ? "ðŸ“‹ Showing sites with pending PM plans" : "âš ï¸ Showing sites with open complaints"}
                </div>
              )}
              {showSugg && suggestions.length > 0 && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
                  background: "white", border: "1px solid #d1d5db", borderRadius: "0 0 8px 8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.12)", maxHeight: 260, overflowY: "auto"
                }}>
                  {suggestions.map(s => (
                    <div
                      key={s._planId ?? s._complaintId ?? s.id}
                      onMouseDown={() => selectSite(s)}
                      style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}
                    >
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{s.site_id}</span>
                        {" "}
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{s.name || ""}</span>
                      </div>
                      {s._planNum && <div style={{ fontSize: 11, color: "#1d4ed8" }}>ðŸ“‹ {s._planNum} Â· {s._planDate} Â· {s._serviceType}</div>}
                      {s._complaintNum && <div style={{ fontSize: 11, color: "#c2410c" }}>âš ï¸ {s._complaintNum}{s._cmNature ? ` Â· ${s._cmNature}` : ""}</div>}
                      {!s._planNum && !s._complaintNum && s.site_location && <div style={{ fontSize: 11, color: "#9ca3af" }}>{s.site_location}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected site card */}
          {site && (
            <div style={{ border: "1.5px solid #6ee7b7", borderRadius: 8, padding: "12px 14px", background: "#f0fdf4", position: "relative" }}>
              <button
                onClick={clearSite}
                style={{ position: "absolute", top: 8, right: 10, border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#9ca3af" }}
              >âœ•</button>

              <div style={{ fontWeight: 700, fontSize: 14, color: "#065f46" }}>{site.site_id}</div>
              {site.name && <div style={{ fontSize: 13, color: "#047857", marginTop: 2 }}>{site.name}</div>}
              {site.site_location && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{site.site_location}</div>}

              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", marginTop: 8, fontSize: 12, color: "#374151" }}>
                {site.kva          && <span><b>KVA:</b> {site.kva}</span>}
                {site.engine_model && <span><b>Engine:</b> {site.engine_model}</span>}
                {site.engine_serial_no && <span><b>Serial:</b> {site.engine_serial_no}</span>}
                {site.contact_person   && <span><b>Contact:</b> {site.contact_person}</span>}
                {site.contact_phone    && <span><b>ðŸ“ž</b> {site.contact_phone}</span>}
              </div>

              {/* PM Plan info */}
              {finding && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Checking PM planâ€¦</div>}

              {!finding && pendingPlan && PM_WORK_TYPES.has(workType) && (
                <div style={{ marginTop: 10, padding: "8px 10px", background: "#eff6ff", borderRadius: 6, border: "1px solid #bfdbfe", fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: "#1d4ed8" }}>ðŸ“‹ Pending PM Plan</span>
                  <br />
                  <span style={{ color: "#1e40af" }}>{pendingPlan.pm_request_number}</span>
                  {"  Â·  "}
                  <span style={{ color: "#374151" }}>{pendingPlan.planned_date} â€” {pendingPlan.service_type}</span>
                  <div style={{ color: "#16a34a", marginTop: 3, fontWeight: 500 }}>âœ“ Linked automatically</div>
                </div>
              )}

              {!finding && !pendingPlan && PM_WORK_TYPES.has(workType) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>No pending PM plan for this site</div>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 3 }}>PM No. <span style={{ fontWeight:400, color:"#9ca3af" }}>(optional)</span></div>
                    <input value={refNumber} onChange={e => setRefNumber(e.target.value)} placeholder="e.g. PM-2026-042" style={{ ...inputStyle, fontSize: 12 }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </FieldWrap>
      )}

      {/* Complaint selector (only for CM work type) */}
      {workType === "CM" && site && (
        <FieldWrap>
          <FieldLabel>Linked Complaint</FieldLabel>
          {openComplaints.length === 0 ? (
            <>
              <div style={{ fontSize: 12, color: "#9ca3af", padding: "4px 0 6px" }}>No open complaints for this site</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 3 }}>CM / Complaint No. <span style={{ fontWeight:400, color:"#9ca3af" }}>(optional)</span></div>
              <input value={refNumber} onChange={e => setRefNumber(e.target.value)} placeholder="e.g. CM-2026-018" style={{ ...inputStyle, fontSize: 12 }} />
            </>
          ) : (
            <select value={complaintId} onChange={e => setComplaintId(e.target.value)} style={inputStyle}>
              <option value="">â€” select (optional) â€”</option>
              {openComplaints.map(c => (
                <option key={c.id} value={c.id}>
                  {c.complaint_number} Â· {c.cm_category} Â· {c.complaint_date}
                </option>
              ))}
            </select>
          )}
        </FieldWrap>
      )}

      {/* Notes */}
      <FieldWrap>
        <FieldLabel>Notes</FieldLabel>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional instructions or remarksâ€¦"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </FieldWrap>

      {/* Error */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#dc2626", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{ width: "100%", padding: "12px", background: saving ? "#93c5fd" : "#1a73e8", color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: saving ? "default" : "pointer" }}
      >
        {saving ? "Saving¦" : "Save Deputation"}
      </button>
    </div>
  )
}
