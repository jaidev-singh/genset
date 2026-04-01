// TechnicianView.jsx
// Full-screen map for field technicians.
//
// Features:
//   • "My Location" button → gets GPS, re-centers map, shows pulsing blue dot
//   • Radius slider (1–20 km) → live circle on map + filters the nearby-sites list
//   • Nearby-sites sidebar (sorted by distance, collapsible)
//   • Same-color markers as admin map (purple/orange/red/pink)
//   • Click marker or list item → opens TechSitePopup with distance badge
//   • GPS submit  OR  Drag-pin / tap-on-map to propose a new site location

import { useState, useMemo, useRef, useEffect } from "react"
import { useQuery }                   from "@tanstack/react-query"
import {
  GoogleMap, useJsApiLoader,
  Marker, Circle, OverlayView
} from "@react-google-maps/api"
import { fetchSites }     from "../../services/sites"
import TechSitePopup      from "./TechSitePopup"

const DEFAULT_CENTER = { lat: 28.36, lng: 79.43 }
const DEFAULT_ZOOM   = 8

// ── helpers ─────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R  = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a  =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getMarkerColor(site) {
  if (site.new_latitude != null) return "pink"
  const last    = site.last_service_date ? new Date(site.last_service_date) : null
  const isPmDue = last ? (Date.now() - last) / 86400000 > 180 : false
  if (site.genset_status === "Inactive") return "red"
  if (isPmDue) return "orange"
  return "purple"
}

