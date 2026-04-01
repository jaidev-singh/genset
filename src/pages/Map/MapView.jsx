// MapView.jsx
// Main map page. Handles data fetching, all filter state, auto-zoom logic,
// and renders the Google Map with markers. Sub-components handle the filter
// panel UI (MapFilterPanel) and the site detail popup (SitePopup).

import { useQuery } from "@tanstack/react-query"
import { GoogleMap, useJsApiLoader, Marker } from "@react-google-maps/api"
import { useState, useMemo, useRef, useEffect } from "react"
import { Link } from "react-router-dom"
import { fetchSites } from "../../services/sites"
import MapFilterPanel from "./MapFilterPanel"
import SitePopup from "./SitePopup"
import PmPlanPopup from "./PmPlanPopup"
import { supabase } from "../../lib/supabase"

const TEAL_PIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='32' viewBox='0 0 24 32'><path d='M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20s12-11 12-20C24 5.37 18.63 0 12 0z' fill='%230d9488' stroke='%230f766e' stroke-width='1.5'/><circle cx='12' cy='12' r='5' fill='white'/></svg>`
const TEAL_PIN_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(TEAL_PIN_SVG)}`

// Default map view centered on the Bareilly region
const DEFAULT_CENTER = { lat: 28.36, lng: 79.43 }
const DEFAULT_ZOOM = 8

// Strips a string to lowercase alphanumeric for fuzzy matching
const normalize = (str) =>
  (str || "").toLowerCase().replace(/[^a-z0-9]/g, "")

// Returns the marker color based on site status, pending location, and last service date
function getMarkerColor(site) {
  // Pink = has a pending new location waiting for admin approval
  if (site.new_latitude != null) return "pink"

  const last = site.last_service_date ? new Date(site.last_service_date) : null
  const isPmDue = last
    ? (new Date() - last) / (1000 * 60 * 60 * 24) > 180
    : false

  if (site.genset_status === "Inactive") return "red"
  if (isPmDue) return "orange"
  return "purple"
}

