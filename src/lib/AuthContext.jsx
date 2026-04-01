import { createContext, useContext, useState } from "react"

// Hardcoded credentials — change passwords here if needed
const CREDS = {
  admin: { password: "jaidev@2024", role: "admin", name: "Jaidev" },
  boss:  { password: "boss@2024",   role: "boss",  name: "Boss"   },
}

// Shared PIN for all technicians
export const TECH_PIN = "1234"

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
