import { createContext, useContext, useState } from "react"

// Credentials now use environment variables for passwords (set in Vercel dashboard)
const CREDS = {
  admin: { password: import.meta.env.VITE_ADMIN_PASSWORD, role: "admin", name: "Jaidev" },
  boss:  { password: import.meta.env.VITE_BOSS_PASSWORD,  role: "boss",  name: "Boss"   },
}

// Shared PIN for all technicians (from environment variable)
export const TECH_PIN = import.meta.env.VITE_TECH_PIN

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ga_user")) } catch { return null }
  })

  const login = ({ username, password, techName }) => {
    // Admin or Boss
    const cred = CREDS[username?.trim().toLowerCase()]
    if (cred && cred.password === password) {
      const u = { role: cred.role, name: cred.name }
      localStorage.setItem("ga_user", JSON.stringify(u))
      setUser(u)
      return null
    }
    // Technician: name selected + shared PIN
    if (techName && password === TECH_PIN) {
      const u = { role: "technician", name: techName }
      localStorage.setItem("ga_user", JSON.stringify(u))
      setUser(u)
      return null
    }
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
