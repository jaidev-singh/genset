import { supabase } from "../lib/supabase"

export async function fetchSites() {
  const allData = []
  let from = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from("sites")
      .select(`
        id, site_id, name, office_id, customer_id,
        contact_phone, engine_model, engine_serial_no, kva,
        genset_status, last_service_date,
        latitude, longitude,
        new_latitude, new_longitude,
        location_verified, location_updated_at,
        customers(*)
      `)
      .order("id", { ascending: true })
      .range(from, from + batchSize - 1)

    if (error) {
      console.error("fetchSites error:", error)
      throw error
    }

    allData.push(...data)
    if (data.length < batchSize) break
    from += batchSize
  }

  const withNew = allData.filter(s => s.new_latitude != null)

  return allData
}