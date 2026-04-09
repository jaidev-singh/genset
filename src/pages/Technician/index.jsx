import { useState } from "react"
import TechnicianView from "./TechnicianView"
import TechMyWork     from "./TechMyWork"

const TAB_STYLE = (active) => ({
  flex: 1, padding: "11px 0", border: "none", cursor: "pointer",
  fontWeight: active ? 700 : 500, fontSize: 14,
  background: active ? "#1a73e8" : "#1e293b",
  color: active ? "white" : "#94a3b8",
  borderBottom: active ? "3px solid #60a5fa" : "3px solid transparent",
  transition: "all 0.15s",
})

export default function TechnicianPage() {
  const [tab, setTab] = useState("work")

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", background: "#1e293b", flexShrink: 0 }}>
        <button style={TAB_STYLE(tab === "work")} onClick={() => setTab("work")}>
          📋 My Work
        </button>
        <button style={TAB_STYLE(tab === "map")} onClick={() => setTab("map")}>
          🗺️ Map
        </button>
      </div>

      {/* Tab content — both mounted, only one visible, so map keeps its state */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, display: tab === "work" ? "block" : "none", overflowY: "auto" }}>
          <TechMyWork />
        </div>
        <div style={{ position: "absolute", inset: 0, display: tab === "map" ? "block" : "none" }}>
          <TechnicianView />
        </div>
      </div>
    </div>
  )
}
