// SitePopup.jsx
// Floating popup (top-right) shown when a map marker is clicked.
// Displays site details, lets field workers submit their GPS location,
// and lets admins verify a pending location update.

import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "../../lib/supabase"

// Haversine formula — returns straight-line distance in meters between two lat/lng points
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000
}

export default function SitePopup({ site, onClose }) {
  const queryClient = useQueryClient()

  // Field worker: capture current GPS and save as a pending location update.
  // Sets location_verified = false so admin reviews it before it becomes official.
  const handleUpdateLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported ❌")
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { data: updated, error } = await supabase
          .from("sites")
          .update({
            new_latitude: pos.coords.latitude,
            new_longitude: pos.coords.longitude,
            location_verified: null,          // explicitly clear any stale 'false' value
            location_updated_at: new Date().toISOString()
          })
          .eq("id", site.id)
          .select()

        console.log('SitePopup update result:', { updated, error })

        if (error) {
          alert("Failed ❌")
          console.error(error)
        } else {
          alert("Location submitted ✅")
          queryClient.invalidateQueries({ queryKey: ["sites"] })
          queryClient.invalidateQueries({ queryKey: ["pending-locations"] }) // refresh admin approval list too
        }
      },
      () => alert("Permission denied ❌")
    )
  }

  // Admin: promote the pending new_latitude/new_longitude to the official coordinates.
  // Clears new_latitude/new_longitude and marks location_verified = true.
  const handleVerify = async () => {
    const { error } = await supabase
      .from("sites")
      .update({
        latitude: site.new_latitude,
        longitude: site.new_longitude,
        location_verified: true,
        new_latitude: null,
        new_longitude: null
      })
      .eq("id", site.id)

    if (error) {
      alert("Verification failed ❌")
      console.error(error)
    } else {
      alert("Location verified ✅")
      queryClient.invalidateQueries({ queryKey: ["sites"] })
    }
  }

  // Only calculated when a pending new location exists
  const pendingDistance = site.new_latitude
    ? getDistance(site.latitude, site.longitude, site.new_latitude, site.new_longitude)
    : null

  return (
    <div style={{
      position: "absolute",
      top: "20px",
      right: "20px",
      width: "260px",
      background: "white",
      borderRadius: "10px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
      padding: "15px",
      zIndex: 1000
    }}>
      {/* Close popup */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "8px",
          right: "10px",
          border: "none",
          background: "transparent",
          cursor: "pointer"
        }}
      >
        ✖
      </button>

      <h3>{site.site_id}</h3>
      <p><b>Customer:</b> {site.customers?.name || site.name || "N/A"}</p>
      <p><b>Phone:</b> {site.contact_phone || "N/A"}</p>

      <hr />

      <p><b>Engine:</b> {site.engine_model || "N/A"} - {site.kva || "N/A"} KVA</p>
      <p><b>Status:</b> {site.genset_status}</p>
      <p><b>Last Service:</b> {site.last_service_date || "N/A"}</p>

      {/* Field worker submits their current GPS as a new pending location */}
      <button
        onClick={handleUpdateLocation}
        style={{
          marginTop: "10px",
          width: "100%",
          padding: "6px",
          background: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer"
        }}
      >
        📍 Send Current Location
      </button>

      {/* Shown only when a pending location exists and is awaiting admin verification */}
      {!site.location_verified && site.new_latitude && (
        <div style={{ marginTop: "10px", padding: "8px", background: "#fff3cd", borderRadius: "6px" }}>
          <p style={{ margin: 0 }}>📍 <b>New Location Pending</b></p>
          <p style={{ margin: "5px 0" }}>
            Distance: {Math.round(pendingDistance)} meters
            {pendingDistance > 100 && <span style={{ color: "red" }}> ⚠️ Check</span>}
          </p>
          {/* Admin button to accept the new coordinates as official */}
          <button
            onClick={handleVerify}
            style={{
              marginTop: "4px",
              width: "100%",
              padding: "6px",
              background: "green",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer"
            }}
          >
            ✅ Verify Location
          </button>
        </div>
      )}
    </div>
  )
}
