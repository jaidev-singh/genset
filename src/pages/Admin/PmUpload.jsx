// PmUpload.jsx
// Admin tool: bulk-update last PM records from an Excel file.
//
// Required Excel columns: engine_serial_no, last_service_date, last_service_type
// Optional Excel columns: pm_done_by, remarks
//
// Column names are matched flexibly (case-insensitive, spaces/underscores ignored).
// Match key is engine_serial_no — rows that don't match any DB site are skipped.
//
// NOTE: pm_done_by and remarks require those columns to exist in Supabase.
// If they don't exist yet, run in Supabase SQL editor:
//   ALTER TABLE sites ADD COLUMN pm_done_by text;
//   ALTER TABLE sites ADD COLUMN remarks     text;

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as XLSX from "xlsx"
import { supabase } from "../../lib/supabase"

// ── helpers ───────────────────────────────────────────────────────────────────

const normalizeSerial = str =>
  (str ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "")

function toIsoDate(val) {
  if (val == null || val === "") return null
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString().slice(0, 10)
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// Flexible aliases → canonical field names.  Add more aliases here as needed.
const HEADER_ALIASES = {
  engine_serial_no:  ["engine_serial_no", "engineserialNo", "serial", "serialno", "engineno", "engine no", "engine_no"],
  last_service_date: ["last_service_date", "lastservicedate", "pmdate", "pm_date", "lastpmdate", "last_pm_date", "servicedate"],
  last_service_type: ["last_service_type", "lastservicetype", "pmtype", "pm_type", "lastpmtype", "last_pm_type", "servicetype"],
  pm_done_by:        ["pm_done_by", "pmdoneby", "technician", "tech", "doneby", "done_by", "engineer"],
  remarks:           ["remarks", "remark", "notes", "note", "comment", "comments"],
}

function resolveHeader(raw) {
  const h = (raw ?? "").toString().toLowerCase().replace(/[\s_]+/g, "")
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some(a => a.replace(/[\s_]+/g, "") === h)) return canonical
  }
  return null
}

