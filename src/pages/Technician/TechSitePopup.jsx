// TechSitePopup.jsx
// Popup for the Technician view.  Shows site details, distance from the tech's
// current position, and two ways to submit a corrected location:
//   1. "Use My GPS"  — captures the device's live GPS co-ordinates
//   2. "Drag / Tap"  — lets the tech position a draggable pin on the map

import { useState, useEffect, useRef } from "react"
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

  // Prevent ghost-tap: disable action buttons for 450ms after popup mounts
  const [buttonsReady, setButtonsReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setButtonsReady(true), 450)
    return () => clearTimeout(t)
  }, [])

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
      position: "absolute",
      top: 0, left: 0, right: 0,
      width: "100%",
      maxHeight: "38vh",
      overflowY: "auto",
      background: "white",
      borderRadius: "0 0 14px 14px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
      padding: "6px 6px 8px 10px",
      paddingTop: 32,
      zIndex: 1000
    } : {
      position: "absolute",
      top: 20,
      right: 20,
      width: 272,
      background: "white",
      borderRadius: 12,
      boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
      padding: "14px",
      zIndex: 1000
    }}>
      {/* Close */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 6, right: 8,
          border: "none", background: "#f1f5f9",
          cursor: "pointer", fontSize: 15, color: "#475569",
          width: 28, height: 28, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, zIndex: 10, flexShrink: 0
        }}
      >✕</button>

      {/* Site ID and Phone on same line */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{site.site_id}</span>
        <span style={{ fontSize: 12, color: "#555" }}>📞 {site.contact_phone || "N/A"}</span>
      </div>
      {/* Customer name */}
      <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>
        {site.customers?.name || site.name || "N/A"}
      </div>

      {/* Engine and Status on same line */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 2 }}>
        <span>⚙️ {site.engine_model || "N/A"} {site.kva ? `· ${site.kva} KVA` : ""}</span>
        <span style={{ color: site.genset_status === "Inactive" ? "red" : "#333", fontWeight: 600 }}>{site.genset_status}</span>
      </div>

      {/* Last PM and PM Due */}
      <div style={{ fontSize: 12, color: pmDue ? "#e65100" : "#2e7d32", fontWeight: 500, marginBottom: 2 }}>
        Last PM: {site.last_service_date || "Never"}{pmDue && "  ⚠️ Due"}
      </div>

      {/* Distance badge */}
      {distanceMeters != null && (
        <div style={{
          margin: "6px 0 2px 0", padding: "3px 8px",
          background: "#e8f4fd", borderRadius: 6,
          fontSize: 12, color: "#1a73e8", fontWeight: 500,
          display: "inline-block"
        }}>
          📍 {formatDist(distanceMeters)} from you
        </div>
      )}

      {/* Pending badge */}
      {site.new_latitude && (
        <div style={{
          margin: "4px 0 2px 0", padding: "3px 7px",
          background: "#fff3cd", borderRadius: 6, fontSize: 11, color: "#856404",
          display: "inline-block"
        }}>
          ⏳ Location update pending approval
        </div>
      )}

      <hr style={{ margin: "8px 0 6px 0", borderColor: "#f0f0f0" }} />

      {/* ── Normal mode: two action buttons ── */}
      {!isDragMode ? (
        <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
          <button
            onClick={handleSendGPS}
            disabled={gpsLoading || !buttonsReady}
            style={{
              flex: 1,
              padding: "8px 0",
              background: (gpsLoading || !buttonsReady) ? "#90caf9" : "#1a73e8",
              color: "white", border: "none", borderRadius: 7,
              cursor: (gpsLoading || !buttonsReady) ? "default" : "pointer", fontSize: 12, fontWeight: 600
            }}
          >
            {gpsLoading ? "Getting GPS…" : "📍 Use My GPS"}
          </button>
          <button
            onClick={onStartDragMode}
            disabled={!buttonsReady}
            style={{
              flex: 1,
              padding: "8px 0",
              background: !buttonsReady ? "#c4a8e8" : "#6f42c1", color: "white",
              border: "none", borderRadius: 7,
              cursor: !buttonsReady ? "default" : "pointer", fontSize: 12, fontWeight: 600
            }}
          >
            🎯 Drag / Tap
          </button>
        </div>
      ) : (
        /* ── Drag-pin mode: confirm / cancel ── */
        <>
          <p style={{ fontSize: 11, color: "#555", textAlign: "center", margin: "0 0 6px" }}>
            Drag the purple pin <b>or</b> tap anywhere on the map to place the new location.
          </p>

          {dragPinPos ? (
            <p style={{ fontSize: 10, color: "#888", textAlign: "center", margin: "0 0 6px" }}>
              {dragPinPos.lat.toFixed(6)}, {dragPinPos.lng.toFixed(6)}
            </p>
          ) : (
            <p style={{ fontSize: 10, color: "#aaa", textAlign: "center", margin: "0 0 6px" }}>
              Tap the map to place the pin…
            </p>
          )}

          <button
            onClick={handleConfirmPin}
            disabled={!dragPinPos || saveLoading}
            style={{
              width: "100%", padding: "8px 0", marginBottom: 5,
              background: dragPinPos ? "#28a745" : "#ccc",
              color: "white", border: "none", borderRadius: 7,
              cursor: dragPinPos ? "pointer" : "default",
              fontSize: 12, fontWeight: 600
            }}
          >
            {saveLoading ? "Saving…" : "✅ Confirm Location"}
          </button>

          <button
            onClick={onCancelDragMode}
            style={{
              width: "100%", padding: "6px 0",
              background: "transparent", color: "#888",
              border: "1px solid #ddd", borderRadius: 7,
              cursor: "pointer", fontSize: 11
            }}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  )
}
