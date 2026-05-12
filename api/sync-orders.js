import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const DEFAULT_SYNC_AFTER = '2026-05-12T00:00:00Z'
const PER_PAGE = 100
const MAX_PAGES_PER_SITE = 20

function authHeader(key, secret) {
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64')
}

function money(v) {
  return Number(v || 0)
}

function address(a = {}, s = {}) {
  const b = a || {}
  const fallback = s || {}
  return (
    [b.address_1, b.address_2, b.city, b.state, b.postcode, b.country]
      .filter(Boolean)
      .join(', ') ||
    [fallback.address_1, fallback.address_2, fallback.city, fallback.state, fallback.postcode, fallback.country]
      .filter(Boolean)
      .join(', ')
  )
}

function toIsoAfter(value) {
  if (!value) return DEFAULT_SYNC_AFTER
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return DEFAULT_SYNC_AFTER
  return d.toISOString()
}

export default async function handler(req, res) {
  try {
    if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ ok: false, error: 'Missing Supabase environment variables' })
    }

    const { data: sites, error: siteErr } = await supabase
      .from('sites')
      .select('*')
      .eq('enabled', true)

    if (siteErr) throw siteErr

    let upserted = 0
    const results = []

    for (const site of sites || []) {
      const base = site.site_url.replace(/\/$/, '')
      const after = toIsoAfter(site.sync_after)
      let siteCount = 0

      for (let page = 1; page <= MAX_PAGES_PER_SITE; page++) {
        const params = new URLSearchParams({
          per_page: String(PER_PAGE),
          page: String(page),
          orderby: 'date',
          order: 'desc',
          after,
        })

        const url = `${base}/wp-json/wc/v3/orders?${params.toString()}`
        const r = await fetch(url, {
          headers: { Authorization: authHeader(site.consumer_key, site.consumer_secret) },
        })

        if (!r.ok) {
          const text = await r.text()
          await supabase.from('sync_logs').insert({
            site_id: site.id,
            status: 'error',
            message: `${r.status} ${text}`.slice(0, 1000),
          })
          results.push({ site: site.site_name, ok: false, error: `${r.status} ${text}`.slice(0, 300) })
          break
        }

        const orders = await r.json()
        if (!Array.isArray(orders) || orders.length === 0) break

        for (const o of orders) {
          const row = {
            site_id: site.id,
            wc_order_id: String(o.id),
            order_number: String(o.number || o.id),
            customer_name:
              [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') ||
              [o.shipping?.first_name, o.shipping?.last_name].filter(Boolean).join(' ') ||
              '',
            customer_email: o.billing?.email || '',
            customer_phone: o.billing?.phone || '',
            customer_address: address(o.shipping, o.billing),
            total_amount: money(o.total),
            currency: o.currency || '',
            wc_status: o.status || '',
            internal_status: '待处理',
            created_at: o.date_created_gmt
              ? new Date(o.date_created_gmt + 'Z').toISOString()
              : new Date().toISOString(),
            synced_at: new Date().toISOString(),
            raw: o,
          }

          const { data: existing } = await supabase
            .from('orders')
            .select('id,internal_status,last_handled_by,last_handled_at')
            .eq('site_id', site.id)
            .eq('wc_order_id', String(o.id))
            .maybeSingle()

          if (existing) {
            row.internal_status = existing.internal_status
            row.last_handled_by = existing.last_handled_by
            row.last_handled_at = existing.last_handled_at
          }

          const { data: ord, error: ordErr } = await supabase
            .from('orders')
            .upsert(row, { onConflict: 'site_id,wc_order_id' })
            .select('id')
            .single()

          if (ordErr) throw ordErr

          await supabase.from('order_items').delete().eq('order_id', ord.id)

          const items = (o.line_items || []).map((i) => ({
            order_id: ord.id,
            product_name: i.name,
            sku: i.sku || '',
            quantity: i.quantity || 0,
            price: money(i.total),
          }))

          if (items.length) {
            const { error: itemErr } = await supabase.from('order_items').insert(items)
            if (itemErr) throw itemErr
          }

          upserted++
          siteCount++
        }

        if (orders.length < PER_PAGE) break
      }

      await supabase.from('sync_logs').insert({
        site_id: site.id,
        status: 'success',
        message: `synced ${siteCount} orders after ${after}`,
      })

      results.push({ site: site.site_name, ok: true, synced: siteCount, after })
    }

    res.status(200).json({ ok: true, upserted, results })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
}
