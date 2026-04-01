// AttendancePage.jsx
// Monthly attendance register — rows = technicians, columns = days of month.
// Each cell: click to cycle → blank → Present (P) → Leave (L) → Holiday (H) → blank
// Holidays apply to ALL technicians for that day.
// Data stored in `attendance` table: (tech_id, date, status)
import { OWNER_NAME } from "../../constants/appConstants"

import { useState, useMemo } from "react"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase"

const STATUSES = [null, "P", "L", "H"]   // cycle order
const STATUS_STYLE = {
  P: { background: "#dcfce7", color: "#15803d", fontWeight: 700 },
  L: { background: "#fee2e2", color: "#dc2626", fontWeight: 700 },
  H: { background: "#fef9c3", color: "#92400e", fontWeight: 700 },
}

const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"]

function todayParts() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() }
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function dayOfWeek(year, month, day) {
  return new Date(year, month, day).getDay() // 0=Sun, 6=Sat
}

export default function AttendancePage() {
  const qc = useQueryClient()
  const { year: todayY, month: todayM } = todayParts()
  const [year, setYear]   = useState(todayY)
  const [month, setMonth] = useState(todayM)

  const numDays = daysInMonth(year, month)

  // ── fetch technicians ──────────────────────────────────────────────────────
  const { data: techs = [] } = useQuery({
    queryKey: ["technicians-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("technicians")
        .select("id, name, phone, office_id")
        .eq("is_active", true)
        .order("name")
      if (error) throw error
      return data
    },
    staleTime: 300000,
  })

  // ── fetch attendance records for this month ────────────────────────────────
  const monthStart = toDateStr(year, month, 1)
  const monthEnd   = toDateStr(year, month, numDays)

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["attendance", year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, technician_id, date, status")
        .gte("date", monthStart)
        .lte("date", monthEnd)
      if (error) throw error
      return data
    },
    staleTime: 0,
  })

  // Build lookup: { "techId_YYYY-MM-DD": { id, status } }
  const lookup = useMemo(() => {
    const map = {}
    records.forEach(r => { map[`${r.technician_id}_${r.date}`] = r })
    return map
  }, [records])

  // ── holiday lookup: if ANY technician has H on a date, it's a holiday ─────
  const holidayDates = useMemo(() => {
    const set = new Set()
    records.forEach(r => { if (r.status === "H") set.add(r.date) })
    return set
  }, [records])

  // ── upsert / delete a single cell ─────────────────────────────────────────
  const { mutate: setCell } = useMutation({
    mutationFn: async ({ techId, date, nextStatus }) => {
      const existing = lookup[`${techId}_${date}`]
      if (!nextStatus) {
        // delete
        if (existing) {
          const { error } = await supabase.from("attendance").delete().eq("id", existing.id)
          if (error) throw error
        }
      } else if (existing) {
        const { error } = await supabase.from("attendance").update({ status: nextStatus }).eq("id", existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from("attendance").insert({ technician_id: techId, date, status: nextStatus })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance", year, month] }),
  })

  // ── mark holiday for ALL technicians on a day ─────────────────────────────
  const { mutate: toggleHoliday, isPending: togglingHoliday } = useMutation({
    mutationFn: async (day) => {
      const date = toDateStr(year, month, day)
      const isHoliday = holidayDates.has(date)
      if (isHoliday) {
        // remove holiday for all
        const { error } = await supabase.from("attendance").delete()
          .eq("date", date).eq("status", "H")
        if (error) throw error
      } else {
        // upsert all techs as H
        const rows = techs.map(t => ({ technician_id: t.id, date, status: "H" }))
        const { error } = await supabase.from("attendance")
          .upsert(rows, { onConflict: "technician_id,date" })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance", year, month] }),
  })

  // ── click cell: cycle status ──────────────────────────────────────────────
  const handleCell = (techId, day) => {
    if (dayOfWeek(year, month, day) === 0) return   // Sundays are auto-holidays
    const date = toDateStr(year, month, day)
    const existing = lookup[`${techId}_${date}`]
    const current = existing?.status ?? null
    const idx = STATUSES.indexOf(current)
    // Skip 'H' in single-cell cycle — holidays are set via column header
    const nextIdx = (idx + 1) % STATUSES.length
    const next = STATUSES[nextIdx] === "H"
      ? STATUSES[(nextIdx + 1) % STATUSES.length]
      : STATUSES[nextIdx]
    setCell({ techId, date, nextStatus: next })
  }

  // ── month summary per tech ─────────────────────────────────────────────────
  const summary = useMemo(() => {
    const map = {}
    techs.forEach(t => { map[t.id] = { P: 0, L: 0, H: 0 } })
    records.forEach(r => {
      if (map[r.technician_id]) map[r.technician_id][r.status] = (map[r.technician_id][r.status] ?? 0) + 1
    })
    return map
  }, [records, techs])

  // Cumulative running total of P per day (excludes owner)
  const cumulativeTotal = useMemo(() => {
    const techsExcl = techs.filter(t => t.name.toLowerCase() !== OWNER_NAME.toLowerCase())
    const result = {}
    let running = 0
    for (let d = 1; d <= numDays; d++) {
      const date = toDateStr(year, month, d)
      const count = techsExcl.filter(t => lookup[`${t.id}_${date}`]?.status === "P").length
      running += count
      result[d] = running
    }
    return result
  }, [techs, lookup, year, month, numDays])

  // Count Sundays in this month — auto-added to every tech's H total
  const sundayCount = useMemo(() => {
    let count = 0
    for (let d = 1; d <= numDays; d++) {
      if (dayOfWeek(year, month, d) === 0) count++
    }
    return count
  }, [year, month, numDays])

  // ── nav ────────────────────────────────────────────────────────────────────
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const days = Array.from({ length: numDays }, (_, i) => i + 1)
  const isToday = (day) => year === todayY && month === todayM && day === new Date().getDate()
  const isWeekend = (day) => { const d = dayOfWeek(year, month, day); return d === 0 || d === 6 }

  const DAY_ABBR = ["Su","Mo","Tu","We","Th","Fr","Sa"]

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>

      {/* Header */}
      <div style={{
        background: "white", borderBottom: "1px solid #e2e8f0",
        padding: "0 20px", position: "sticky", top: 0, zIndex: 100
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, height: 56, flexWrap: "wrap" }}>
          <Link to="/" style={{ fontSize: 18, textDecoration: "none", color: "#374151", lineHeight: 1 }}>←</Link>
          <span style={{ fontWeight: 700, fontSize: 17 }}>📋 Attendance Register</span>

          {/* Month nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 16 }}>
            <button onClick={prevMonth} style={navBtn}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 15, minWidth: 130, textAlign: "center" }}>
              {MONTH_NAMES[month]} {year}
            </span>
            <button onClick={nextMonth} style={navBtn}>›</button>
            <button
              onClick={() => { setYear(todayY); setMonth(todayM) }}
              style={{ ...navBtn, padding: "4px 12px", fontSize: 12, marginLeft: 4 }}
            >Today</button>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 10, marginLeft: "auto", fontSize: 12 }}>
            <Badge s="P" /> <span style={{ color: "#6b7280" }}>Present</span>
            <Badge s="L" /> <span style={{ color: "#6b7280" }}>Leave</span>
            <Badge s="H" /> <span style={{ color: "#6b7280" }}>Holiday</span>
          </div>
        </div>
      </div>

      {isLoading && <div style={{ padding: 24, color: "#6b7280" }}>Loading…</div>}

      {/* Scrollable table */}
      <div style={{ overflowX: "auto", padding: "16px 12px" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 800 }}>
          <thead>
            {/* Day-of-week row */}
            <tr>
              <th style={thName}></th>
              {days.map(d => {
                const isSun = dayOfWeek(year, month, d) === 0
                return (
                  <th key={d} style={{
                    ...thDay,
                    color: isSun ? "#92400e" : isWeekend(d) ? "#94a3b8" : "#6b7280",
                    fontWeight: isSun ? 800 : 400,
                    fontSize: 11,
                    background: isSun ? "#fef9c3" : "transparent",
                    borderRadius: "4px 4px 0 0",
                  }}>
                    {DAY_ABBR[dayOfWeek(year, month, d)]}
                  </th>
                )
              })}
              <th style={{ ...thDay, minWidth: 32, color: "#15803d", fontSize: 11, fontWeight: 700 }}>P</th>
              <th style={{ ...thDay, minWidth: 32, color: "#dc2626", fontSize: 11, fontWeight: 700 }}>L</th>
              <th style={{ ...thDay, minWidth: 32, color: "#92400e", fontSize: 11, fontWeight: 700 }}>H</th>
            </tr>
            {/* Day number row — click to mark holiday */}
            <tr>
              <th style={{ ...thName, fontSize: 11, color: "#94a3b8", fontWeight: 400, paddingBottom: 8 }}>
                Click 🗓 for holiday →
              </th>
              {days.map(d => {
                const date = toDateStr(year, month, d)
                const isHol = holidayDates.has(date)
                return (
                  <th key={d} style={{ ...thDay, paddingBottom: 4 }}>
                    {(() => {
                        const isSun = dayOfWeek(year, month, d) === 0
                        return (
                          <div
                            onClick={() => !isSun && !togglingHoliday && toggleHoliday(d)}
                            title={isSun ? "Sunday — auto holiday" : isHol ? "Remove holiday" : "Mark as public holiday"}
                            style={{
                              width: 28, height: 28, borderRadius: 6,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: isSun ? "default" : "pointer",
                              background: isSun || isHol ? "#fef9c3" : isToday(d) ? "#eff6ff" : "transparent",
                              border: isSun || isHol ? "1px solid #fde68a" : isToday(d) ? "1px solid #bfdbfe" : "1px solid transparent",
                              fontWeight: isToday(d) ? 800 : 600,
                              color: isSun || isHol ? "#92400e" : isToday(d) ? "#1d4ed8" : isWeekend(d) ? "#94a3b8" : "#374151",
                              fontSize: 13,
                              transition: "background 0.1s",
                            }}
                          >
                            {d}
                          </div>
                        )
                      })()}
                  </th>
                )
              })}
              <th style={thDay}></th>
              <th style={thDay}></th>
              <th style={thDay}></th>
            </tr>
          </thead>

          <tbody>
            {techs.map((tech, ti) => (
              <tr key={tech.id} style={{ background: ti % 2 === 0 ? "white" : "#f8fafc" }}>
                <td style={{ ...thName, fontWeight: 600, color: "#374151", fontSize: 13, paddingRight: 16 }}>
                  {tech.name}
                </td>
                {days.map(d => {
                  const date    = toDateStr(year, month, d)
                  const rec     = lookup[`${tech.id}_${date}`]
                  const isSun   = dayOfWeek(year, month, d) === 0
                  const s       = isSun ? "H" : (rec?.status ?? null)
                  const ss      = s ? STATUS_STYLE[s] : {}
                  return (
                    <td key={d} style={{ padding: 2, textAlign: "center" }}>
                      <div
                        onClick={() => handleCell(tech.id, d)}
                        title={isSun ? "Sunday — auto holiday" : "Click to cycle: blank → P → L → blank"}
                        style={{
                          width: 28, height: 28, borderRadius: 6,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: isSun ? "default" : "pointer",
                          fontSize: 12,
                          transition: "background 0.1s",
                          ...ss,
                          border: s ? "none" : "1px solid #f1f5f9",
                        }}
                      >
                        {s ?? ""}
                      </div>
                    </td>
                  )
                })}
                {/* Monthly summary */}
                <td style={{ textAlign: "center", fontWeight: 700, color: "#15803d", paddingLeft: 8 }}>
                  {summary[tech.id]?.P ?? 0}
                </td>
                <td style={{ textAlign: "center", fontWeight: 700, color: "#dc2626" }}>
                  {summary[tech.id]?.L ?? 0}
                </td>
                <td style={{ textAlign: "center", fontWeight: 700, color: "#92400e" }}>
                  {(summary[tech.id]?.H ?? 0) + sundayCount}
                </td>
              </tr>
            ))}
            {/* Cumulative total row */}
            <tr style={{ borderTop: "2px solid #cbd5e1", background: "#eff6ff" }}>
              <td style={{ ...thName, background: "#eff6ff", fontWeight: 700, fontSize: 12, color: "#1d4ed8" }}>
                📊 Cumulative Total
                <div style={{ fontSize: 10, fontWeight: 400, color: "#64748b" }}>excl. {OWNER_NAME}</div>
              </td>
              {days.map(d => (
                <td key={d} style={{ padding: 2, textAlign: "center" }}>
                  {cumulativeTotal[d] > 0 ? (
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "#dbeafe", color: "#1d4ed8", fontWeight: 700, fontSize: 11
                    }}>
                      {cumulativeTotal[d]}
                    </div>
                  ) : <div style={{ width: 28, height: 28 }} />}
                </td>
              ))}
              <td style={{ textAlign: "center", fontWeight: 800, color: "#1d4ed8", paddingLeft: 8, fontSize: 14 }}>
                {cumulativeTotal[numDays] ?? 0}
              </td>
              <td /><td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Badge({ s }) {
  return (
    <span style={{
      display: "inline-block", width: 20, height: 20, borderRadius: 4,
      textAlign: "center", lineHeight: "20px", fontSize: 11,
      ...STATUS_STYLE[s]
    }}>{s}</span>
  )
}

const navBtn = {
  padding: "4px 10px", background: "#f1f5f9", border: "1px solid #e2e8f0",
  borderRadius: 6, cursor: "pointer", fontSize: 15, lineHeight: 1
}
const thName = {
  textAlign: "left", padding: "6px 8px 6px 4px",
  position: "sticky", left: 0, background: "white",
  zIndex: 2, minWidth: 130, borderRight: "2px solid #e2e8f0",
  whiteSpace: "nowrap"
}
const thDay = {
  padding: "2px 1px", textAlign: "center", minWidth: 32
}