function formatDist(meters) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`
}

// ── component ────────────────────────────────────────────────────────────────

export default function TechnicianView() {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY
  })

  const mapRef = useRef(null)

  // mobile detection — re-evaluates on orientation change
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // tech's confirmed GPS position
  const [techLocation, setTechLocation] = useState(null)
  const [locLoading,   setLocLoading]   = useState(false)

  // radius slider (km)
  const [radius, setRadius] = useState(5)

  // sidebar open/closed — open by default on desktop, collapsed on mobile
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640)

  // selected site (enriched with _distance)
  const [selectedSite, setSelectedSite] = useState(null)

  // drag-pin / tap-on-map mode
  const [dragPinMode, setDragPinMode] = useState(false)
  const [dragPinPos,  setDragPinPos]  = useState(null)  // { lat, lng }

  // ── data ──────────────────────────────────────────────────────────────────

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn:  fetchSites,
    staleTime: 0
  })

  // Sites with coordinates, annotated with distance, filtered by radius
  const nearbySites = useMemo(() => {
    if (!techLocation) return []
    return sites
      .filter(s => s.latitude != null && s.longitude != null)
      .map(s => ({
        ...s,
        _distance: haversineMeters(
          techLocation.lat, techLocation.lng,
          parseFloat(s.latitude), parseFloat(s.longitude)
        )
      }))
      .filter(s => s._distance <= radius * 1000)
      .sort((a, b) => a._distance - b._distance)
  }, [sites, techLocation, radius])

  // ── handlers ──────────────────────────────────────────────────────────────

  const handleGetLocation = () => {
    if (!navigator.geolocation) { alert("Geolocation not supported"); return }
    setLocLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setTechLocation(loc)
        setLocLoading(false)
        if (mapRef.current) {
          mapRef.current.setCenter(loc)
          mapRef.current.setZoom(13)
        }
      },
      () => { setLocLoading(false); alert("Location permission denied ❌") },
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }

  const openSite = (site) => {
    // cancel drag mode when switching to a different site
    setDragPinMode(false)
    setDragPinPos(null)
    // on mobile, collapse the bottom sheet so the map is visible
    if (window.innerWidth < 640) setPanelOpen(false)

    const lat = parseFloat(site.latitude)
    const lng = parseFloat(site.longitude)
    setSelectedSite({
      ...site,
      _distance: techLocation
        ? haversineMeters(techLocation.lat, techLocation.lng, lat, lng)
        : null
    })
    if (mapRef.current) {
      // panTo animates smoothly; setCenter was causing the hard "jump"
      mapRef.current.panTo({ lat, lng })
      // only zoom in if we're currently too far out — don't re-zoom on every tap
      if ((mapRef.current.getZoom() ?? 0) < 14) mapRef.current.setZoom(15)
    }
  }

  const handleStartDragMode = () => {
    const lat = parseFloat(selectedSite.latitude)
    const lng = parseFloat(selectedSite.longitude)
    // Place the drag pin on the site's current official location as the starting point
    setDragPinPos({ lat, lng })
    setDragPinMode(true)
    // Zoom in a little more so the pin is easy to drag precisely
    if (mapRef.current) {
      if ((mapRef.current.getZoom() ?? 0) < 16) mapRef.current.setZoom(16)
    }
  }

  const handleCancelDragMode = () => {
    setDragPinMode(false)
    setDragPinPos(null)
  }

  const handleConfirmDragLocation = () => {
    setDragPinMode(false)
    setDragPinPos(null)
  }

  const handleMapClick = e => {
    if (dragPinMode) {
      setDragPinPos({ lat: e.latLng.lat(), lng: e.latLng.lng() })
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (!isLoaded) return <div style={{ padding: 20 }}>Loading map…</div>

  return (
    <div style={{ height: "100vh", width: "100%", display: "flex", overflow: "hidden", position: "relative" }}>

      {/* ── Pulse keyframe (injected once) ────────────────────────────────── */}
      <style>{`
        @keyframes tech-pulse {
          0%   { transform: scale(1);   opacity: 0.7; }
          100% { transform: scale(3.2); opacity: 0;   }
        }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════
          Nearby-sites sidebar
      ══════════════════════════════════════════════════════════════════ */}
      <div style={isMobile ? {
        // Mobile: bottom sheet that slides up from the bottom
        position:  "absolute",
        bottom: 0, left: 0, right: 0,
        width:     "100%",
        height:    panelOpen ? "55vh" : "44px",
        background: "#fff",
        overflowY:  panelOpen ? "auto" : "hidden",
        transition: "height 0.3s ease",
        boxShadow:  "0 -3px 16px rgba(0,0,0,0.14)",
        display:    "flex",
        flexDirection: "column",
        zIndex:     950,
        borderTopLeftRadius: 16, borderTopRightRadius: 16
      } : {
        // Desktop: left sidebar
        width:      panelOpen ? 280 : 0,
        minWidth:   0,
        flexShrink: 0,
        background:  "#fff",
        overflowY:   panelOpen ? "auto" : "hidden",
        overflowX:   "hidden",
        transition:  "width 0.25s ease",
        boxShadow:   panelOpen ? "3px 0 12px rgba(0,0,0,0.10)" : "none",
        display:     "flex",
        flexDirection: "column",
        zIndex:     900
      }}>
        {/* Panel header — tappable on mobile to expand/collapse */}
        <div
          onClick={isMobile ? () => setPanelOpen(o => !o) : undefined}
          style={{
            padding: isMobile ? "10px 16px 8px" : "14px 16px 10px",
            borderBottom: "1px solid #eee",
            flexShrink: 0,
            whiteSpace: "nowrap",
            cursor: isMobile ? "pointer" : "default",
            userSelect: "none"
          }}
        >
          {/* Drag handle indicator (mobile only) */}
          {isMobile && (
            <div style={{
              width: 36, height: 4, background: "#ddd",
              borderRadius: 2, margin: "0 auto 8px"
            }} />
          )}
          <div style={{ fontWeight: 700, fontSize: 15, color: "#222" }}>
            Nearby Sites{isMobile ? (panelOpen ? " ▾" : " ▴") : ""}
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            {techLocation
              ? `${nearbySites.length} site${nearbySites.length !== 1 ? "s" : ""} within ${radius} km`
              : "Press My Location first"}
          </div>
        </div>

        {/* Panel body */}
        {!techLocation ? (
          <div style={{ padding: 20, fontSize: 13, color: "#bbb", textAlign: "center" }}>
            📍 Get your location to see nearby sites
          </div>
        ) : nearbySites.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: "#bbb", textAlign: "center" }}>
            No sites within {radius} km.<br />Try increasing the radius.
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {nearbySites.map(site => {
              const pmDue = site.last_service_date
                ? (Date.now() - new Date(site.last_service_date)) / 86400000 > 180
                : true
              const isSelected = selectedSite?.id === site.id
              const dotColor   =
                site.genset_status === "Inactive" ? "#d32f2f"
                : pmDue                           ? "#e65100"
                :                                   "#2e7d32"

              return (
                <div
                  key={site.id}
                  onClick={() => openSite(site)}
                  style={{
                    padding:    "10px 16px",
                    borderBottom: "1px solid #f3f3f3",
                    cursor:     "pointer",
                    background: isSelected ? "#e8f4fd" : "white",
                    borderLeft: isSelected ? "3px solid #1a73e8" : "3px solid transparent",
                    transition: "background 0.15s"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{site.site_id}</span>
                    <span style={{ fontSize: 12, color: "#1a73e8", fontWeight: 600 }}>
                      {formatDist(site._distance)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                    {site.customers?.name || site.name || "—"}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 3 }}>
                    <span style={{ color: dotColor }}>⬤</span>{" "}
                    <span style={{ color: "#777" }}>
                      {site.genset_status === "Inactive" ? "Inactive"
                        : pmDue ? "PM Due"
                        : "OK"}
                    </span>
                    {site.new_latitude && (
                      <span style={{ color: "#856404", marginLeft: 6 }}>⏳ Pending</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          Map area
      ══════════════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, position: "relative" }}>

        {/* ── Sidebar toggle (desktop only — mobile uses the bottom-sheet handle) ── */}
        {!isMobile && (
          <button
            onClick={() => setPanelOpen(o => !o)}
            title={panelOpen ? "Hide panel" : "Show nearby sites"}
            style={{
              position: "absolute", top: 12, left: 8, zIndex: 901,
              background: "white", border: "none", borderRadius: 8,
              boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
              width: 36, height: 36, cursor: "pointer",
              fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center"
            }}
          >
            {panelOpen ? "◀" : "☰"}
          </button>
        )}

        {/* ── Location + radius controls (top-centre) ────────────────────── */}
        <div style={{
          position:  "absolute",
          top:       12,
          left:      "50%",
          transform: "translateX(-50%)",
          zIndex:    900,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
          padding:   isMobile ? "8px 12px" : "12px 18px",
          display:   "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          width:     isMobile ? "calc(100vw - 80px)" : undefined,
          minWidth:  isMobile ? undefined : 230,
          maxWidth:  320
        }}>
          <button
            onClick={handleGetLocation}
            disabled={locLoading}
            style={{
              padding: "9px 16px",
              background: locLoading ? "#90caf9" : "#1a73e8",
              color: "white", border: "none", borderRadius: 8,
              cursor: locLoading ? "default" : "pointer",
              fontSize: 14, fontWeight: 700, width: "100%"
            }}
          >
            {locLoading
              ? "Locating…"
              : techLocation
                ? "🔄 Refresh My Location"
                : "📍 My Location"}
          </button>

          <div style={{ width: "100%" }}>
            <div style={{
              display: "flex", justifyContent: "space-between",
              fontSize: 12, color: "#555", marginBottom: 4
            }}>
              <span>Search Radius</span>
              <strong style={{ color: "#1a73e8" }}>{radius} km</strong>
            </div>
            <input
              type="range" min={1} max={20} value={radius}
              onChange={e => setRadius(Number(e.target.value))}
              disabled={!techLocation}
              style={{ width: "100%", accentColor: "#1a73e8" }}
            />
          </div>
        </div>

        {/* ── Drag-mode banner (bottom-centre, above bottom sheet on mobile) ── */}
        {dragPinMode && (
          <div style={{
            position:  "absolute",
            bottom:    isMobile ? 56 : 24,
            left:      "50%",
            transform: "translateX(-50%)",
            zIndex:    951,
            background: "#6f42c1",
            color:     "white",
            padding:   "10px 20px",
            borderRadius: 10,
            fontSize:  13,
            fontWeight: 600,
            boxShadow: "0 3px 10px rgba(0,0,0,0.28)",
            pointerEvents: "none",
            whiteSpace: "nowrap"
          }}>
            🎯 Tap map or drag the pin
          </div>
        )}

        {/* ── Google Map ────────────────────────────────────────────────── */}
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: "100%" }}
          onLoad={map => {
            mapRef.current = map
            map.setCenter(DEFAULT_CENTER)
            map.setZoom(DEFAULT_ZOOM)
          }}
          onClick={handleMapClick}
          options={{ cursor: dragPinMode ? "crosshair" : undefined }}
        >
          {/* Radius circle */}
          {techLocation && (
            <Circle
              center={techLocation}
              radius={radius * 1000}
              options={{
                strokeColor:   "#1a73e8",
                strokeOpacity: 0.65,
                strokeWeight:  2,
                fillColor:     "#1a73e8",
                fillOpacity:   0.07
              }}
            />
          )}

          {/* Nearby site markers */}
          {nearbySites.map(site => {
            const lat = parseFloat(site.latitude)
            const lng = parseFloat(site.longitude)
            const color = getMarkerColor(site)
            return (
              <Marker
                key={site.id}
                position={{ lat, lng }}
                icon={{
                  url: selectedSite?.id === site.id
                    ? `http://maps.google.com/mapfiles/ms/icons/${color}-pushpin.png`
                    : `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png`
                }}
                onClick={() => {
                  if (dragPinMode) return // ignore marker clicks while placing pin
                  openSite(site)
                }}
              />
            )
          })}

          {/* Draggable location pin (drag-mode only) — bold custom SVG so it's unmistakable */}
          {dragPinMode && dragPinPos && (
            <Marker
              position={dragPinPos}
              draggable
              zIndex={999}
              onDragEnd={e =>
                setDragPinPos({ lat: e.latLng.lat(), lng: e.latLng.lng() })
              }
              icon={{
                url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
                  `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="58" viewBox="0 0 44 58">
                    <!-- Bold teardrop body -->
                    <path d="M22 0C9.8 0 0 9.8 0 22c0 15.5 22 36 22 36s22-20.5 22-36C44 9.8 34.2 0 22 0z"
                          fill="#4a00e0" stroke="#1a0060" stroke-width="2.5"/>
                    <!-- White inner ring -->
                    <circle cx="22" cy="22" r="9" fill="white" stroke="#4a00e0" stroke-width="2"/>
                    <!-- Crosshair dot in centre -->
                    <circle cx="22" cy="22" r="3.5" fill="#4a00e0"/>
                  </svg>`
                )}`,
                scaledSize: new window.google.maps.Size(44, 58),
                anchor:     new window.google.maps.Point(22, 58)
              }}
            />
          )}

          {/* Tech's pulsing blue dot */}
          {techLocation && (
            <OverlayView
              position={techLocation}
              mapPaneName="overlayLayer"
            >
              <div style={{
                position: "relative",
                width: 0, height: 0,
                pointerEvents: "none"
              }}>
                {/* Expanding pulse ring */}
                <div style={{
                  position:        "absolute",
                  width:           28,
                  height:          28,
                  borderRadius:    "50%",
                  background:      "rgba(26, 115, 232, 0.45)",
                  top:             -14,
                  left:            -14,
                  transformOrigin: "50% 50%",
                  animation:       "tech-pulse 2s ease-out infinite"
                }} />
                {/* Solid core */}
                <div style={{
                  position:     "absolute",
                  width:        14,
                  height:       14,
                  borderRadius: "50%",
                  background:   "#1a73e8",
                  border:       "2.5px solid white",
                  boxShadow:    "0 2px 6px rgba(0,0,0,0.35)",
                  top:  -7,
                  left: -7
                }} />
              </div>
            </OverlayView>
          )}
        </GoogleMap>

        {/* ── Site popup ────────────────────────────────────────────────── */}
        {selectedSite && (
          <TechSitePopup
            site={selectedSite}
            distanceMeters={selectedSite._distance}
            onClose={() => {
              setSelectedSite(null)
              handleCancelDragMode()
            }}
            isDragMode={dragPinMode}
            dragPinPos={dragPinPos}
            onStartDragMode={handleStartDragMode}
            onCancelDragMode={handleCancelDragMode}
            onConfirmDragLocation={handleConfirmDragLocation}
            isMobile={isMobile}
          />
        )}
      </div>
    </div>
  )
}
