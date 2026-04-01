// PmPlanPopup.jsx — Popup shown on the map when a teal PM Plan marker is clicked
// Shows pm_plan details with the linked site info

export default function PmPlanPopup({ plan, onClose }) {
  if (!plan) return null
  const site = plan.sites
  const tech = plan.technicians

  const STATUS_STYLE = {
    Pending:  { bg: "#eff6ff", color: "#1d4ed8" },
    Assigned: { bg: "#fef9c3", color: "#854d0e" },
    Done:     { bg: "#f0fdf4", color: "#15803d" },
    Cancelled:{ bg: "#fef2f2", color: "#dc2626" },
  }
  const ss = STATUS_STYLE[plan.status] ?? STATUS_STYLE.Pending

  return (
    <div style={{
      position: "absolute",
      top: 20, right: 20,
      width: 272,
      background: "white",
      borderRadius: 12,
      boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
      zIndex: 1200,
      fontFamily: "sans-serif",
      overflow: "hidden",
    }}>
      {/* Top bar — teal */}
      <div style={{ background: "#0d9488", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "white" }}>📋 {plan.pm_request_number}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 1 }}>Planned PM</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "white", width: 26, height: 26, borderRadius: "50%", cursor: "pointer", fontWeight: 700, fontSize: 14, lineHeight: "26px", textAlign: "center" }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: "12px 14px" }}>
        {site && (
          <Row label="Site" value={`${site.site_id} · ${site.name ?? ""}`} />
        )}
        <Row label="Planned Date" value={plan.planned_date ?? "—"} />
        <Row label="Service Type" value={plan.service_type ?? "—"} />
        <Row label="Plan Type" value={plan.plan_type ?? "—"} />
        {plan.amc_type  && <Row label="AMC"  value={plan.amc_type} />}
        {plan.fold_status && <Row label="Fold" value={plan.fold_status} />}
        <Row
          label="Status"
          value={
            <span style={{ background: ss.bg, color: ss.color, padding: "2px 8px", borderRadius: 20, fontWeight: 700, fontSize: 11 }}>
              {plan.status}
            </span>
          }
        />
        {tech && <Row label="Assigned To" value={tech.name} />}

        {site && (
          <div style={{ borderTop: "1px solid #f3f4f6", marginTop: 10, paddingTop: 10 }}>
            {site.kva && <Row label="KVA" value={site.kva} />}
            {site.contact_person && <Row label="Contact" value={site.contact_person} />}
            {site.contact_phone && <Row label="Phone" value={site.contact_phone} />}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: "#9ca3af", minWidth: 90 }}>{label}</span>
      <span style={{ fontSize: 12, color: "#1f2937", fontWeight: 600, textAlign: "right", flex: 1 }}>
        {value ?? "—"}
      </span>
    </div>
  )
}
