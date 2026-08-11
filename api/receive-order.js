import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY

const PUSH_SECRET =
  process.env.ORDER_PUSH_SECRET

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables')
}

if (!PUSH_SECRET) {
  throw new Error('Missing ORDER_PUSH_SECRET')
}

const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey
)

function money(v) {
  return Number(v || 0)
}

function address(a = {}, s = {}) {
  const b = a || {}
  const fallback = s || {}

  return (
    [
      b.address_1,
      b.address_2,
      b.city,
      b.state,
      b.postcode,
      b.country,
    ]
      .filter(Boolean)
      .join(', ') ||
    [
      fallback.address_1,
      fallback.address_2,
      fallback.city,
      fallback.state,
      fallback.postcode,
      fallback.country,
    ]
      .filter(Boolean)
      .join(', ')
  )
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    })
  }

  try {
    const providedSecret =
      req.headers['x-order-push-secret']

    if (
      !providedSecret ||
      providedSecret !== PUSH_SECRET
    ) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      })
    }

    const payload = req.body

    if (!payload?.site_url) {
      return res.status(400).json({
        ok: false,
        error: 'Missing site_url',
      })
    }

    if (!payload?.order?.id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing order',
      })
    }

    const o = payload.order

    const cleanUrl = String(
      payload.site_url
    ).replace(/\/+$/, '')

    const {
      data: sites,
      error: siteError,
    } = await supabase
      .from('sites')
      .select('*')
      .eq('enabled', true)

    if (siteError) {
      throw siteError
    }

    const site = (sites || []).find(s => {
      const dbUrl = String(
        s.site_url || ''
      ).replace(/\/+$/, '')

      return dbUrl === cleanUrl
    })

    if (!site) {
      return res.status(404).json({
        ok: false,
        error: `Site not found: ${cleanUrl}`,
      })
    }

    /*
     * 只导入 processing / completed
     */
    if (
      !['processing', 'completed'].includes(
        o.status
      )
    ) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: `invalid_status:${o.status}`,
        order_id: o.id,
      })
    }

    /*
     * 最关键：
     * 已存在就直接跳过
     */
    const {
      data: existing,
      error: existingError,
    } = await supabase
      .from('orders')
      .select('id')
      .eq('site_id', site.id)
      .eq(
        'wc_order_id',
        String(o.id)
      )
      .maybeSingle()

    if (existingError) {
      throw existingError
    }

    if (existing) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'already_exists',
        order_id: o.id,
        database_id: existing.id,
      })
    }

    const row = {
      site_id:
        site.id,

      wc_order_id:
        String(o.id),

      order_number:
        String(o.number || o.id),

      customer_name:
        [
          o.billing?.first_name,
          o.billing?.last_name,
        ]
          .filter(Boolean)
          .join(' ') ||
        [
          o.shipping?.first_name,
          o.shipping?.last_name,
        ]
          .filter(Boolean)
          .join(' ') ||
        '',

      customer_email:
        o.billing?.email || '',

      customer_phone:
        o.billing?.phone || '',

      customer_address:
        address(
          o.shipping,
          o.billing
        ),

      total_amount:
        money(o.total),

      currency:
        o.currency || '',

      wc_status:
        o.status || '',

      internal_status:
        '待处理',

      created_at:
        o.date_created_gmt
          ? new Date(
              `${o.date_created_gmt}Z`
            ).toISOString()
          : o.date_created
            ? new Date(
                o.date_created
              ).toISOString()
            : new Date().toISOString(),

      synced_at:
        new Date().toISOString(),

      raw:
        o,
    }

    const {
      data: orderRow,
      error: orderError,
    } = await supabase
      .from('orders')
      .insert(row)
      .select('id')
      .single()

    if (orderError) {
      throw orderError
    }

    const items =
      (o.line_items || []).map(i => ({
        order_id:
          orderRow.id,

        product_name:
          i.name || '',

        sku:
          i.sku || '',

        quantity:
          Number(i.quantity || 0),

        price:
          money(i.total),
      }))

    if (items.length) {
      const {
        error: itemError,
      } = await supabase
        .from('order_items')
        .insert(items)

      if (itemError) {
        throw itemError
      }
    }

    return res.status(200).json({
      ok: true,
      inserted: true,
      order_id: o.id,
      database_id: orderRow.id,
    })

  } catch (error) {
    console.error(
      'receive-order error:',
      error
    )

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        'Unknown error',
    })
  }
}