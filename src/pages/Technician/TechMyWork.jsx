// TechMyWork.jsx
// Shows today's deputation jobs assigned to the logged-in technician.
// Read-only — no status changes allowed from this view.

import { useQuery }  from "@tanstack/react-query"
import { supabase }  from "../../lib/supabase"
import { useAuth }   from "../../lib/AuthContext"

const STATUS_STYLE = {
  Planned:   { bg: "#eff6ff", color: "#1d4ed8", dot: "#3b82f6" },
  Completed: { bg: "#f0fdf4", color: "#15803d", dot: "#22c55e" },
  Cancelled: { bg: "#fef2f2", color: "#dc2626", dot: "#ef4444" },
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}

export default function TechMyWork() {
  const { user } = useAuth()
  const today    = todayStr()

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["tech-my-work", user?.technicianId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deputation")
        .select(`
          id, work_type, status, notes,
          sites(site_id, name, site_location, kva, engine_model),
          pm_plan(pm_request_number),
          complaints(complaint_number)
        `)
        .eq("technician_id", user.technicianId)
        .eq("deputation_date", today)
        .neq("status", "Cancelled")
        .order("id")
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.technicianId,
    staleTime: 0,
  })

  const planned   = jobs.filter(j => j.status === "Planned").length
  const completed = jobs.filter(j => j.status === "Completed").length

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "#f8fafc" }}>

      {/* Day header */}
      <div style={{
        background: "#1e293b", color: "white",
        padding: "14px 16px 12px",
      }}>
        <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 2 }}>{today}</div>
        <div style={{ fontWeight: 800, fontSize: 17 }}>Today's Work</div>
        {!isLoading && jobs.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", gap: 10 }}>
            <Pill bg="#3b82f6" color="white">{planned} Planned</Pill>
            <Pill bg="#22c55e" color="white">{completed} Done</Pill>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {isLoading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94a3b8", fontSize: 14 }}>
            Loading…
          </div>
        )}

        {!isLoading && jobs.length === 0 && (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            color: "#94a3b8", fontSize: 14
          }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
            No work assigned for today.
          </div>
        )}

        {jobs.map((job, i) => {
          const ss      = STATUS_STYLE[job.status] ?? STATUS_STYLE.Planned
          const pmNum   = job.pm_plan?.pm_request_number ?? job.complaints?.complaint_number ?? null
          const site    = job.sites

          return (
            <div key={job.id} style={{
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "14px 14px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
            }}>
              {/* Row 1: index + work type + status */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  background: "#f1f5f9", color: "#64748b",
                  fontWeight: 700, fontSize: 11,
                  borderRadius: 6, padding: "2px 7px",
                  flexShrink: 0,
                }}>
                  #{i + 1}
                </span>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", flex: 1 }}>
                  {job.work_type}
                </span>
                <span style={{
                  background: ss.bg, color: ss.color,
                  fontWeight: 700, fontSize: 11,
                  borderRadius: 20, padding: "3px 10px",
                  flexShrink: 0,
                }}>
                  <span style={{
                    display: "inline-block", width: 6, height: 6,
                    borderRadius: "50%", background: ss.dot,
                    marginRight: 5, verticalAlign: "middle",
                    marginTop: -1,
                  }} />
                  {job.status}
                </span>
              </div>

              {/* Row 2: site info */}
              {site ? (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#374151" }}>
                    {site.name || "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    {site.site_id && (
                      <span style={{
                        fontFamily: "monospace", background: "#f1f5f9",
                        padding: "1px 6px", borderRadius: 4, marginRight: 6,
                      }}>
                        {site.site_id}
                      </span>
                    )}
                    {site.site_location && <span>{site.site_location}</span>}
                  </div>
                  {(site.kva || site.engine_model) && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                      {[site.kva && `${site.kva} KVA`, site.engine_model].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 6 }}>Office / other</div>
              )}

              {/* Row 3: PM/CM number + notes */}
              {pmNum && (
                <div style={{ fontSize: 12, color: "#1d4ed8", fontFamily: "monospace", marginBottom: 4 }}>
                  🔖 {pmNum}
                </div>
              )}
              {job.notes && (
                <div style={{
                  fontSize: 12, color: "#6b7280",
                  background: "#f8fafc", borderRadius: 6,
                  padding: "6px 8px", marginTop: 4,
                }}>
                  📝 {job.notes}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Pill({ bg, color, children }) {
  return (
    <span style={{
      background: bg, color,
      padding: "2px 10px", borderRadius: 20,
      fontWeight: 600, fontSize: 12,
    }}>
      {children}
    </span>
  )
}