function downloadTemplate() {
  const ws = XLSX.utils.json_to_sheet([
    { engine_serial_no: "ENG-001", last_service_date: "2026-03-15", last_service_type: "PM",         pm_done_by: "Ramesh Kumar", remarks: "Oil changed, filters replaced" },
    { engine_serial_no: "ENG-002", last_service_date: "2026-03-20", last_service_type: "CM",         pm_done_by: "",             remarks: "" },
    { engine_serial_no: "ENG-003", last_service_date: "2026-03-22", last_service_type: "Inspection", pm_done_by: "Suresh",       remarks: "" },
  ])
  ws["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 36 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "PM Data")
  XLSX.writeFile(wb, "pm_upload_template.xlsx")
}

// Parallel upload in batches of 10 to stay fast without hammering Supabase
const BATCH_SIZE = 10

// ── reusable table ─────────────────────────────────────────────────────────────

function PreviewTable({ title, headerBg, headerColor, borderColor, stripeBg, cols, rows }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        background: headerBg, color: headerColor,
        border: `1px solid ${borderColor}`, borderBottom: "none",
        borderRadius: "8px 8px 0 0", padding: "8px 14px",
        fontWeight: 700, fontSize: 13
      }}>
        {title}
      </div>
      <div style={{ overflowX: "auto", border: `1px solid ${borderColor}`, borderRadius: "0 0 8px 8px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: stripeBg }}>
              {cols.map(c => (
                <th key={c} style={{
                  padding: "7px 10px", textAlign: "left",
                  fontWeight: 600, whiteSpace: "nowrap",
                  borderBottom: `1px solid ${borderColor}`
                }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${stripeBg}` }}>
                {row.map((cell, j) => (
                  <td key={j} style={{
                    padding: "6px 10px",
                    color: cell === "(blank)" ? "#94a3b8" : undefined
                  }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────────

export default function PmUpload() {
  const queryClient = useQueryClient()

  // "idle" | "preview" | "uploading" | "done"
  const [stage,          setStage]          = useState("idle")
  const [fileName,       setFileName]       = useState("")
  const [matchedRows,    setMatchedRows]    = useState([])   // [{ site, row }]
  const [unmatchedRows,  setUnmatchedRows]  = useState([])   // [{ rawSerial, row }]
  const [optCols,        setOptCols]        = useState({ pm_done_by: false, remarks: false })
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadResults,  setUploadResults]  = useState([])   // [{ siteId, engineNo, status, message }]

  // Lightweight fetch — only what we need for matching
  const { data: sites = [], isLoading: sitesLoading } = useQuery({
    queryKey: ["sites-serials"],
    queryFn: async () => {
      const all = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from("sites").select("id, site_id, engine_serial_no")
          .order("id").range(from, from + 999)
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
        from += 1000
      }
      return all
    }
  })

  // ── parse Excel ─────────────────────────────────────────────────────────────

  const handleFile = e => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const wb       = XLSX.read(evt.target.result, { type: "array", cellDates: true })
        const ws       = wb.Sheets[wb.SheetNames[0]]
        const rawRows  = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true })

        if (!rawRows.length) { alert("Sheet is empty ❌"); return }

        // Map each raw header → canonical key
        const colMap = {}
        for (const rawKey of Object.keys(rawRows[0])) {
          const canonical = resolveHeader(rawKey)
          if (canonical) colMap[rawKey] = canonical
        }

        // Reverse: canonical → first matching raw key
        const rev = {}
        for (const [raw, canon] of Object.entries(colMap)) {
          if (!(canon in rev)) rev[canon] = raw
        }

        const get = (row, key) => (rev[key] !== undefined ? row[rev[key]] : undefined)

        if (!rev.engine_serial_no) {
          alert(
            "Column 'engine_serial_no' not found in sheet.\n" +
            "Please download the template and use that column layout."
          )
          return
        }

        const detected = {
          pm_done_by: Boolean(rev.pm_done_by),
          remarks:    Boolean(rev.remarks),
        }
        setOptCols(detected)

        // Build lookup: normalised serial → site record
        const siteMap = new Map()
        for (const s of sites) {
          const key = normalizeSerial(s.engine_serial_no)
          if (key) siteMap.set(key, s)
        }

        const matched   = []
        const unmatched = []

        for (const row of rawRows) {
          const rawSerial = (get(row, "engine_serial_no") ?? "").toString().trim()
          const site      = siteMap.get(normalizeSerial(rawSerial))

          const parsed = {
            engine_serial_no: rawSerial,
            last_service_date: toIsoDate(get(row, "last_service_date")),
            last_service_type: (get(row, "last_service_type") ?? "").toString().trim() || null,
            ...(detected.pm_done_by && { pm_done_by: (get(row, "pm_done_by") ?? "").toString().trim() || null }),
            ...(detected.remarks    && { remarks:    (get(row, "remarks")    ?? "").toString().trim() || null }),
          }

          if (site) matched.push({ site, row: parsed })
          else      unmatched.push({ rawSerial, row: parsed })
        }

        setMatchedRows(matched)
        setUnmatchedRows(unmatched)
        setStage("preview")
      } catch (err) {
        alert("Failed to parse file ❌\n" + err.message)
        console.error(err)
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ""   // allow re-selecting same file after a clear
  }

  // ── upload ───────────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    setStage("uploading")
    setUploadProgress(0)

    const results = []

    for (let i = 0; i < matchedRows.length; i += BATCH_SIZE) {
      const batch = matchedRows.slice(i, i + BATCH_SIZE)

      const settled = await Promise.allSettled(
        batch.map(({ site, row }) => {
          const updateObj = {
            last_service_date: row.last_service_date,
            last_service_type: row.last_service_type,
            ...(optCols.pm_done_by && { pm_done_by: row.pm_done_by }),
            ...(optCols.remarks    && { remarks:    row.remarks }),
          }
          return supabase.from("sites").update(updateObj).eq("id", site.id)
            .then(({ error }) => {
              if (error) throw { siteId: site.site_id, engineNo: row.engine_serial_no, message: error.message }
              return { siteId: site.site_id, engineNo: row.engine_serial_no }
            })
        })
      )

      for (const r of settled) {
        if (r.status === "fulfilled") {
          results.push({ ...r.value, status: "ok", message: null })
        } else {
          results.push({ ...r.reason, status: "error" })
        }
      }

      setUploadProgress(Math.min(i + BATCH_SIZE, matchedRows.length))
    }

    setUploadResults(results)
    queryClient.invalidateQueries({ queryKey: ["sites"] })
    queryClient.invalidateQueries({ queryKey: ["sites-admin"] })
    setStage("done")
  }

  const reset = () => {
    setStage("idle")
    setFileName("")
    setMatchedRows([])
    setUnmatchedRows([])
    setOptCols({ pm_done_by: false, remarks: false })
    setUploadResults([])
    setUploadProgress(0)
  }

  const okCount  = uploadResults.filter(r => r.status === "ok").length
  const errCount = uploadResults.filter(r => r.status === "error").length

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "20px 16px" }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", marginBottom: 20,
        flexWrap: "wrap", gap: 10
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📊 PM Bulk Upload</h3>
          <p style={{ margin: "4px 0 0", color: "#555", fontSize: 13 }}>
            Update last PM date, type, technician and remarks for multiple sites in one go.
            Matched by <b>engine serial number</b>.
          </p>
        </div>
        <button
          onClick={downloadTemplate}
          style={{
            padding: "8px 14px", background: "#f0fdf4",
            border: "1px solid #86efac", borderRadius: 7,
            color: "#166534", fontWeight: 600, fontSize: 13, cursor: "pointer"
          }}
        >
          ⬇ Download Template
        </button>
      </div>

      {/* ── IDLE ─────────────────────────────────────────────────────────────── */}
      {stage === "idle" && (
        <>
          {/* Step guide */}
          <div style={{ display: "flex", marginBottom: 20 }}>
            {["1  Download the template", "2  Fill in your PM data", "3  Upload & confirm below"].map((step, i, arr) => (
              <div key={i} style={{
                flex: 1, padding: "10px 12px", textAlign: "center",
                background: "#f8fafc", fontSize: 12, fontWeight: 500, color: "#475569",
                borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0",
                borderLeft: "1px solid #e2e8f0",
                borderRight: i === arr.length - 1 ? "1px solid #e2e8f0" : "none",
                borderRadius: i === 0 ? "8px 0 0 8px" : i === arr.length - 1 ? "0 8px 8px 0" : 0
              }}>
                {step}
              </div>
            ))}
          </div>

          {/* Drop zone */}
          <label style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", border: "2px dashed #cbd5e1",
            borderRadius: 12, padding: "48px 24px",
            cursor: sitesLoading ? "wait" : "pointer",
            background: "#f8fafc"
          }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>📂</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: "#334155" }}>
              {sitesLoading ? "Loading site database…" : "Click to select Excel file"}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 5 }}>
              .xlsx or .xls · engine_serial_no is the match key
            </div>
            <input
              type="file" accept=".xlsx,.xls"
              onChange={handleFile}
              disabled={sitesLoading}
              style={{ display: "none" }}
            />
          </label>
        </>
      )}

      {/* ── PREVIEW ──────────────────────────────────────────────────────────── */}
      {stage === "preview" && (
        <>
          {/* Summary bar */}
          <div style={{
            display: "flex", alignItems: "center", flexWrap: "wrap", gap: 20,
            background: "#f0f9ff", border: "1px solid #bae6fd",
            borderRadius: 10, padding: "12px 16px", marginBottom: 22
          }}>
            <span style={{ fontSize: 13, color: "#0369a1" }}><b>File:</b> {fileName}</span>
            <span style={{ fontWeight: 700, color: "#15803d" }}>✅ {matchedRows.length} will be updated</span>
            {unmatchedRows.length > 0 && (
              <span style={{ fontWeight: 700, color: "#b45309" }}>⚠️ {unmatchedRows.length} not matched (skipped)</span>
            )}
            {(optCols.pm_done_by || optCols.remarks) && (
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                Optional cols detected: {[optCols.pm_done_by && "pm_done_by", optCols.remarks && "remarks"].filter(Boolean).join(", ")}
              </span>
            )}
            <button
              onClick={reset}
              style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}
            >
              ✖ Change file
            </button>
          </div>

          {/* Matched preview table */}
          {matchedRows.length > 0 && (
            <PreviewTable
              title={`✅ Matched — ${matchedRows.length} sites will be updated`}
              headerBg="#dcfce7" headerColor="#166534" borderColor="#86efac" stripeBg="#f0fdf4"
              cols={[
                "Site ID", "Engine Serial", "Last PM Date", "PM Type",
                ...(optCols.pm_done_by ? ["Done By"] : []),
                ...(optCols.remarks    ? ["Remarks"]  : []),
              ]}
              rows={matchedRows.map(({ site, row }) => [
                site.site_id,
                row.engine_serial_no,
                row.last_service_date ?? "—",
                row.last_service_type ?? "—",
                ...(optCols.pm_done_by ? [row.pm_done_by ?? "—"] : []),
                ...(optCols.remarks    ? [row.remarks    ?? "—"] : []),
              ])}
            />
          )}

          {/* Unmatched preview table */}
          {unmatchedRows.length > 0 && (
            <PreviewTable
              title={`⚠️ Not Matched — ${unmatchedRows.length} rows skipped (engine serial not found in DB)`}
              headerBg="#fef9c3" headerColor="#854d0e" borderColor="#fde68a" stripeBg="#fefce8"
              cols={["Engine Serial (from sheet)", "Last PM Date", "PM Type"]}
              rows={unmatchedRows.map(({ rawSerial, row }) => [
                rawSerial || "(blank)",
                row.last_service_date ?? "—",
                row.last_service_type ?? "—",
              ])}
            />
          )}

          <button
            onClick={handleUpload}
            disabled={!matchedRows.length}
            style={{
              width: "100%", padding: "13px",
              background: matchedRows.length ? "#1a73e8" : "#cbd5e1",
              color: "white", border: "none", borderRadius: 8,
              fontSize: 15, fontWeight: 700,
              cursor: matchedRows.length ? "pointer" : "default"
            }}
          >
            {matchedRows.length
              ? `⬆ Upload & Update ${matchedRows.length} Sites`
              : "No matched sites to upload"}
          </button>
        </>
      )}

      {/* ── UPLOADING ────────────────────────────────────────────────────────── */}
      {stage === "uploading" && (
        <div style={{ textAlign: "center", padding: "56px 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Updating records…</div>
          <div style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>
            {uploadProgress} / {matchedRows.length}
          </div>
          <div style={{ width: "100%", maxWidth: 300, height: 8, background: "#e2e8f0", borderRadius: 4, margin: "0 auto" }}>
            <div style={{
              height: "100%", borderRadius: 4, background: "#1a73e8",
              width: `${matchedRows.length ? (uploadProgress / matchedRows.length) * 100 : 0}%`,
              transition: "width 0.2s ease"
            }} />
          </div>
        </div>
      )}

      {/* ── DONE ─────────────────────────────────────────────────────────────── */}
      {stage === "done" && (
        <>
          <div style={{
            background: errCount === 0 ? "#f0fdf4" : "#fffbeb",
            border: `1px solid ${errCount === 0 ? "#86efac" : "#fde68a"}`,
            borderRadius: 10, padding: "22px", marginBottom: 20, textAlign: "center"
          }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>{errCount === 0 ? "✅" : "⚠️"}</div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
              {errCount === 0
                ? `All ${okCount} sites updated successfully!`
                : `${okCount} updated · ${errCount} failed`}
            </div>
            {unmatchedRows.length > 0 && (
              <div style={{ fontSize: 13, color: "#92400e", marginTop: 6 }}>
                {unmatchedRows.length} rows were skipped — engine serial not found in DB.
              </div>
            )}
          </div>

          {errCount > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: "#dc2626", fontSize: 13 }}>
                Failed rows:
              </div>
              {uploadResults.filter(r => r.status === "error").map((r, i) => (
                <div key={i} style={{
                  background: "#fef2f2", border: "1px solid #fecaca",
                  borderRadius: 6, padding: "8px 12px", marginBottom: 6, fontSize: 12
                }}>
                  <b>{r.siteId}</b> ({r.engineNo}) — {r.message}
                </div>
              ))}
              {uploadResults.some(r => r.message?.includes("column") || r.message?.includes("does not exist")) && (
                <div style={{
                  marginTop: 10, background: "#fffbeb", border: "1px solid #fde68a",
                  borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "#92400e"
                }}>
                  💡 <b>Column not found?</b> Run this in Supabase SQL editor to add the optional columns:<br />
                  <code style={{ display: "block", marginTop: 6, background: "#fef9c3", padding: "6px 8px", borderRadius: 4 }}>
                    ALTER TABLE sites ADD COLUMN pm_done_by text;<br />
                    ALTER TABLE sites ADD COLUMN remarks text;
                  </code>
                </div>
              )}
            </div>
          )}

          <button
            onClick={reset}
            style={{
              width: "100%", padding: "12px",
              background: "white", border: "2px solid #1a73e8",
              color: "#1a73e8", borderRadius: 8,
              fontSize: 14, fontWeight: 700, cursor: "pointer"
            }}
          >
            Upload Another File
          </button>
        </>
      )}
    </div>
  )
}
