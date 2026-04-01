// MapFilterPanel.jsx
// Overlay panel (top-left) with search, filters, live counts, and legend.
// All state lives in the parent (MapView) and is passed down as props.

export default function MapFilterPanel({
  searchText, setSearchText,
  selectedOffice, setSelectedOffice,
  pmDueOnly, setPmDueOnly,
  pendingOnly, setPendingOnly,
  selectedCustomer, setSelectedCustomer,
  filteredSites,
  pendingCount,
  showPmPlan, setShowPmPlan,
  pmPlansCount
}) {
  // Count how many filtered sites have PM overdue (> 180 days since last service)
  const pmDueCount = filteredSites.filter(site => {
    const last = site.last_service_date ? new Date(site.last_service_date) : null
    return last && (new Date() - last) / (1000 * 60 * 60 * 24) > 180
  }).length

  return (
    <div style={{
      position: "absolute",
      top: "10px",
      left: "10px",
      zIndex: 1000,
      background: "white",
      padding: "10px",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      width: "250px"
    }}>
      {/* Search by site ID, engine serial, site name, or customer name */}
      <input
        type="text"
        placeholder="Search Site ID / Engine No"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{
          width: "100%",
          marginBottom: "8px",
          padding: "6px",
          borderRadius: "5px",
          border: "1px solid #ccc"
        }}
      />

      {/* Office filter */}
      <select value={selectedOffice} onChange={(e) => setSelectedOffice(e.target.value)}>
        <option value="all">All Offices</option>
        <option value="1">Bareilly</option>
        <option value="2">Pilibhit</option>
        <option value="3">Badaun</option>
      </select>

      {/* Show only PM-overdue sites */}
      <label style={{ marginLeft: "10px" }}>
        <input
          type="checkbox"
          checked={pmDueOnly}
          onChange={() => setPmDueOnly(!pmDueOnly)}
        />
        {" "}PM Due Only
      </label>

      {/* Show only sites with a pending GPS location waiting for verification */}
      <label style={{ marginLeft: "10px", display: "block", marginTop: "4px" }}>
        <input
          type="checkbox"
          checked={pendingOnly}
          onChange={() => setPendingOnly(!pendingOnly)}
        />
        {" "}📍 Pending Verify
      </label>

      {/* PM Plan layer overlay */}
      <label style={{ marginLeft: "10px", display: "block", marginTop: "4px" }}>
        <input
          type="checkbox"
          checked={showPmPlan}
          onChange={() => setShowPmPlan(!showPmPlan)}
        />
        {" "}📋 PM Plans{showPmPlan && pmPlansCount > 0 ? ` (${pmPlansCount})` : ""}
      </label>

      {/* Customer filter */}
      <select
        value={selectedCustomer}
        onChange={(e) => setSelectedCustomer(e.target.value)}
        style={{ marginTop: "6px", width: "100%" }}
      >
        <option value="all">All Customers</option>
        <option value="indus">Indus</option>
        <option value="reliance">Reliance</option>
        <option value="retail">Retail</option>
      </select>

      {/* Live site counts based on active filters */}
      <div style={{ marginTop: "8px", fontSize: "12px" }}>
        <div>Total: {filteredSites.length}</div>
        <div>PM Due: {pmDueCount}</div>
        <div>Pending Verify: {pendingCount}</div>
      </div>

      {/* Marker color legend */}
      <div style={{ marginTop: "8px", fontSize: "12px" }}>
        <div>🟣 Active</div>
        <div>🟠 PM Due</div>
        <div>🔴 Inactive</div>
        <div>🩷 Pending Location</div>
        {showPmPlan && <div style={{ color: "#0d9488" }}>📍 PM Planned</div>}
      </div>
    </div>
  )
}
