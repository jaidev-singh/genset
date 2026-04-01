import { useState, useEffect } from "react"
import { useNavigate, Navigate } from "react-router-dom"
import { useAuth, TECH_PIN } from "../../lib/AuthContext"
import { supabase } from "../../lib/supabase"

const ROLES = [
  { key: "admin",      emoji: "⚙️",  label: "Admin",       desc: "Full access — all features" },
  { key: "boss",       emoji: "📊",  label: "Boss",         desc: "Dashboard & reports only" },
  { key: "technician", emoji: "👷",  label: "Technician",   desc: "Field view & GPS update" },
]

export default function LoginPage() {
  const { login, user } = useAuth()
  const navigate = useNavigate()

  const [role, setRole]         = useState(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [techName, setTechName] = useState("")
  const [techs, setTechs]       = useState([])
  const [error, setError]       = useState("")
  const [loading, setLoading]   = useState(false)

  // Already logged in → send to their default page
  if (user) {
    if (user.role === "boss")       return <Navigate to="/dashboard" replace />
    if (user.role === "technician") return <Navigate to="/technician" replace />
    return <Navigate to="/" replace />
  }

  // Load technician names for the dropdown
  useEffect(() => {
    supabase.from("technicians").select("name").eq("is_active", true).order("name")
      .then(({ data }) => { if (data) setTechs(data.map(t => t.name)) })
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    const err = login({
      username: role !== "technician" ? username : null,
      password,
      techName: role === "technician" ? techName : null,
    })
    setLoading(false)
    if (err) { setError(err); return }
    if (role === "boss")       navigate("/dashboard", { replace: true })
    else if (role === "technician") navigate("/technician", { replace: true })
    else navigate("/", { replace: true })
  }

  return (
    <div style={{
      minHeight: "100vh", background: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    }}>
      <div style={{
        background: "white", borderRadius: 18, padding: "40px 36px",
        width: "min(92vw, 380px)", boxShadow: "0 8px 40px rgba(0,0,0,0.3)"
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 44, marginBottom: 6 }}>⚡</div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#1e293b" }}>Genset Admin</h2>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Sign in to continue</p>
        </div>

        {/* Step 1 — role selection */}
        {!role ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>
              Select your role
            </p>
            {ROLES.map(r => (
              <button
                key={r.key}
                onClick={() => setRole(r.key)}
                style={{
                  padding: "14px 18px", borderRadius: 10,
                  border: "1px solid #e2e8f0", background: "white",
                  cursor: "pointer", textAlign: "left",
                  transition: "all 0.15s"
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "#94a3b8" }}
                onMouseLeave={e => { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "#e2e8f0" }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>
                  {r.emoji} {r.label}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{r.desc}</div>
              </button>
            ))}
          </div>
        ) : (
          /* Step 2 — credentials */
          <form onSubmit={handleSubmit}>
            <button
              type="button"
              onClick={() => { setRole(null); setError(""); setPassword(""); setUsername("") }}
              style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}
            >
              ← Back
            </button>

            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20, color: "#1e293b" }}>
              {ROLES.find(r => r.key === role)?.emoji}{" "}
              {ROLES.find(r => r.key === role)?.label}
            </div>

            {/* Technician: name dropdown */}
            {role === "technician" ? (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Your Name</label>
                <select
                  value={techName} onChange={e => setTechName(e.target.value)} required
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14 }}
                >
                  <option value="">Select your name…</option>
                  {techs.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            ) : (
              /* Admin / Boss: username */
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Username</label>
                <input
                  value={username} onChange={e => setUsername(e.target.value)}
                  required autoFocus
                  placeholder={role === "boss" ? "boss" : "admin"}
                  autoCapitalize="none" autoCorrect="off"
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                />
              </div>
            )}

            {/* Password / PIN */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "#374151" }}>
                {role === "technician" ? "PIN" : "Password"}
              </label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                required placeholder="••••••••"
                style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
              />
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "9px 12px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: "100%", padding: "12px", background: loading ? "#93c5fd" : "#1a73e8",
                color: "white", border: "none", borderRadius: 8,
                fontWeight: 700, fontSize: 15, cursor: loading ? "default" : "pointer"
              }}
            >
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
