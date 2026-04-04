// DeputationList.jsx
// Shows all deputation records for a selected date, grouped by technician.
//
// Approve flow (Mark Done):
//   1. Confirm with actual completion date
//   2. deputation.status → 'Completed'
//   3. If work_type is 'PM Service' or 'Top Up' → update sites.last_service_date / last_service_type
//   4. If pm_plan_id linked → pm_plan.status → 'Done', done_date set
//   5. If PM-type work but NO pm_plan linked → optionally create a pm_plan record with status 'Done'

import { useState, useEffect, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "../../lib/supabase"

const WORK_TYPES = [
  "PM Service", "Top Up", "PM Visit",
  "CM", "Commissioning",
  "Payment Visit", "Invoice Submission",
  "Office Work", "Other"
]

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

const shiftDate = (dateStr, days) => {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const STATUS_COLORS = {
  Planned:   { bg: "#eff6ff", color: "#1d4ed8" },
  Completed: { bg: "#f0fdf4", color: "#15803d" },
  Cancelled: { bg: "#fef2f2", color: "#dc2626" },
}

const PM_TYPES_FOR_SITE_UPDATE = new Set(["PM Service", "Top Up"])
const PM_TYPES_LINKED_TO_PLAN  = new Set(["PM Service", "Top Up", "PM Visit"])

export default function DeputationList() {
  const qc = useQueryClient()
  const [date, setDate] = useState(today())

  // Approve modal state
  const [modal, setModal] = useState(null)   // null | { job }
  const [doneDate, setDoneDate] = useState("")
  const [doneNotes, setDoneNotes] = useState("")
  const [pmReqNum, setPmReqNum] = useState("")   // only shown when no plan linked + PM work
  const [approving, setApproving] = useState(false)
  const [approveErr, setApproveErr] = useState("")

  // Edit modal state
  const [editModal, setEditModal] = useState(null)  // null | { job }
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)

  // Technicians list for edit dropdown
  const { data: technicians = [] } = useQuery({
    queryKey: ["technicians-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("technicians").select("id, name, phone, office_id").eq("is_active", true).order("name")
      if (error) throw error
      return data
    },
    staleTime: 300000
  })

  // Fetch all jobs this month to detect same-site duplicates across days
  const yearMonth = date.slice(0, 7)
  const monthStart = yearMonth + "-01"
  const monthEnd = (() => { const d = new Date(monthStart); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10) })()

  const { data: monthJobs = [] } = useQuery({
    queryKey: ["deputation-month", yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deputation")
        .select("site_id, status")
        .gte("deputation_date", monthStart)
        .lte("deputation_date", monthEnd)
        .neq("status", "Cancelled")
      if (error) throw error
      return data
    },
    staleTime: 0
  })

  const monthDupSiteIds = useMemo(() => {
    const counts = {}
    monthJobs.forEach(j => { if (j.site_id) counts[j.site_id] = (counts[j.site_id] ?? 0) + 1 })
    const s = new Set()
    Object.entries(counts).forEach(([id, n]) => { if (n > 1) s.add(Number(id)) })
    return s
  }, [monthJobs])

  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ["deputation-list", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deputation")
        .select(`
          id, deputation_date, work_type, status, notes, other_task_desc, ref_number,
          sites(id, site_id, name, site_location, kva),
          technicians(id, name),
          pm_plan(id, pm_request_number, planned_date, service_type),
          complaints(id, complaint_number, cm_category)
        `)
        .eq("deputation_date", date)
        .order("technician_id")
        .order("id")
      if (error) throw error
      return data
    },
    staleTime: 0
  })

  // Group jobs by technician
  const grouped = jobs.reduce((acc, job) => {
    const key  = job.technicians?.id    ?? 0
    const name = job.technicians?.name  ?? "Unknown"
    if (!acc[key]) acc[key] = { name, items: [] }
    acc[key].items.push(job)
    return acc
  }, {})

  // ── approve handlers ──────────────────────────────────────────────────────

  const openApprove = job => {
    setModal({ job })
    setDoneDate(date)
    setDoneNotes("")
    setPmReqNum(job.ref_number ?? "")
    setApproveErr("")
  }

  const handleApprove = async () => {
    setApproveErr("")
    if (!doneDate) { setApproveErr("Completion date is required."); return }
    const job = modal.job
    setApproving(true)

    try {
      // 1. Update deputation status
      const { error: e1 } = await supabase
        .from("deputation")
        .update({ status: "Completed", notes: doneNotes || job.notes })
        .eq("id", job.id)
      if (e1) throw e1

      // 2. Update site's last_service_date if this is a real PM service
      if (PM_TYPES_FOR_SITE_UPDATE.has(job.work_type) && job.sites?.id) {
        const { error: e2 } = await supabase
          .from("sites")
          .update({ last_service_date: doneDate, last_service_type: job.work_type })
          .eq("id", job.sites.id)
        if (e2) throw e2
      }

      // 3. Update linked pm_plan → Done
      if (job.pm_plan?.id) {
        const { error: e3 } = await supabase
          .from("pm_plan")
          .update({ status: "Done", done_date: doneDate })
          .eq("id", job.pm_plan.id)
        if (e3) throw e3
      }
      // 4. No plan linked but PM-type work → create a new pm_plan with status Done
      else if (PM_TYPES_LINKED_TO_PLAN.has(job.work_type) && job.sites?.id) {
        const resolvedPmNum = pmReqNum.trim() || `DEP-${job.id}`
        const d = new Date(doneDate)
        const { data: newPlan, error: e4 } = await supabase
          .from("pm_plan")
          .insert({
            pm_request_number: resolvedPmNum,
            site_id:           job.sites.id,
            planned_date:      doneDate,
            service_type:      job.work_type === "PM Visit" ? "PM Visit" : job.work_type,
            plan_type:         "Internal",
            status:            "Done",
            done_date:         doneDate,
            month:             d.getMonth() + 1,
            year:              d.getFullYear(),
            assigned_to:       job.technicians?.id ?? null,
          })
          .select("id")
          .single()
        if (e4 && !e4.message?.includes("duplicate")) throw e4
        // Link the new pm_plan back to this deputation so the number stays live
        if (newPlan?.id) {
          await supabase.from("deputation").update({ pm_plan_id: newPlan.id }).eq("id", job.id)
        }
      }

      // 5. Auto-close linked complaint
      if (job.complaints?.id) {
        await supabase
          .from("complaints")
          .update({ work_status: "Closed", closed_date: doneDate })
          .eq("id", job.complaints.id)
      }

      qc.invalidateQueries({ queryKey: ["deputation-list"] })
      qc.invalidateQueries({ queryKey: ["pm-plans-map"] })
      qc.invalidateQueries({ queryKey: ["sites"] })
      qc.invalidateQueries({ queryKey: ["complaints"] })
      setModal(null)

    } catch (err) {
      setApproveErr(err.message ?? String(err))
    } finally {
      setApproving(false)
    }
  }

  const openEdit = job => {
    setEditModal({ job })
    setEditForm({
      deputation_date:      job.deputation_date,
      technician_id:        job.technicians?.id ?? "",
      work_type:            job.work_type,
      notes:                job.notes ?? "",
      other_task_desc:      job.other_task_desc ?? "",
      ref_number:           job.ref_number ?? "",
      pm_request_number:    job.pm_plan?.pm_request_number ?? "",
      complaint_number:     job.complaints?.complaint_number ?? "",
    })
  }

  const handleEditSave = async () => {
    setEditSaving(true)
    try {
      const { error } = await supabase
        .from("deputation")
        .update({
          deputation_date: editForm.deputation_date,
          technician_id:   editForm.technician_id || null,
          work_type:       editForm.work_type,
          notes:           editForm.notes || null,
          other_task_desc: editForm.work_type === "Other" ? editForm.other_task_desc : null,
          ref_number:      editForm.ref_number || null,
        })
        .eq("id", editModal.job.id)
      if (error) throw error

      // Update PM plan number in the linked pm_plan row
      if (editModal.job.pm_plan?.id) {
        const { error: epm } = await supabase
          .from("pm_plan")
          .update({ pm_request_number: editForm.pm_request_number })
          .eq("id", editModal.job.pm_plan.id)
        if (epm) throw epm
      }

      // Update CM number in the linked complaints row
      if (editModal.job.complaints?.id) {
        const { error: ecm } = await supabase
          .from("complaints")
          .update({ complaint_number: editForm.complaint_number })
          .eq("id", editModal.job.complaints.id)
        if (ecm) throw ecm
      }

      qc.invalidateQueries({ queryKey: ["deputation-list"] })
      qc.invalidateQueries({ queryKey: ["pm-plans-map"] })
      qc.invalidateQueries({ queryKey: ["complaints"] })
      setEditModal(null)
    } catch (err) {
      alert("Save failed: " + err.message)
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async (job) => {
    if (!window.confirm(`Delete this deputation entry (${job.work_type}${job.sites?.site_id ? " at " + job.sites.site_id : ""})?\nThis only removes the deputation record — it will NOT reverse any site or PM plan updates.`)) return
    const { error } = await supabase.from("deputation").delete().eq("id", job.id)
    if (error) { alert("Delete failed: " + error.message); return }
    qc.invalidateQueries({ queryKey: ["deputation-list"] })
  }

  const handleCancel = async (job) => {
    if (!window.confirm(`Cancel this deputation for ${job.sites?.site_id ?? "office work"}?`)) return
    const { error } = await supabase.from("deputation").update({ status: "Cancelled" }).eq("id", job.id)
    if (error) { alert("Error: " + error.message); return }
    // If a pm_plan was marked Assigned by this deputation → revert to Pending
    if (job.pm_plan?.id) {
      await supabase.from("pm_plan").update({ status: "Pending", assigned_to: null }).eq("id", job.pm_plan.id)
    }
    qc.invalidateQueries({ queryKey: ["deputation-list"] })
    qc.invalidateQueries({ queryKey: ["pm-plans-map"] })
  }

  const handleUndoDone = async (job) => {
    if (!window.confirm(`Undo "Done" for ${job.work_type}${job.sites?.site_id ? " at " + job.sites.site_id : ""}?\nThis reverts it back to Planned.`)) return
    const { error } = await supabase.from("deputation").update({ status: "Planned" }).eq("id", job.id)
    if (error) { alert("Error: " + error.message); return }
    // Revert linked complaint back to In Process
    if (job.complaints?.id) {
      await supabase.from("complaints").update({ work_status: "In Process", closed_date: null }).eq("id", job.complaints.id)
    }
    qc.invalidateQueries({ queryKey: ["deputation-list"] })
    qc.invalidateQueries({ queryKey: ["complaints"] })
  }

  // ── render ────────────────────────────────────────────────────────────────

  const completedCount = jobs.filter(j => j.status === "Completed").length
  const totalCount     = jobs.length

  return (
    <div style={{ padding: "20px 16px", maxWidth: 900 }}>

      {/* Date selector + summary */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>📅 Schedule</h3>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13 }}
        />
        <button onClick={() => setDate(shiftDate(date, -1))}
          style={{ padding: "6px 10px", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
          title="Previous day">‹</button>
        <button onClick={() => setDate(today())}
          style={{ padding: "6px 12px", background: date === today() ? "#1a73e8" : "#f1f5f9", color: date === today() ? "white" : "inherit", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: date === today() ? 700 : 400 }}>
          Today
        </button>
        <button onClick={() => setDate(shiftDate(date, 1))}
          style={{ padding: "6px 10px", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
          title="Next day">›</button>
        {!isLoading && totalCount > 0 && (
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {completedCount} / {totalCount} completed
          </span>
        )}
        <button onClick={() => refetch()} style={{ marginLeft: "auto", padding: "6px 10px", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          🔄 Refresh
        </button>
      </div>

      {isLoading && <div style={{ color: "#6b7280", fontSize: 14 }}>Loading…</div>}

      {!isLoading && totalCount === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af" }}>
          No deputation entries for {date}
        </div>
      )}

      {/* Grouped by technician */}
      {Object.entries(grouped).map(([techId, group]) => (
        <div key={techId} style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#374151", padding: "8px 0 6px", borderBottom: "2px solid #e2e8f0", marginBottom: 2 }}>
            👷 {group.name}
          </div>
          {group.items.map(job => {
            const sc = STATUS_COLORS[job.status] ?? STATUS_COLORS.Planned
            const isDupSite = job.status !== "Cancelled" && job.sites?.id && monthDupSiteIds.has(job.sites.id)
            return (
              <div
                key={job.id}
                style={{
                  display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: 8,
                  padding: "10px 12px", borderBottom: "1px solid #f3f4f6",
                  background: isDupSite ? "#fff1f2" : (job.status === "Completed" ? "#fafffe" : "white"),
                  borderLeft: isDupSite ? "3px solid #ef4444" : "3px solid transparent",
                  opacity: job.status === "Cancelled" ? 0.55 : 1
                }}
              >
                {/* Site + work info */}
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {job.sites?.site_id ?? <span style={{ color: "#9ca3af" }}>No site</span>}
                    {job.sites?.name && <span style={{ fontWeight: 400, color: "#6b7280", marginLeft: 6, fontSize: 12 }}>{job.sites.name}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {job.work_type}
                    {job.sites?.kva && <span style={{ marginLeft: 6 }}>{job.sites.kva} KVA</span>}
                    {job.other_task_desc && <span style={{ marginLeft: 6 }}>({job.other_task_desc})</span>}
                  </div>
                </div>

                {/* PM plan / complaint badge */}
                <div style={{ width: 160 }}>
                  {job.pm_plan && (
                    <div style={{ fontSize: 11, background: "#eff6ff", color: "#1d4ed8", padding: "3px 7px", borderRadius: 4 }}>
                      📋 {job.pm_plan.pm_request_number}
                      <br />
                      <span style={{ color: "#6b7280" }}>{job.pm_plan.planned_date}</span>
                    </div>
                  )}
                  {job.complaints && (
                    <div style={{ fontSize: 11, background: "#fff7ed", color: "#c2410c", padding: "3px 7px", borderRadius: 4, marginTop: 2 }}>
                      ⚠️ {job.complaints.complaint_number}
                    </div>
                  )}
                  {!job.pm_plan && !job.complaints && job.ref_number && (
                    <div style={{ fontSize: 11, background: "#f8fafc", color: "#475569", padding: "3px 7px", borderRadius: 4, marginTop: 2, border: "1px solid #e2e8f0" }}>
                      🔖 {job.ref_number}
                    </div>
                  )}

                  {job.notes && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>📝 {job.notes}</div>}
                </div>

                {/* Status */}
                <div style={{ width: 90, textAlign: "center" }}>
                  <span style={{ display: "inline-block", padding: "3px 10px", background: sc.bg, color: sc.color, borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                    {job.status}
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {job.status === "Planned" && (
                    <>
                      <button
                        onClick={() => openApprove(job)}
                        style={{ padding: "5px 12px", background: "#22c55e", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                      >
                        ✓ Done
                      </button>
                      <button
                        onClick={() => openEdit(job)}
                        style={{ padding: "5px 8px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleCancel(job)}
                        style={{ padding: "5px 8px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                        title="Cancel"
                      >
                        ✕
                      </button>
                    </>
                  )}
                  {job.status === "Completed" && (
                    <button
                      onClick={() => handleUndoDone(job)}
                      style={{ padding: "5px 10px", background: "#fef9c3", color: "#854d0e", border: "1px solid #fde68a", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                      title="Undo — revert to Planned"
                    >
                      ↩ Undo
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(job)}
                    style={{ padding: "5px 7px", background: "transparent", color: "#9ca3af", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {/* ── Approve Modal ── */}
      {modal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000
        }}>
          <div style={{
            background: "white", borderRadius: 12, padding: "24px", width: "min(94vw, 440px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.22)"
          }}>
            <h4 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>Mark as Done</h4>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
              <b>{modal.job.work_type}</b>{" "}
              {modal.job.sites?.site_id ? `at ${modal.job.sites.site_id}` : ""}
            </p>

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Completion Date <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="date" value={doneDate} onChange={e => setDoneDate(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 14, boxSizing: "border-box" }}
            />

            {/* PM Request Number — only shown for PM work with no linked plan */}
            {PM_TYPES_LINKED_TO_PLAN.has(modal.job.work_type) && !modal.job.pm_plan && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#374151" }}>
                  PM Request No. <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>(optional — auto-generated if blank)</span>
                </label>
                <input
                  value={pmReqNum} onChange={e => setPmReqNum(e.target.value)}
                  placeholder={`DEP-${modal.job.id}`}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
            )}

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Notes</label>
            <textarea
              value={doneNotes} onChange={e => setDoneNotes(e.target.value)}
              rows={2} placeholder="Any completion notes…"
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 14, boxSizing: "border-box", resize: "vertical" }}
            />

            {/* What will happen — summary */}
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "#475569", marginBottom: 14 }}>
              <b>Changes on confirm:</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                <li>Deputation → Completed</li>
                {PM_TYPES_FOR_SITE_UPDATE.has(modal.job.work_type) && modal.job.sites?.id && (
                  <li>site <b>{modal.job.sites.site_id}</b>.last_service_date → {doneDate}</li>
                )}
                {modal.job.pm_plan && <li>PM Plan <b>{modal.job.pm_plan.pm_request_number}</b> → Done</li>}
                {!modal.job.pm_plan && PM_TYPES_LINKED_TO_PLAN.has(modal.job.work_type) && (
                  <li>New PM plan record created (status: Done)</li>
                )}
              </ul>
            </div>

            {approveErr && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#dc2626", marginBottom: 12 }}>
                {approveErr}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleApprove}
                disabled={approving}
                style={{ flex: 1, padding: "10px", background: approving ? "#86efac" : "#22c55e", color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: approving ? "default" : "pointer" }}
              >
                {approving ? "Saving…" : "✅ Confirm Done"}
              </button>
              <button
                onClick={() => setModal(null)}
                disabled={approving}
                style={{ padding: "10px 18px", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 7, cursor: "pointer", fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Edit Modal ── */}
      {editModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div style={{ background: "white", borderRadius: 12, padding: 24, width: "min(94vw, 400px)", boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }}>
            <h4 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>✏️ Edit Deputation</h4>

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Date</label>
            <input type="date" value={editForm.deputation_date}
              onChange={e => setEditForm(f => ({ ...f, deputation_date: e.target.value }))}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
            />

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Technician</label>
            <select value={editForm.technician_id}
              onChange={e => setEditForm(f => ({ ...f, technician_id: e.target.value }))}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
            >
              <option value="">— select —</option>
              {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Work Type</label>
            <select value={editForm.work_type}
              onChange={e => setEditForm(f => ({ ...f, work_type: e.target.value }))}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
            >
              {WORK_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
            </select>

            {editForm.work_type === "Other" && (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Description</label>
                <input value={editForm.other_task_desc}
                  onChange={e => setEditForm(f => ({ ...f, other_task_desc: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
                />
              </>
            )}

            {editModal.job.pm_plan ? (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>PM Number</label>
                <input value={editForm.pm_request_number}
                  onChange={e => setEditForm(f => ({ ...f, pm_request_number: e.target.value }))}
                  placeholder="e.g. PM-2025-001"
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
                />
              </>
            ) : editModal.job.complaints ? (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>CM Number</label>
                <input value={editForm.complaint_number}
                  onChange={e => setEditForm(f => ({ ...f, complaint_number: e.target.value }))}
                  placeholder="e.g. CM-2025-001"
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
                />
              </>
            ) : (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Ref Number</label>
                <input value={editForm.ref_number}
                  onChange={e => setEditForm(f => ({ ...f, ref_number: e.target.value }))}
                  placeholder="Reference number"
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 12, boxSizing: "border-box" }}
                />
              </>
            )}

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Notes</label>
            <textarea value={editForm.notes} rows={2}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, marginBottom: 16, boxSizing: "border-box", resize: "vertical" }}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleEditSave} disabled={editSaving}
                style={{ flex: 1, padding: 10, background: editSaving ? "#93c5fd" : "#1a73e8", color: "white", border: "none", borderRadius: 7, fontWeight: 700, cursor: editSaving ? "default" : "pointer" }}
              >{editSaving ? "Saving…" : "💾 Save"}</button>
              <button onClick={() => setEditModal(null)} disabled={editSaving}
                style={{ padding: "10px 18px", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 7, cursor: "pointer", fontSize: 13 }}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
