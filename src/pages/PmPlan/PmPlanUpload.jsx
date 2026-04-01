// PmPlanUpload.jsx
// Bulk-upload a PM schedule into the pm_plan table from Excel.
// Match key: sites.site_id text value OR engine_serial_no
// Duplicate pm_request_number → upsert (update planned_date, service_type etc.)
// Rows where site cannot be matched → shown as unmatched and skipped.

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as XLSX from "xlsx"
import { supabase } from "../../lib/supabase"

const norm = (s) => (s ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "")

function toIsoDate(val) {
  if (val == null || val === "") return null
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString().slice(0, 10)
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const ALIASES = {
  pm_request_number: ["pmrequestnumber", "pmno", "pm_no", "requestno", "workorder", "pmrequestno"],
  site_id:           ["siteid", "site_id", "sitecode", "site"],
  engine_serial_no:  ["engineserialNo", "engineno", "serialno", "serial"],
  planned_date:      ["planneddate", "plandate", "pmdate", "date"],
  service_type:      ["servicetype", "worktype", "type", "pmtype"],
  plan_type:         ["plantype", "plan"],
  amc_type:          ["amctype", "amc"],
  fold_status:       ["foldstatus", "fold"],
}
function resolveHeader(raw) {
  const h = (raw ?? "").toString().toLowerCase().replace(/[\s_]+/g, "")
  for (const [canon, aliases] of Object.entries(ALIASES)) {
    if (aliases.some(a => a.replace(/[\s_]+/g, "") === h)) return canon
    // also check if h exactly equals canon without underscores
    if (canon.replace(/_/g, "") === h) return canon
  }
  return null
}

const VALID_SERVICE = ["PM Service", "Top Up", "PM Visit"]
const VALID_PLAN    = ["Customer", "Internal"]
const VALID_AMC     = ["AMC", "Non-AMC"]
const VALID_FOLD    = ["In-fold", "Out-fold"]
const fuzzy = (val, list) => list.find(v => norm(v) === norm(val)) ?? null

function downloadTemplate() {
  const ws = XLSX.utils.json_to_sheet([
    { pm_request_number: "PM-2026-001", site_id: "BLY-001", engine_serial_no: "",       planned_date: "2026-04-10", service_type: "PM Service", plan_type: "Customer", amc_type: "AMC",     fold_status: "In-fold" },
    { pm_request_number: "PM-2026-002", site_id: "BLY-002", engine_serial_no: "",       planned_date: "2026-04-15", service_type: "Top Up",     plan_type: "Customer", amc_type: "AMC",     fold_status: "In-fold" },
    { pm_request_number: "PM-2026-003", site_id: "",        engine_serial_no: "ENG-045",planned_date: "2026-04-20", service_type: "PM Visit",   plan_type: "Internal", amc_type: "Non-AMC", fold_status: "" },
  ])
  ws["!cols"] = [20, 14, 20, 14, 14, 12, 12, 12].map(wch => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "PM Plan")
  XLSX.writeFile(wb, "pm_plan_upload_template.xlsx")
}

const BATCH = 10

export default function PmPlanUpload() {
  const qc = useQueryClient()
  const [stage,    setStage]    = useState("idle")   // idle | preview | uploading | done
  const [fileName, setFileName] = useState("")
  const [matched,  setMatched]  = useState([])
  const [unmatched,setUnmatched]= useState([])
  const [invalid,  setInvalid]  = useState([])
  const [progress, setProgress] = useState(0)
  const [results,  setResults]  = useState([])

  const { data: sites = [], isLoading: sitesLoading } = useQuery({
    queryKey: ["sites-for-pm-plan"],
    queryFn: async () => {
      const all = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from("sites").select("id, site_id, engine_serial_no, name")
          .order("id").range(from, from + 999)
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
        from += 1000
      }
      return all
    }
  })

  const handleFile = e => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const wb      = XLSX.read(evt.target.result, { type: "array", cellDates: true })
        const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true })
        if (!rawRows.length) { alert("Sheet is empty ❌"); return }

        const rev = {}
        for (const k of Object.keys(rawRows[0])) { const c = resolveHeader(k); if (c && !(c in rev)) rev[c] = k }
        const get = (row, key) => rev[key] != null ? (row[rev[key]] ?? "") : ""

        if (!rev.pm_request_number) { alert("Need column: pm_request_number ❌"); return }
        if (!rev.planned_date)      { alert("Need column: planned_date ❌"); return }
        if (!rev.service_type)      { alert("Need column: service_type ❌"); return }
        if (!rev.site_id && !rev.engine_serial_no) { alert("Need at least: site_id or engine_serial_no ❌"); return }

        const bySiteId = new Map(sites.map(s => [norm(s.site_id), s]))
        const bySerial = new Map(sites.filter(s => s.engine_serial_no).map(s => [norm(s.engine_serial_no), s]))

        const mat = [], unmat = [], inv = []
        for (const row of rawRows) {
          const pmNum = get(row, "pm_request_number").toString().trim()
          if (!pmNum) continue

          const siteIdTxt = get(row, "site_id").toString().trim()
          const serialTxt = get(row, "engine_serial_no").toString().trim()
          const site      = bySiteId.get(norm(siteIdTxt)) ?? bySerial.get(norm(serialTxt))
          if (!site) { unmat.push({ pmNum, siteIdTxt, serialTxt }); continue }

          const plannedDate = toIsoDate(get(row, "planned_date"))
          if (!plannedDate) { inv.push({ pmNum, reason: `Invalid planned_date: "${get(row, "planned_date")}"` }); continue }

          const serviceType = fuzzy(get(row, "service_type"), VALID_SERVICE)
          if (!serviceType) { inv.push({ pmNum, reason: `Unknown service_type: "${get(row, "service_type")}"` }); continue }

          const d = new Date(plannedDate)
          mat.push({
            site,
            row: {
              pm_request_number: pmNum,
              site_id:      site.id,
              planned_date: plannedDate,
              service_type: serviceType,
              plan_type:    fuzzy(get(row, "plan_type"), VALID_PLAN) ?? "Customer",
              amc_type:     fuzzy(get(row, "amc_type"),  VALID_AMC)  ?? null,
              fold_status:  fuzzy(get(row, "fold_status"),VALID_FOLD) ?? null,
              month:        d.getMonth() + 1,
              year:         d.getFullYear(),
            }
          })
        }
        setMatched(mat); setUnmatched(unmat); setInvalid(inv)
        setStage("preview")
      } catch (err) {
        alert("Parse failed ❌\n" + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ""
  }

  const handleUpload = async () => {
    setStage("uploading"); setProgress(0)
    const res = []
    for (let i = 0; i < matched.length; i += BATCH) {
      const batch = matched.slice(i, i + BATCH)
      const settled = await Promise.allSettled(
        batch.map(({ row }) =>
          supabase.from("pm_plan")
            .upsert(row, { onConflict: "pm_request_number" })
            .then(({ error }) => { if (error) throw error; return { pmNum: row.pm_request_number } })
        )
      )
      for (const r of settled) {
        res.push(r.status === "fulfilled"
          ? { pmNum: r.value.pmNum, status: "ok" }
          : { pmNum: "?", status: "error", message: r.reason?.message ?? String(r.reason) })
      }
      setProgress(Math.min(i + BATCH, matched.length))
    }
    setResults(res)
    qc.invalidateQueries({ queryKey: ["pm-plans-map"] })
    setStage("done")
  }

  const reset = () => {
    setStage("idle"); setFileName(""); setMatched([]); setUnmatched([])
    setInvalid([]); setResults([]); setProgress(0)
  }

  const okCount  = results.filter(r => r.status === "ok").length
  const errCount = results.filter(r => r.status === "error").length

  // ── shared table helper ────────────────────────────────────────────────────
  const Table = ({ bg, border, title, cols, rows }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ background: bg, border: `1px solid ${border}`, borderBottom: "none", borderRadius: "8px 8px 0 0", padding: "8px 14px", fontWeight: 700, fontSize: 13 }}>
        {title}
      </div>
      <div style={{ overflow: "auto", border: `1px solid ${border}`, borderRadius: "0 0 8px 8px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: bg + "80" }}>
              {cols.map(c => <th key={c} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", borderBottom: `1px solid ${border}` }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${bg}` }}>
                {cells.map((cell, j) => <td key={j} style={{ padding: "6px 10px" }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📋 PM Plan Upload</h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#555" }}>
            Upload a PM schedule into the <b>pm_plan</b> table. Match by <b>site_id</b> or <b>engine serial no</b>.
            Duplicate PM numbers are updated (not duplicated).
          </p>
        </div>
        <button onClick={downloadTemplate} style={{ padding: "8px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 7, color: "#166534", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          ⬇ Download Template
        </button>
      </div>

      {/* IDLE */}
      {stage === "idle" && (
        <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "2px dashed #cbd5e1", borderRadius: 12, padding: "48px 24px", cursor: sitesLoading ? "wait" : "pointer", background: "#f8fafc" }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>📂</div>
          <div style={{ fontWeight: 600, fontSize: 15, color: "#334155" }}>
            {sitesLoading ? "Loading sites…" : "Click to select Excel file"}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 5 }}>
            Columns: pm_request_number · site_id / engine_serial_no · planned_date · service_type
          </div>
          <input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={sitesLoading} style={{ display: "none" }} />
        </label>
      )}

      {/* PREVIEW */}
      {stage === "preview" && (
        <>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
            <span style={{ fontSize: 13, color: "#0369a1" }}><b>File:</b> {fileName}</span>
            <span style={{ fontWeight: 700, color: "#15803d" }}>✅ {matched.length} will be upserted</span>
            {unmatched.length > 0 && <span style={{ fontWeight: 700, color: "#b45309" }}>⚠️ {unmatched.length} site not found</span>}
            {invalid.length  > 0 && <span style={{ fontWeight: 700, color: "#dc2626" }}>❌ {invalid.length} invalid</span>}
            <button onClick={reset} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}>✖ Change file</button>
          </div>

          {matched.length > 0 && (
            <Table bg="#dcfce7" border="#86efac"
              title={`✅ ${matched.length} rows will be upserted`}
              cols={["PM No.", "Site ID", "Site Name", "Planned Date", "Service Type", "Plan Type", "AMC", "Fold"]}
              rows={matched.map(({ site, row }) => [row.pm_request_number, site.site_id, site.name || "—", row.planned_date, row.service_type, row.plan_type, row.amc_type ?? "—", row.fold_status ?? "—"])}
            />
          )}

          {unmatched.length > 0 && (
            <Table bg="#fef9c3" border="#fde68a"
              title={`⚠️ ${unmatched.length} rows — site not found (skipped)`}
              cols={["PM No.", "site_id tried", "engine_serial_no tried"]}
              rows={unmatched.map(r => [r.pmNum, r.siteIdTxt || "(blank)", r.serialTxt || "(blank)"])}
            />
          )}

          {invalid.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderBottom: "none", borderRadius: "8px 8px 0 0", padding: "8px 14px", fontWeight: 700, fontSize: 13, color: "#dc2626" }}>
                ❌ {invalid.length} rows — invalid data (skipped)
              </div>
              <div style={{ border: "1px solid #fecaca", borderRadius: "0 0 8px 8px" }}>
                {invalid.map((r, i) => (
                  <div key={i} style={{ padding: "7px 12px", fontSize: 12, borderBottom: "1px solid #fef2f2" }}>
                    <b>{r.pmNum}</b> — {r.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={!matched.length}
            style={{ width: "100%", padding: "13px", background: matched.length ? "#1a73e8" : "#cbd5e1", color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: matched.length ? "pointer" : "default" }}
          >
            {matched.length ? `⬆ Upload ${matched.length} PM Plans` : "No valid rows to upload"}
          </button>
        </>
      )}

      {/* UPLOADING */}
      {stage === "uploading" && (
        <div style={{ textAlign: "center", padding: "56px 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Uploading… {progress} / {matched.length}</div>
          <div style={{ width: "100%", maxWidth: 300, height: 8, background: "#e2e8f0", borderRadius: 4, margin: "0 auto" }}>
            <div style={{ height: "100%", borderRadius: 4, background: "#1a73e8", width: `${matched.length ? (progress / matched.length) * 100 : 0}%`, transition: "width 0.2s" }} />
          </div>
        </div>
      )}

      {/* DONE */}
      {stage === "done" && (
        <>
          <div style={{ background: errCount === 0 ? "#f0fdf4" : "#fffbeb", border: `1px solid ${errCount === 0 ? "#86efac" : "#fde68a"}`, borderRadius: 10, padding: "22px", marginBottom: 20, textAlign: "center" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>{errCount === 0 ? "✅" : "⚠️"}</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>
              {errCount === 0 ? `All ${okCount} PM plans uploaded!` : `${okCount} uploaded · ${errCount} failed`}
            </div>
            {unmatched.length > 0 && <div style={{ fontSize: 13, color: "#92400e", marginTop: 6 }}>{unmatched.length} rows skipped — site not found</div>}
          </div>
          {errCount > 0 && results.filter(r => r.status === "error").map((r, i) => (
            <div key={i} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px", marginBottom: 6, fontSize: 12 }}>
              <b>{r.pmNum}</b> — {r.message}
            </div>
          ))}
          <button onClick={reset} style={{ width: "100%", padding: "12px", background: "white", border: "2px solid #1a73e8", color: "#1a73e8", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Upload Another File
          </button>
        </>
      )}
    </div>
  )
}
