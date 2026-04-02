// TechSitePopup.jsx
// Popup for the Technician view.  Shows site details, distance from the tech's
// current position, and two ways to submit a corrected location:
//   1. "Use My GPS"  — captures the device's live GPS co-ordinates
//   2. "Drag / Tap"  — lets the tech position a draggable pin on the map

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "../../lib/supabase"

function formatDist(meters) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`
}

export default function TechSitePopup({
  site,
  distanceMeters,      // metres from tech location, or null
  onClose,
  isDragMode,
  dragPinPos,          // { lat, lng } | null
  onStartDragMode,
  onCancelDragMode,
  onConfirmDragLocation,
  isMobile             // passed from TechnicianView
}) {
  const queryClient = useQueryClient()
  const [gpsLoading, setGpsLoading]   = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)

  const pmDue = site.last_service_date
    ? (Date.now() - new Date(site.last_service_date)) / 86400000 > 180
    : true

  // ── Approach 1: live GPS ──────────────────────────────────────────────────
  const handleSendGPS = () => {
    if (!navigator.geolocation) { alert("Geolocation not supported ❌"); return }

    // Confirm before submitting — prevents accidental taps
    const ok = window.confirm(
      `Submit your current GPS as the new location for ${site.site_id}?\n\nThis will be sent to the admin for approval.`
    )
    if (!ok) return

    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { error } = await supabase
          .from("sites")
          .update({
            new_latitude:       pos.coords.latitude,
            new_longitude:      pos.coords.longitude,
            location_verified:  null,
            location_updated_at: new Date().toISOString()
          })
          .eq("id", site.id)

        setGpsLoading(false)
        if (error) {
          alert("Failed ❌"); console.error(error)
        } else {
          alert("Location submitted ✅")
          queryClient.invalidateQueries({ queryKey: ["sites"] })
          queryClient.invalidateQueries({ queryKey: ["pending-locations"] })
        }
      },
      () => { setGpsLoading(false); alert("Permission denied ❌") },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // ── Approach 2: confirm dragged / tapped pin ──────────────────────────────
  const handleConfirmPin = async () => {
    if (!dragPinPos) return
    setSaveLoading(true)
    const { error } = await supabase
      .from("sites")
      .update({
        new_latitude:       dragPinPos.lat,
        new_longitude:      dragPinPos.lng,
        location_verified:  null,
        location_updated_at: new Date().toISOString()
      })
      .eq("id", site.id)

    setSaveLoading(false)
    if (error) {
      alert("Failed ❌"); console.error(error)
    } else {
      alert("Location submitted ✅")
      queryClient.invalidateQueries({ queryKey: ["sites"] })
      queryClient.invalidateQueries({ queryKey: ["pending-locations"] })
      onConfirmDragLocation()
    }
  }

  return (
    <div style={isMobile ? {
      // Mobile: full-width bar pinned to the top of the map area
      position:     "absolute",
      top:          0, left: 0, right: 0,
      width:        "100%",
      maxHeight:    "44vh",
      overflowY:    "auto",
      background:   "white",
      borderRadius:  "0 0 14px 14px",
      boxShadow:    "0 4px 20px rgba(0,0,0,0.22)",
      padding:      "8px 12px 10px",
      paddingTop:   36,
      zIndex:       1000
    } : {
      // Desktop: floating card top-right
      position:     "absolute",
      top:          20,
      right:        20,
      width:        272,
      background:   "white",
      borderRadius: 12,
      boxShadow:    "0 4px 20px rgba(0,0,0,0.22)",
      padding:      "16px",
      zIndex:       1000
    }}>
      {/* Close */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 8, right: 10,
          border: "none", background: "#f1f5f9",
          cursor: "pointer", fontSize: 13, color: "#475569",
          width: 28, height: 28, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, zIndex: 10, flexShrink: 0
        }}
      >✕</button>

      {/* Site identity */}
      <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>{site.site_id}</h3>
      <p style={{ margin: "2px 0", fontSize: 13, color: "#555" }}>
        <b>Customer:</b> {site.customers?.name || site.name || "N/A"}
      </p>
      <p style={{ margin: "2px 0", fontSize: 13, color: "#555" }}>
        <b>Phone:</b> {site.contact_phone || "N/A"}
      </p>

      {/* Distance badge */}
      {distanceMeters != null && (
        <div style={{
          marginTop: 8, padding: "5px 10px",
          background: "#e8f4fd", borderRadius: 6,
          fontSize: 13, color: "#1a73e8", fontWeight: 500
        }}>
          📍 {formatDist(distanceMeters)} from you
        </div>
      )}

      <hr style={{ margin: "10px 0", borderColor: "#f0f0f0" }} />

      {/* Engine / status */}
      <p style={{ margin: "2px 0", fontSize: 13, color: "#555" }}>
        <b>Engine:</b> {site.engine_model || "N/A"} — {site.kva || "N/A"} KVA
      </p>
      <p style={{ margin: "2px 0", fontSize: 13, color: "#555" }}>
        <b>Status:</b>{" "}
        <span style={{ color: site.genset_status === "Inactive" ? "red" : "#333" }}>
          {site.genset_status}
        </span>
      </p>
      <p style={{ margin: "2px 0", fontSize: 13, color: "#555" }}>
        <b>Last PM:</b>{" "}
        <span style={{ color: pmDue ? "#e65100" : "#2e7d32", fontWeight: 500 }}>
          {site.last_service_date || "Never"}
          {pmDue && "  ⚠️ Due"}
        </span>
      </p>

      {/* Pending badge */}
      {site.new_latitude && (
        <div style={{
          marginTop: 8, padding: "5px 8px",
          background: "#fff3cd", borderRadius: 6, fontSize: 12, color: "#856404"
        }}>
          ⏳ Location update pending approval
        </div>
      )}

      <hr style={{ margin: "10px 0", borderColor: "#f0f0f0" }} />

      {/* ── Normal mode: two action buttons ── */}
      {!isDragMode ? (
        <>
          <button
            onClick={handleSendGPS}
            disabled={gpsLoading}
            style={{
              width: "100%", padding: "9px", marginBottom: 7,
              background: gpsLoading ? "#90caf9" : "#1a73e8",
              color: "white", border: "none", borderRadius: 7,
              cursor: gpsLoading ? "default" : "pointer", fontSize: 13, fontWeight: 600
            }}
          >
            {gpsLoading ? "Getting GPS…" : "📍 Use My Current GPS"}
          </button>

          <button
            onClick={onStartDragMode}
            style={{
              width: "100%", padding: "9px",
              background: "#6f42c1", color: "white",
              border: "none", borderRadius: 7,
              cursor: "pointer", fontSize: 13, fontWeight: 600
            }}
          >
            🎯 Drag / Tap on Map
          </button>
        </>
      ) : (
        /* ── Drag-pin mode: confirm / cancel ── */
        <>
          <p style={{ fontSize: 12, color: "#555", textAlign: "center", margin: "0 0 8px" }}>
            Drag the purple pin <b>or</b> tap anywhere on the map to place the new location.
          </p>

          {dragPinPos ? (
            <p style={{ fontSize: 11, color: "#888", textAlign: "center", margin: "0 0 8px" }}>
              {dragPinPos.lat.toFixed(6)}, {dragPinPos.lng.toFixed(6)}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", margin: "0 0 8px" }}>
              Tap the map to place the pin…
            </p>
          )}

          <button
            onClick={handleConfirmPin}
            disabled={!dragPinPos || saveLoading}
            style={{
              width: "100%", padding: "9px", marginBottom: 7,
              background: dragPinPos ? "#28a745" : "#ccc",
              color: "white", border: "none", borderRadius: 7,
              cursor: dragPinPos ? "pointer" : "default",
              fontSize: 13, fontWeight: 600
            }}
          >
            {saveLoading ? "Saving…" : "✅ Confirm This Location"}
          </button>

          <button
            onClick={onCancelDragMode}
            style={{
              width: "100%", padding: "7px",
              background: "transparent", color: "#888",
              border: "1px solid #ddd", borderRadius: 7,
              cursor: "pointer", fontSize: 12
            }}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  )
}
