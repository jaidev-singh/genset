// DashboardPage.jsx — Boss overview
//
// Top section : Today's deputation (live)
// Bottom section : Monthly report — Plan vs Done, EVR
//
import { OWNER_NAME } from "../../constants/appConstants"
// "Done" counts are auto-calculated from deputation records.
// "Plan" (target) numbers are manually entered inline and saved to
//   the monthly_targets table (upsert on year+month+category).
//
// EVR = (PM Service + Top Up + CM + Commissioning done) / attendance P-count till today
//
// REQUIRES these SQL migrations (run once in Supabase):
//
//   ALTER TABLE customers ADD COLUMN IF NOT EXISTS category text;
//   -- then manually set: UPDATE customers SET category='Telecom' WHERE ...
//
//   CREATE TABLE IF NOT EXISTS monthly_targets (
//     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
//     year int NOT NULL, month int NOT NULL, category text NOT NULL,
//     target int NOT NULL DEFAULT 0,
//     UNIQUE(year, month, category)
//   );

import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase"
import * as XLSX from "xlsx"

// ── constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
const EVR_TYPES   = new Set(["PM Service","Top Up","CM","Commissioning"])

// Row definitions for the monthly report table.
// cmCat: complaints.cm_category value to filter PM/CM work by. null = any.
// planNA:  plan column shows "N/A" (e.g. Commissioning is demand-driven)
// manual:  done count is entered manually (Overhauling has no deputation work type)
const ROWS = [
  { key:"telecom_pm",   label:"Telecom PM",   workTypes:["PM Service","Top Up"], cmCat:"Telecom",   planNA:false, manual:false },
  { key:"cm",           label:"CM",            workTypes:["CM"],                  cmCat:null,        planNA:false, manual:false },
  { key:"overhauling",  label:"Overhauling",   workTypes:[],                      cmCat:null,        planNA:false, manual:true  },
  { key:"retail_pm",    label:"Retail PM",     workTypes:["PM Service","Top Up"], cmCat:"Retail",    planNA:false, manual:false },
  { key:"corporate_pm", label:"Corporate PM",  workTypes:["PM Service","Top Up"], cmCat:"Corporate", planNA:false, manual:false },
  { key:"commissioning",label:"Commissioning", workTypes:["Commissioning"],       cmCat:null,        planNA:true,  manual:false },
]

// ── helpers ───────────────────────────────────────────────────────────────────

