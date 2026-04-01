// Deputation/index.jsx — Page wrapper with two tabs: New Deputation + Schedule
import { useState } from "react"
import { Link } from "react-router-dom"
import DeputationForm from "./DeputationForm"
import DeputationList from "./DeputationList"

const TABS = [
  { key: "form", label: "📝 New Deputation" },
  { key: "list", label: "📅 Schedule" },
]

export default function DeputationPage() {
  const [tab, setTab] = useState("form")

  const handleSaved = () => setTab("list")

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* Header */}
      <div style={{
        background: "white", borderBottom: "1px solid #e2e8f0",
        padding: "0 20px", position: "sticky", top: 0, zIndex: 100
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", gap: 24, height: 56 }}>
          <Link to="/" style={{ fontSize: 18, textDecoration: "none", color: "#374151" }}>←</Link>
          <span style={{ fontWeight: 700, fontSize: 17 }}>Daily Deputation</span>
          <div style={{ display: "flex", gap: 4, marginLeft: 16 }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: "6px 16px",
                  background: tab === t.key ? "#1a73e8" : "transparent",
                  color: tab === t.key ? "white" : "#6b7280",
                  border: tab === t.key ? "none" : "1px solid transparent",
                  borderRadius: 20,
                  cursor: "pointer",
                  fontWeight: tab === t.key ? 700 : 400,
                  fontSize: 13,
                  transition: "all 0.15s",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {tab === "form" && <DeputationForm onSaved={handleSaved} />}
        {tab === "list" && <DeputationList />}
      </div>
    </div>
  )
}
