import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate } from "react-router-dom"
import { AuthProvider, useAuth } from "./lib/AuthContext"
import LoginPage        from "./pages/Login/LoginPage"
import MapPage          from "./pages/Map"
import AdminPage        from "./pages/Admin/AdminPage"
import TechnicianPage   from "./pages/Technician"
import DeputationPage   from "./pages/Deputation"
import ComplaintsPage   from "./pages/Complaints/ComplaintsPage"
import AttendancePage   from "./pages/Attendance/AttendancePage"
import PmPlanPage       from "./pages/PmPlan/PmPlanPage"
import DashboardPage    from "./pages/Dashboard/DashboardPage"

// Wraps a route — redirects to /login if not authenticated,
// redirects to role's default page if role not allowed.
function ProtectedRoute({ children, allowed }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return <Navigate to="/login" replace />

  if (allowed && !allowed.includes(user.role)) {
    if (user.role === "boss")       return <Navigate to="/dashboard" replace />
    if (user.role === "technician") return <Navigate to="/technician" replace />
    return <Navigate to="/" replace />
  }

  const handleLogout = () => { logout(); navigate("/login", { replace: true }) }

  return (
    <>
      {children}
      {/* Small logout pill — fixed position, shows on all pages including technician map */}
      <button
        onClick={handleLogout}
        style={{
          position: "fixed", bottom: 14, right: 14, zIndex: 9999,
          padding: "6px 14px", background: "rgba(255,255,255,0.92)",
          border: "1px solid #e2e8f0", borderRadius: 20, cursor: "pointer",
          fontSize: 12, color: "#475569", fontWeight: 600,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          backdropFilter: "blur(4px)"
        }}
      >
        👤 {user.name} · Sign out
      </button>
    </>
  )
}

const NAV_ITEMS = [
  { to: "/dashboard",   emoji: "📊",  label: "Dashboard",   desc: "Today's deputation + monthly plan vs done report" },
  { to: "/map",         emoji: "🗺️",  label: "Map",         desc: "Live site map with filters and location tools" },
  { to: "/admin",       emoji: "⚙️",  label: "Admin",       desc: "Site editor, PM uploads, location approvals" },
  { to: "/complaints",  emoji: "⚠️",  label: "Complaints",  desc: "Complaint & CM/PM register with status tracking" },
  { to: "/deputation",  emoji: "📅",  label: "Deputation",  desc: "Create and approve daily work assignments" },
  { to: "/pm-plan",     emoji: "📋",  label: "PM Plan",     desc: "PM schedule register — add, view and track planned PMs" },
  { to: "/attendance",  emoji: "🗓️",  label: "Attendance",  desc: "Monthly attendance register for all technicians" },
  { to: "/technician",  emoji: "👷",  label: "Technician",  desc: "Field view — nearby sites and GPS update" },
]

function HomePage() {
  const { user } = useAuth()
  // Boss and technician have dedicated pages — redirect them away from home
  if (user?.role === "boss")       return <Navigate to="/dashboard" replace />
  if (user?.role === "technician") return <Navigate to="/technician" replace />

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "60px 16px 40px" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1e293b" }}>Genset Admin</h1>
        <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14 }}>Select a section to get started</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, width: "100%", maxWidth: 600 }}>
        {NAV_ITEMS.map(item => (
          <Link key={item.to} to={item.to} style={{ textDecoration: "none" }}>
            <div style={{
              background: "white", border: "1px solid #e2e8f0", borderRadius: 12,
              padding: "24px 20px", cursor: "pointer",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              transition: "box-shadow 0.15s, transform 0.15s", textAlign: "center",
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.12)"; e.currentTarget.style.transform = "translateY(-2px)" }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; e.currentTarget.style.transform = "none" }}
            >
              <div style={{ fontSize: 32, marginBottom: 10 }}>{item.emoji}</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b", marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>{item.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function App() {
 return (
   <AuthProvider>
     <BrowserRouter>
       <Routes>
         <Route path="/login" element={<LoginPage />} />
         <Route path="/" element={
           <ProtectedRoute><HomePage /></ProtectedRoute>
         } />
         <Route path="/dashboard" element={
           <ProtectedRoute allowed={["admin","boss"]}><DashboardPage /></ProtectedRoute>
         } />
         <Route path="/map" element={
           <ProtectedRoute allowed={["admin"]}><MapPage /></ProtectedRoute>
         } />
         <Route path="/admin" element={
           <ProtectedRoute allowed={["admin"]}><AdminPage /></ProtectedRoute>
         } />
         <Route path="/technician" element={
           <ProtectedRoute allowed={["admin","technician"]}><TechnicianPage /></ProtectedRoute>
         } />
         <Route path="/deputation" element={
           <ProtectedRoute allowed={["admin"]}><DeputationPage /></ProtectedRoute>
         } />
         <Route path="/complaints" element={
           <ProtectedRoute allowed={["admin"]}><ComplaintsPage /></ProtectedRoute>
         } />
         <Route path="/attendance" element={
           <ProtectedRoute allowed={["admin"]}><AttendancePage /></ProtectedRoute>
         } />
         <Route path="/pm-plan" element={
           <ProtectedRoute allowed={["admin"]}><PmPlanPage /></ProtectedRoute>
         } />
         {/* Catch-all → login */}
         <Route path="*" element={<Navigate to="/login" replace />} />
       </Routes>
     </BrowserRouter>
   </AuthProvider>
 )
}

export default App
