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

function normalizeHost(value) {
  try {
    return new URL(
      String(value || '').trim()
    )
      .hostname
      .toLowerCase()
      .replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeOrderDate(o) {
  if (o?.date_created_gmt) {
    const value = String(
      o.date_created_gmt
    ).trim()

    const date = new Date(
      value.endsWith('Z')
        ? value
        : `${value}Z`
    )

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  if (o?.date_created) {
    const date = new Date(
      o.date_created
    )

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return new Date().toISOString()
}

export default async function handler(req, res) {
  /*
   * Only WordPress should POST here.
   */
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    })
  }

  try {
    /*
     * =====================================================
     * 1. Verify Push Secret
     * =====================================================
     */
    const providedSecret =
      req.headers[
        'x-order-push-secret'
      ]

    if (
      !providedSecret ||
      providedSecret !== PUSH_SECRET
    ) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      })
    }

    /*
     * =====================================================
     * 2. Validate payload
     * =====================================================
     */
    const payload = req.body || {}

    if (!payload.site_url) {
      return res.status(400).json({
        ok: false,
        error: 'Missing site_url',
      })
    }

    if (!payload.order?.id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing order',
      })
    }

    const o = payload.order

    /*
     * =====================================================
     * 3. Match WordPress site to Supabase site
     *
     * Important:
     * Match hostname instead of full URL.
     *
     * These will all match:
     *
     * https://notablevapea.com
     * https://notablevapea.com/
     * https://www.notablevapea.com
     * =====================================================
     */
    const incomingHost =
      normalizeHost(
        payload.site_url
      )

    if (!incomingHost) {
      return res.status(400).json({
        ok: false,
        error:
          `Invalid site_url: ${payload.site_url}`,
      })
    }

    const {
      data: sites,
      error: siteError,
    } = await supabase
      .from('sites')
      .select(
        'id,site_name,site_url,enabled'
      )
      .eq('enabled', true)

    if (siteError) {
      throw siteError
    }

    const site =
      (sites || []).find(s => {
        const dbHost =
          normalizeHost(
            s.site_url
          )

        return (
          dbHost &&
          dbHost === incomingHost
        )
      })

    if (!site) {
      return res.status(404).json({
        ok: false,
        error:
          `Site not found: ${payload.site_url}`,
        incoming_host:
          incomingHost,
      })
    }

    /*
     * =====================================================
     * 4. Only import valid WooCommerce statuses
     * =====================================================
     */
    const validStatuses = [
      'processing',
      'completed',
    ]

    if (
      !validStatuses.includes(
        o.status
      )
    ) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason:
          `invalid_status:${o.status}`,
        order_id:
          o.id,
        site:
          site.site_name,
      })
    }

    /*
     * =====================================================
     * 5. Check whether order already exists
     *
     * Existing orders are NEVER rewritten here.
     * =====================================================
     */
    const {
      data: existing,
      error: existingError,
    } = await supabase
      .from('orders')
      .select(
        'id,internal_status,last_handled_by,last_handled_at'
      )
      .eq(
        'site_id',
        site.id
      )
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
        reason:
          'already_exists',
        order_id:
          o.id,
        database_id:
          existing.id,
        site:
          site.site_name,
      })
    }

    /*
     * =====================================================
     * 6. Build new order row
     * =====================================================
     */
    const row = {
      site_id:
        site.id,

      wc_order_id:
        String(o.id),

      order_number:
        String(
          o.number || o.id
        ),

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
        normalizeOrderDate(o),

      synced_at:
        new Date()
          .toISOString(),

      raw:
        o,
    }

    /*
     * =====================================================
     * 7. Insert order
     * =====================================================
     */
    const {
      data: orderRow,
      error: orderError,
    } = await supabase
      .from('orders')
      .insert(row)
      .select('id')
      .single()

    if (orderError) {
      /*
       * Extra protection in case two pushes arrive
       * almost at the same time.
       */
      if (
        orderError.code ===
        '23505'
      ) {
        const {
          data: duplicate,
        } = await supabase
          .from('orders')
          .select('id')
          .eq(
            'site_id',
            site.id
          )
          .eq(
            'wc_order_id',
            String(o.id)
          )
          .maybeSingle()

        return res.status(200).json({
          ok: true,
          skipped: true,
          reason:
            'already_exists',
          order_id:
            o.id,
          database_id:
            duplicate?.id || null,
          site:
            site.site_name,
        })
      }

      throw orderError
    }

    /*
     * =====================================================
     * 8. Insert order items
     * =====================================================
     */
    const items =
      (o.line_items || [])
        .map(i => ({
          order_id:
            orderRow.id,

          product_name:
            i.name || '',

          sku:
            i.sku || '',

          quantity:
            Number(
              i.quantity || 0
            ),

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
        /*
         * Order was already inserted.
         * Return error so we can see that items failed.
         */
        throw itemError
      }
    }

    /*
     * =====================================================
     * 9. Success
     * =====================================================
     */
    return res.status(200).json({
      ok: true,
      inserted: true,

      site:
        site.site_name,

      site_id:
        site.id,

      incoming_host:
        incomingHost,

      order_id:
        o.id,

      order_number:
        String(
          o.number || o.id
        ),

      database_id:
        orderRow.id,
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