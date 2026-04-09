import { createContext, useContext, useState } from "react"
import { supabase } from "./supabase"

// Credentials for admin/boss via environment variables (set in Vercel dashboard)
const CREDS = {
  admin: { password: import.meta.env.VITE_ADMIN_PASSWORD, role: "admin", name: "Jaidev" },
  boss:  { password: import.meta.env.VITE_BOSS_PASSWORD,  role: "boss",  name: "Boss"   },
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("ga_user"))
      // Invalidate old technician sessions that pre-date per-tech login (had no technicianId)
      if (u?.role === "technician" && !u.technicianId) return null
      return u
    } catch { return null }
  })

  // Returns null on success, or an error string on failure
  const login = async ({ username, password }) => {
    const key = username?.trim().toLowerCase()

    // 1. Admin or Boss — checked against env-var credentials
    const cred = CREDS[key]
    if (cred && cred.password === password) {
      const u = { role: cred.role, name: cred.name }
      localStorage.setItem("ga_user", JSON.stringify(u))
      setUser(u)
      return null
    }

    // 2. Technician — looked up in the technicians table by username + password
    try {
      const { data: tech, error } = await supabase
        .from("technicians")
        .select("id, name")
        .eq("username", username?.trim() ?? "")
        .eq("password", password)
        .eq("is_active", true)
        .maybeSingle()

      if (!error && tech) {
        const u = { role: "technician", name: tech.name, technicianId: tech.id }
        localStorage.setItem("ga_user", JSON.stringify(u))
        setUser(u)
        return null
      }
    } catch { /* fall through to error */ }

    return "Invalid credentials. Please try again."
  }

  const logout = () => {
    localStorage.removeItem("ga_user")
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
