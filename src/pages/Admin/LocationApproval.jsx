// LocationApproval.jsx
// Shows all sites where a field worker has submitted a new GPS location
// (new_latitude is set, location_verified = false).
// Admin can Approve (promote new coords to official) or Reject (discard new coords).

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "../../lib/supabase"

// Haversine formula — straight-line distance in meters between two lat/lng points
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000
}

export default function LocationApproval() {
  const queryClient = useQueryClient()

  // Only fetch sites that have a pending (unverified) new location
  const { data: pendingSites = [], isLoading, refetch } = useQuery({
    queryKey: ["pending-locations"],
    staleTime: 0,          // always fetch fresh — global default is 5 min which hides new submissions
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select(`
          id, site_id, name, latitude, longitude,
          new_latitude, new_longitude, location_updated_at,
          customers(name)
        `)
        .not("new_latitude", "is", null)   // pending = new_latitude is set
        .order("location_updated_at", { ascending: false })
      if (error) throw error
      return data
    }
  })

  // Approve: promote new_latitude/new_longitude to official coords, clear pending fields
  const handleApprove = async (site) => {
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
      alert("Approval failed ❌\n" + error.message)
      console.error(error)
    } else {
      alert(`✅ Location approved for ${site.site_id}`)
      queryClient.invalidateQueries({ queryKey: ["pending-locations"] })
      queryClient.invalidateQueries({ queryKey: ["sites"] })        // refresh map too
    }
  }

  // Reject: discard the new coordinates — old location stays unchanged
  const handleReject = async (site) => {
    if (!confirm(`Reject location update for ${site.site_id}?`)) return

    const { error } = await supabase
      .from("sites")
      .update({
        new_latitude: null,
        new_longitude: null
        // do NOT set location_verified=false — RLS hides rows with that value
      })
      .eq("id", site.id)

    if (error) {
      alert("Rejection failed ❌\n" + error.message)
      console.error(error)
    } else {
      alert(`❌ Location rejected for ${site.site_id}`)
      queryClient.invalidateQueries({ queryKey: ["pending-locations"] })
    }
  }

  if (isLoading) return <div style={{ padding: 20 }}>Loading pending locations...</div>

  if (pendingSites.length === 0) {
    return (
      <div style={{ padding: 20, color: "#555" }}>
        ✅ No pending location updates.
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <p style={{ color: "#555", marginBottom: 12 }}>
        {pendingSites.length} pending location update{pendingSites.length > 1 ? "s" : ""}
      </p>

      <table border="1" cellPadding="8" style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
        <thead style={{ background: "#f0f0f0", position: "sticky", top: 0 }}>
          <tr>
            <th>Site ID</th>
            <th>Customer</th>
            <th>Old Location</th>
            <th>New Location</th>
            <th>Distance (m)</th>
            <th>Submitted At</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {pendingSites.map(site => {
            const dist = Math.round(
              getDistance(site.latitude, site.longitude, site.new_latitude, site.new_longitude)
            )
            const isLarge = dist > 500   // flag suspiciously large moves

            return (
              <tr key={site.id} style={{ background: isLarge ? "#fff3cd" : "white" }}>
                <td><b>{site.site_id}</b></td>
                <td>{site.customers?.name || "—"}</td>

                {/* Old official coordinates */}
                <td style={{ color: "#888", fontFamily: "monospace" }}>
                  {parseFloat(site.latitude).toFixed(5)}, {parseFloat(site.longitude).toFixed(5)}
                </td>

                {/* New proposed coordinates */}
                <td style={{ fontFamily: "monospace" }}>
                  {parseFloat(site.new_latitude).toFixed(5)}, {parseFloat(site.new_longitude).toFixed(5)}
                </td>

                {/* Distance — highlight in red if unusually large */}
                <td style={{ textAlign: "center", fontWeight: "bold", color: isLarge ? "red" : "green" }}>
                  {dist} {isLarge && "⚠️"}
                </td>

                <td style={{ color: "#555", whiteSpace: "nowrap" }}>
                  {site.location_updated_at
                    ? new Date(site.location_updated_at).toLocaleString()
                    : "—"}
                </td>

                <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => handleApprove(site)}
                    style={{
                      marginRight: 6,
                      padding: "4px 12px",
                      background: "#22c55e",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: "bold"
                    }}
                  >
                    ✅ Approve
                  </button>
                  <button
                    onClick={() => handleReject(site)}
                    style={{
                      padding: "4px 12px",
                      background: "#ef4444",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer"
                    }}
                  >
                    ❌ Reject
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