export default function MapView() {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY
  })

  const mapRef = useRef(null)

  // Currently selected site — drives the popup and highlighted marker
  const [selectedSite, setSelectedSite] = useState(null)

  // PM Plan layer state
  const [showPmPlan, setShowPmPlan] = useState(false)
  const [selectedPmPlan, setSelectedPmPlan] = useState(null)

  // Filter state
  const [searchText, setSearchText] = useState("")
  const [selectedOffice, setSelectedOffice] = useState("all")
  const [selectedCustomer, setSelectedCustomer] = useState("all")
  const [pmDueOnly, setPmDueOnly] = useState(false)
  const [pendingOnly, setPendingOnly] = useState(false)

  // Fetch all sites that have coordinates.
  // staleTime: 0 overrides the global 5-min default so new fields
  // (new_latitude, location_verified) are always fetched fresh.
  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
    staleTime: 0
  })

  // Fetch pm_plan records when the layer is toggled on
  const { data: pmPlans = [] } = useQuery({
    queryKey: ["pm-plans-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pm_plan")
        .select(`id, pm_request_number, planned_date, service_type, status, plan_type, amc_type, fold_status,
          assigned_to, technicians(id, name),
          sites(id, site_id, name, latitude, longitude, contact_person, contact_phone, kva, engine_model, genset_status)`)
        .in("status", ["Pending", "Assigned"])
      if (error) throw error
      return data.filter(p => p.sites?.latitude != null && p.sites?.longitude != null)
    },
    enabled: showPmPlan,
    staleTime: 60000
  })

  const pendingCount = useMemo(
    () => sites.filter(s => s.new_latitude != null).length,
    [sites]
  )

  // Apply all active filters to the full site list
  const filteredSites = useMemo(() => {
    const tokens = searchText.trim().split(/\s+/).map(normalize).filter(Boolean)

    return sites.filter(site => {
      // Pending = new coords submitted by field worker, waiting for admin approval
      const isPending = site.new_latitude != null && site.new_longitude != null

      if (pendingOnly) {
        // "Pending Verify" checkbox: only show sites awaiting location approval
        if (!isPending) return false
      } else {
        // Default view: show every site that has at least one usable coordinate pair
        const hasOfficialCoords = site.latitude != null && site.longitude != null
        if (!hasOfficialCoords && !isPending) return false
      }

      if (selectedOffice !== "all" && site.office_id !== Number(selectedOffice)) return false

      if (selectedCustomer !== "all" && !(site.customers?.name || "").toLowerCase().includes(selectedCustomer)) return false

      if (tokens.length > 0 && !tokens.every(t =>
        normalize(site.site_id).includes(t) ||
        normalize(site.engine_serial_no).includes(t) ||
        normalize(site.name).includes(t) ||
        normalize(site.customers?.name).includes(t)
      )) return false

      if (pmDueOnly) {
        const last = site.last_service_date ? new Date(site.last_service_date) : null
        const isPmDue = last ? (Date.now() - last) / 86400000 > 180 : false
        if (!isPmDue) return false
      }

      return true
    })
  }, [sites, selectedOffice, pmDueOnly, searchText, selectedCustomer, pendingOnly])

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return

    if (searchText && filteredSites.length > 0) {
      if (filteredSites.length === 1) {
        const site = filteredSites[0]
        const isPending = site.new_latitude != null && site.new_longitude != null
        const lat = parseFloat(pendingOnly && isPending ? site.new_latitude : (site.latitude ?? site.new_latitude))
        const lng = parseFloat(pendingOnly && isPending ? site.new_longitude : (site.longitude ?? site.new_longitude))
        mapRef.current.setCenter({ lat, lng })
        mapRef.current.setZoom(14)
      } else {
        const bounds = new window.google.maps.LatLngBounds()
        filteredSites.forEach(site => {
          const isPending = site.new_latitude != null && site.new_longitude != null
          const lat = parseFloat(pendingOnly && isPending ? site.new_latitude : (site.latitude ?? site.new_latitude))
          const lng = parseFloat(pendingOnly && isPending ? site.new_longitude : (site.longitude ?? site.new_longitude))
          bounds.extend({ lat, lng })
        })
        mapRef.current.fitBounds(bounds, 60)
      }
    } else if (!searchText) {
      mapRef.current.setCenter(DEFAULT_CENTER)
      mapRef.current.setZoom(DEFAULT_ZOOM)
    }
  }, [filteredSites, searchText, pendingOnly, isLoaded])

  if (!isLoaded || isLoading) return <div style={{ padding: 20 }}>Loading map...</div>

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {/* tiny indicator so we can confirm DB data is arriving — remove once stable */}
      <div style={{ position: "absolute", bottom: 8, left: 8, zIndex: 999, display: "flex", gap: 6, alignItems: "center" }}>
        <Link to="/" style={{ background: "white", border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 10px", fontSize: 13, textDecoration: "none", color: "#374151", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>⌂ Home</Link>
        <div style={{ background: "rgba(255,255,255,0.85)", padding: "2px 8px", borderRadius: 4, fontSize: 11, color: "#6b7280" }}>
          {sites.length} sites | {filteredSites.length} shown
        </div>
      </div>

      {/* Filter panel — search, office, customer, PM toggle, counts, legend */}
      <MapFilterPanel
          searchText={searchText} setSearchText={setSearchText}
          selectedOffice={selectedOffice} setSelectedOffice={setSelectedOffice}
          pmDueOnly={pmDueOnly} setPmDueOnly={setPmDueOnly}
          pendingOnly={pendingOnly} setPendingOnly={setPendingOnly}
          selectedCustomer={selectedCustomer} setSelectedCustomer={setSelectedCustomer}
          filteredSites={filteredSites}
          pendingCount={pendingCount}
          showPmPlan={showPmPlan} setShowPmPlan={setShowPmPlan}
          pmPlansCount={pmPlans.length}
        />

        {/* Google Map — initial position set once in onLoad, never as controlled props */}
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: "100%" }}
          onLoad={(map) => {
            mapRef.current = map
            map.setCenter(DEFAULT_CENTER)
            map.setZoom(DEFAULT_ZOOM)
          }}
        >
          {filteredSites.map(site => {
            const isPending = site.new_latitude != null && site.new_longitude != null
            // pendingOnly view → plot the proposed new location
            // normal view → plot official coords; if none yet (brand-new site), fall back to pending coords
            const lat = parseFloat(pendingOnly && isPending ? site.new_latitude : (site.latitude ?? site.new_latitude))
            const lng = parseFloat(pendingOnly && isPending ? site.new_longitude : (site.longitude ?? site.new_longitude))
            return (
              <Marker
                key={site.id}
                position={{ lat, lng }}
                icon={{
                  // Selected: keep site's own color but switch to pushpin icon so pending stays pink
                  url: selectedSite?.id === site.id
                    ? `http://maps.google.com/mapfiles/ms/icons/${getMarkerColor(site)}-pushpin.png`
                    : `http://maps.google.com/mapfiles/ms/icons/${getMarkerColor(site)}-dot.png`
                }}
                onClick={() => {
                  setSelectedSite(site)
                  if (mapRef.current) {
                    mapRef.current.setCenter({ lat, lng })
                    mapRef.current.setZoom(15)
                  }
                }}
              />
            )
          })}
          {/* PM Plan teal markers — shown when PM Plan layer is active */}
          {showPmPlan && pmPlans.map(plan => (
            <Marker
              key={`pm-${plan.id}`}
              position={{ lat: parseFloat(plan.sites.latitude), lng: parseFloat(plan.sites.longitude) }}
              icon={{ url: TEAL_PIN_URL, scaledSize: new window.google.maps.Size(24, 32), anchor: new window.google.maps.Point(12, 32) }}
              zIndex={800}
              onClick={() => { setSelectedPmPlan(plan); setSelectedSite(null) }}
            />
          ))}
        </GoogleMap>

      {selectedSite && (
          <SitePopup
            site={selectedSite}
            onClose={() => setSelectedSite(null)}
          />
        )}

      {selectedPmPlan && (
        <PmPlanPopup
          plan={selectedPmPlan}
          onClose={() => setSelectedPmPlan(null)}
        />
      )}

    </div>
  )
}