function todayStr()        { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` }
function daysInMonth(y,m)  { return new Date(y,m,0).getDate() }
function pad(n)            { return String(n).padStart(2,"0") }

// ── page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const qc  = useQueryClient()
  const now = new Date()
  const today = todayStr()

  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()+1)

  const monthStart = `${year}-${pad(month)}-01`
  const monthEnd   = `${year}-${pad(month)}-${pad(daysInMonth(year,month))}`
  // For attendance: if viewing current month → count only till today; else full month
  const isCurrentMonth = year===now.getFullYear() && month===now.getMonth()+1
  const attendEnd = isCurrentMonth ? today : monthEnd

  // ── queries ─────────────────────────────────────────────────────────────────

  const { data: todayJobs=[] } = useQuery({
    queryKey: ["dash-today", today],
    queryFn: async () => {
      const {data,error} = await supabase
        .from("deputation")
        .select("id,work_type,status,ref_number,sites(site_id,name),technicians(name),pm_plan(pm_request_number),complaints(complaint_number)")
        .eq("deputation_date", today)
        .order("technician_id")
      if(error) throw error
      return data
    },
    staleTime: 0,
  })

  // Completed deputation this month
  const { data: monthDeps=[] } = useQuery({
    queryKey: ["dash-month-deps", year, month],
    queryFn: async () => {
      const {data,error} = await supabase
        .from("deputation")
        .select("id,work_type,site_id,cm_category")
        .eq("status","Completed")
        .gte("deputation_date", monthStart)
        .lte("deputation_date", monthEnd)
      if(error) throw error
      return data
    },
    staleTime: 60000,
  })

  // Manual plan targets stored per month
  const { data: targetsRaw=[] } = useQuery({
    queryKey: ["monthly-targets", year, month],
    queryFn: async () => {
      try {
        const {data,error} = await supabase
          .from("monthly_targets").select("*").eq("year",year).eq("month",month)
        return error ? [] : (data??[])
      } catch { return [] }
    },
    staleTime: 0,
  })

  // Attendance P-count for EVR denominator
  const { data: attendRows=[] } = useQuery({
    queryKey: ["dash-attend", year, month],
    queryFn: async () => {
      const {data,error} = await supabase
        .from("attendance")
        .select("status,technicians(name)")
        .gte("date", monthStart)
        .lte("date", attendEnd)
      if(error) throw error
      return data
    },
    staleTime: 60000,
  })

  // ── derived ────────────────────────────────────────────────────────────────

  const custMap = {}

  const tgtMap = useMemo(()=>{
    const m={}; targetsRaw.forEach(t=>{ m[t.category]=t }); return m
  },[targetsRaw])

  const attendCount = useMemo(()=>
    attendRows.filter(a=>a.technicians?.name!==OWNER_NAME && a.status==="P").length
  ,[attendRows])

  const evrUnits = useMemo(()=>
    monthDeps.filter(d=>EVR_TYPES.has(d.work_type)).length
  ,[monthDeps])

  const pmVisitsDone = useMemo(()=>
    monthDeps.filter(d=>d.work_type==="PM Visit").length
  ,[monthDeps])

  const doneCounts = useMemo(()=>{
    const c={}
    ROWS.forEach(row=>{
      if(row.manual){
        // overhauling done is stored under key "<rowkey>_done" in monthly_targets
        c[row.key] = tgtMap[row.key+"_done"]?.target ?? 0
        return
      }
      c[row.key] = monthDeps.filter(d=>{
        if(!row.workTypes.includes(d.work_type)) return false
        if(row.cmCat){
          const cat = d.cm_category
          return cat === row.cmCat
        }
        return true
      }).length
    })
    return c
  },[monthDeps, tgtMap])

  const totalPlan = ROWS.filter(r=>!r.planNA).reduce((s,r)=>s+(tgtMap[r.key]?.target??0),0)
  const totalDone = ROWS.reduce((s,r)=>s+(doneCounts[r.key]??0),0)

  // ── save target (or manual done for overhauling) ──────────────────────────

  const saveTarget = async (catKey, val)=>{
    const n = Math.max(0, parseInt(val)||0)
    await supabase.from("monthly_targets").upsert(
      { year, month, category:catKey, target:n },
      { onConflict:"year,month,category" }
    )
    qc.invalidateQueries({ queryKey:["monthly-targets", year, month] })
  }

  // ── month nav ──────────────────────────────────────────────────────────────

  const prevMonth = ()=>{ if(month===1){setYear(y=>y-1);setMonth(12)}else setMonth(m=>m-1) }
  const nextMonth = ()=>{ if(month===12){setYear(y=>y+1);setMonth(1)}else setMonth(m=>m+1) }

  const todayPlanned   = todayJobs.filter(j=>j.status==="Planned").length
  const todayCompleted = todayJobs.filter(j=>j.status==="Completed").length
  const todayCancelled = todayJobs.filter(j=>j.status==="Cancelled").length

  // ── excel exports ─────────────────────────────────────────────────────────

  const exportDeputation = () => {
    const headers = ["Technician", "Site ID", "Site Name", "Work Type", "PM/CM No.", "Status"]
    const rows = todayJobs.map(j => [
      j.technicians?.name ?? "",
      j.sites?.site_id ?? "",
      j.sites?.name ?? "",
      j.work_type,
      j.pm_plan?.pm_request_number ?? j.complaints?.complaint_number ?? j.ref_number ?? "",
      j.status,
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Deputation")
    XLSX.writeFile(wb, `deputation-${today}.xlsx`)
  }

  const exportEOD = () => {
    const monthLabel = `${MONTH_NAMES[month-1]}-${year}`
    const headers = ["Category", "Plan", "Done", "Balance"]
    const dataRows = ROWS.map(row => {
      const plan = row.planNA ? "N/A" : (tgtMap[row.key]?.target ?? 0)
      const done = doneCounts[row.key] ?? 0
      const bal  = row.planNA ? "—" : ((tgtMap[row.key]?.target ?? 0) - done)
      return [row.label, plan, done, bal]
    })
    const totalRow = ["Total", totalPlan, totalDone, totalPlan - totalDone]
    const evrRow   = ["EVR", "", attendCount > 0 ? (evrUnits / attendCount).toFixed(2) : "—",
                      `${evrUnits} units ÷ ${attendCount} person-days`]
    const pmVisitRow = ["PM Visits", "", pmVisitsDone, ""]
    const ws = XLSX.utils.aoa_to_sheet([
      [`Monthly EOD Report — ${monthLabel}`],
      [],
      headers,
      ...dataRows,
      totalRow,
      [],
      evrRow,
      pmVisitRow,
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "EOD Report")
    XLSX.writeFile(wb, `eod-report-${monthLabel}.xlsx`)
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{minHeight:"100vh", background:"#f8fafc"}}>

      {/* Header */}
      <div style={{background:"white",borderBottom:"1px solid #e2e8f0",padding:"0 20px",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:900,margin:"0 auto",height:56,display:"flex",alignItems:"center",gap:16}}>
          <Link to="/" style={{fontSize:18,textDecoration:"none",color:"#374151"}}>←</Link>
          <span style={{fontWeight:800,fontSize:17}}>📊 Dashboard</span>
          <span style={{fontSize:12,color:"#9ca3af",marginLeft:4}}>{today}</span>
        </div>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"24px 16px",display:"flex",flexDirection:"column",gap:24}}>

        {/* ── TODAY'S DEPUTATION ─────────────────────────────────────────── */}
        <Card>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
            <span style={{fontWeight:700,fontSize:15}}>Today's Deputation</span>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <Pill bg="#eff6ff" color="#1d4ed8">{todayPlanned} Planned</Pill>
              <Pill bg="#f0fdf4" color="#15803d">{todayCompleted} Done</Pill>
              {todayCancelled>0 && <Pill bg="#fef2f2" color="#dc2626">{todayCancelled} Cancelled</Pill>}
              {todayJobs.length>0 && (
                <button onClick={exportDeputation}
                  style={{padding:"4px 12px",background:"#f0fdf4",color:"#15803d",border:"1px solid #86efac",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600}}>
                  ⬇ Excel
                </button>
              )}
            </div>
          </div>

          {todayJobs.length===0
            ? <Empty>No deputation entries for today.</Empty>
            : (
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{borderBottom:"2px solid #f3f4f6"}}>
                      {["Technician","Site ID","Site Name","Work Type","PM/CM No.","Status"].map(h=>(
                        <th key={h} style={{padding:"5px 10px",textAlign:"left",color:"#6b7280",fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {todayJobs.map(job=>{
                      const sc = {Planned:"#1d4ed8",Completed:"#15803d",Cancelled:"#dc2626"}[job.status]??"#6b7280"
                      return (
                        <tr key={job.id} style={{borderBottom:"1px solid #f9fafb"}}>
                          <td style={{padding:"6px 10px",fontWeight:600}}>{job.technicians?.name??"—"}</td>
                          <td style={{padding:"6px 10px",fontFamily:"monospace"}}>{job.sites?.site_id??<span style={{color:"#9ca3af"}}>—</span>}</td>
                          <td style={{padding:"6px 10px",color:"#374151"}}>{job.sites?.name??"office/other"}</td>
                          <td style={{padding:"6px 10px"}}>{job.work_type}</td>
                          <td style={{padding:"6px 10px",fontFamily:"monospace",color:"#1d4ed8"}}>{job.pm_plan?.pm_request_number??job.complaints?.complaint_number??job.ref_number??<span style={{color:"#d1d5db"}}>—</span>}</td>
                          <td style={{padding:"6px 10px"}}><span style={{color:sc,fontWeight:600}}>{job.status}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Card>

        {/* ── MONTHLY REPORT ─────────────────────────────────────────────── */}
        <Card>
          {/* Month navigation */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
            <span style={{fontWeight:700,fontSize:15}}>Monthly Report</span>
            <button onClick={prevMonth} style={NAV_BTN}>‹</button>
            <span style={{fontWeight:700,fontSize:14,minWidth:80,textAlign:"center",color:"#1e293b"}}>
              {MONTH_NAMES[month-1]} {year}
            </span>
            <button onClick={nextMonth} style={NAV_BTN}>›</button>
            {isCurrentMonth && <Pill bg="#eff6ff" color="#1d4ed8">Current month</Pill>}
            <button onClick={exportEOD} style={{marginLeft:"auto",padding:"4px 12px",background:"#f0fdf4",color:"#15803d",border:"1px solid #86efac",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600}}>
              ⬇ Excel
            </button>
          </div>

          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:420}}>
              <thead>
                <tr style={{background:"#f8fafc",borderBottom:"2px solid #e2e8f0"}}>
                  <th style={{padding:"9px 14px",textAlign:"left",color:"#6b7280",fontWeight:600,minWidth:150}}></th>
                  <th style={{padding:"9px 14px",textAlign:"right",color:"#6b7280",fontWeight:600,minWidth:80}}>Plan</th>
                  <th style={{padding:"9px 14px",textAlign:"right",color:"#6b7280",fontWeight:600,minWidth:80}}>Done</th>
                  <th style={{padding:"9px 14px",textAlign:"right",color:"#6b7280",fontWeight:600,minWidth:80}}>Balance</th>
                </tr>
              </thead>
              <tbody>

                {ROWS.map(row=>{
                  const plan = tgtMap[row.key]?.target ?? 0
                  const done = doneCounts[row.key] ?? 0
                  const bal  = plan - done
                  return (
                    <tr key={row.key} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"9px 14px",fontWeight:600,color:"#374151"}}>{row.label}</td>

                      {/* Plan — editable except N/A rows */}
                      <td style={{padding:"9px 14px",textAlign:"right"}}>
                        {row.planNA
                          ? <span style={{color:"#9ca3af",fontSize:12}}>N/A</span>
                          : <InlineNum value={plan} onSave={v=>saveTarget(row.key,v)} />
                        }
                      </td>

                      {/* Done — auto from deputation, or editable for manual rows */}
                      <td style={{padding:"9px 14px",textAlign:"right"}}>
                        {row.manual
                          ? <InlineNum value={done} onSave={v=>saveTarget(row.key+"_done",v)} />
                          : <span style={{fontWeight:700,color:done>0?"#15803d":"#9ca3af"}}>{done}</span>
                        }
                      </td>

                      {/* Balance */}
                      <td style={{padding:"9px 14px",textAlign:"right"}}>
                        {row.planNA
                          ? <span style={{color:"#9ca3af"}}>—</span>
                          : <span style={{fontWeight:700,color:bal>0?"#dc2626":bal<0?"#7c3aed":"#15803d"}}>{bal}</span>
                        }
                      </td>
                    </tr>
                  )
                })}

                {/* ── Total ── */}
                <tr style={{borderTop:"2px solid #e2e8f0",background:"#f8fafc"}}>
                  <td style={{padding:"10px 14px",fontWeight:800,fontSize:14}}>Total</td>
                  <td style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:14}}>{totalPlan}</td>
                  <td style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:14,color:"#15803d"}}>{totalDone}</td>
                  <td style={{padding:"10px 14px",textAlign:"right",fontWeight:800,fontSize:14,
                    color:totalPlan-totalDone>0?"#dc2626":totalPlan-totalDone<0?"#7c3aed":"#15803d"}}>
                    {totalPlan-totalDone}
                  </td>
                </tr>

                {/* ── EVR ── */}
                <tr style={{background:"#eff6ff",borderTop:"1px solid #bfdbfe",borderBottom:"1px solid #bfdbfe"}}>
                  <td style={{padding:"10px 14px"}}>
                    <span style={{fontWeight:700,color:"#1d4ed8",fontSize:14}}>EVR</span>
                    <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>PM + CM + Commissioning ÷ attendance</div>
                  </td>
                  <td style={{padding:"10px 14px",textAlign:"right",color:"#9ca3af"}}>—</td>
                  <td style={{padding:"10px 14px",textAlign:"right"}}>
                    <div style={{fontWeight:800,color:"#1d4ed8",fontSize:18,lineHeight:1}}>
                      {attendCount>0 ? (evrUnits/attendCount).toFixed(2) : "—"}
                    </div>
                    <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>
                      {evrUnits} units ÷ {attendCount} person-days
                    </div>
                  </td>
                  <td style={{padding:"10px 14px",textAlign:"right",color:"#9ca3af"}}>—</td>
                </tr>

                {/* ── PM Visits (separate, not in total/EVR) ── */}
                <tr style={{borderTop:"1px solid #f3f4f6"}}>
                  <td style={{padding:"9px 14px",color:"#6b7280",fontStyle:"italic",fontWeight:600}}>PM Visits</td>
                  <td style={{padding:"9px 14px",textAlign:"right",color:"#9ca3af"}}>—</td>
                  <td style={{padding:"9px 14px",textAlign:"right",fontWeight:700,color:"#374151"}}>{pmVisitsDone}</td>
                  <td style={{padding:"9px 14px",textAlign:"right",color:"#9ca3af"}}>—</td>
                </tr>

              </tbody>
            </table>
          </div>

          {/* Footer notes */}
          <div style={{marginTop:12,fontSize:11,color:"#9ca3af",lineHeight:1.6}}>
            Attendance P-days till {isCurrentMonth?"today":MONTH_NAMES[month-1]}: <b style={{color:"#374151"}}>{attendCount}</b>
            &nbsp;|&nbsp;EVR units: <b style={{color:"#374151"}}>{evrUnits}</b> (PM Service + Top Up + CM + Commissioning)
            <span style={{display:"block",marginTop:4}}>Telecom/Retail/Corporate PM counts use the <b>cm_category</b> of the linked complaint in deputation.</span>
          </div>
        </Card>

      </div>
    </div>
  )
}

// ── small helpers ─────────────────────────────────────────────────────────────

function Card({children}) {
  return (
    <div style={{background:"white",borderRadius:12,border:"1px solid #e2e8f0",padding:"20px",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
      {children}
    </div>
  )
}

function Pill({bg,color,children}) {
  return <span style={{background:bg,color,padding:"3px 10px",borderRadius:20,fontWeight:600,fontSize:12}}>{children}</span>
}

function Empty({children}) {
  return <div style={{color:"#9ca3af",fontSize:13,padding:"12px 0"}}>{children}</div>
}

// Click to edit inline number — saves on Enter or blur
function InlineNum({value, onSave}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState("")

  if(editing) {
    return (
      <input
        autoFocus type="number" min={0} value={draft}
        onChange={e=>setDraft(e.target.value)}
        onBlur={()=>{ onSave(draft); setEditing(false) }}
        onKeyDown={e=>{
          if(e.key==="Enter")  { onSave(draft); setEditing(false) }
          if(e.key==="Escape") { setEditing(false) }
        }}
        style={{width:60,padding:"3px 6px",border:"1px solid #93c5fd",borderRadius:5,
          textAlign:"right",fontSize:13,fontWeight:700}}
      />
    )
  }
  return (
    <span
      onClick={()=>{ setDraft(String(value)); setEditing(true) }}
      title="Click to edit"
      style={{cursor:"pointer",padding:"3px 8px",borderRadius:5,background:"#f1f5f9",
        fontWeight:700,color:"#1e293b",display:"inline-block",minWidth:36,textAlign:"right"}}
    >
      {value}
    </span>
  )
}

const NAV_BTN = {
  padding:"4px 12px", background:"#f1f5f9", border:"1px solid #d1d5db",
  borderRadius:6, cursor:"pointer", fontSize:16, lineHeight:1
}
