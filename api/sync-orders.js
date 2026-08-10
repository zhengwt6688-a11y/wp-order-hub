import {
	createClient
} from '@supabase/supabase-js'

const supabaseUrl =
	process.env.SUPABASE_URL ||
	process.env.VITE_SUPABASE_URL

const supabaseServiceKey =
	process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
	throw new Error('Missing Supabase environment variables')
}

const supabase = createClient(
	supabaseUrl,
	supabaseServiceKey
)

const DEFAULT_SYNC_AFTER = '2026-05-12T00:00:00Z'
const PER_PAGE = 100
const MAX_PAGES_PER_SITE = 20

// 只导入有效订单
const VALID_WOO_STATUSES = [
	'processing',
	'completed',
]

function authHeader(key, secret) {
	return (
		'Basic ' +
		Buffer.from(`${key}:${secret}`).toString('base64')
	)
}

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

function toIsoAfter(value) {
	if (!value) return DEFAULT_SYNC_AFTER

	const d = new Date(value)

	if (Number.isNaN(d.getTime())) {
		return DEFAULT_SYNC_AFTER
	}

	return d.toISOString()
}

function safeTextPreview(text, maxLength = 500) {
	if (!text) return ''

	return String(text)
		.replace(/\s+/g, ' ')
		.slice(0, maxLength)
}

function looksLikeHtml(text) {
	if (!text) return false

	const t = String(text)
		.trim()
		.toLowerCase()

	return (
		t.startsWith('<!doctype html') ||
		t.startsWith('<html') ||
		t.includes('<head') ||
		t.includes('<body')
	)
}

function tryParseJson(text) {
	try {
		return {
			ok: true,
			data: JSON.parse(text),
		}
	} catch {
		return {
			ok: false,
			data: null,
		}
	}
}

/**
 * WooCommerce 请求：
 *
 * 1. 优先 Query String 认证
 * 2. 如果失败/返回 HTML/非数组，再尝试 Basic Auth
 *
 * 这样不会因为某一个网站的认证方式不同影响其他网站。
 */
async function fetchWooOrders(site, base, originalParams) {
	/*
	 * ==========================================
	 * 方法 1：Query String Authentication
	 * ==========================================
	 */

	const queryParams = new URLSearchParams(
		originalParams
	)

	queryParams.set(
		'consumer_key',
		site.consumer_key
	)

	queryParams.set(
		'consumer_secret',
		site.consumer_secret
	)

	const queryUrl =
		`${base}/wp-json/wc/v3/orders?` +
		queryParams.toString()

	try {
		const response = await fetch(
			queryUrl,
			{
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'User-Agent': 'WP-Order-Hub/1.0',
				},
				redirect: 'follow',
			}
		)

		const text = await response.text()

		const parsed = tryParseJson(text)

		if (
			response.ok &&
			parsed.ok &&
			Array.isArray(parsed.data)
		) {
			return {
				ok: true,
				orders: parsed.data,
				method: 'query',
				status: response.status,
			}
		}

		/*
		 * Query 参数失败以后，不马上报错。
		 * 自动尝试 Basic Auth。
		 */
	} catch (error) {
		console.error(
			`Query auth failed for ${site.site_name}:`,
			error
		)
	}

	/*
	 * ==========================================
	 * 方法 2：Basic Authentication
	 * ==========================================
	 */

	const basicParams = new URLSearchParams(
		originalParams
	)

	const basicUrl =
		`${base}/wp-json/wc/v3/orders?` +
		basicParams.toString()

	try {
		const response = await fetch(
			basicUrl,
			{
				method: 'GET',
				headers: {
					Authorization: authHeader(
						site.consumer_key,
						site.consumer_secret
					),
					Accept: 'application/json',
					'User-Agent': 'WP-Order-Hub/1.0',
				},
				redirect: 'follow',
			}
		)

		const text = await response.text()

		const parsed = tryParseJson(text)

		if (
			response.ok &&
			parsed.ok &&
			Array.isArray(parsed.data)
		) {
			return {
				ok: true,
				orders: parsed.data,
				method: 'basic',
				status: response.status,
			}
		}

		let reason = ''

		if (looksLikeHtml(text)) {
			reason =
				'WooCommerce 返回 HTML，可能被 Cloudflare、Wordfence、WAF、安全验证或重定向拦截。'
		} else if (!parsed.ok) {
			reason =
				'WooCommerce 返回内容不是有效 JSON。'
		} else if (!Array.isArray(parsed.data)) {
			reason =
				'WooCommerce 返回 JSON，但不是订单数组。'
		}

		return {
			ok: false,
			status: response.status,
			error:
				`WooCommerce 同步失败。` +
				`网站：${site.site_name}；` +
				`HTTP：${response.status}；` +
				`${reason}` +
				` 返回内容：${safeTextPreview(text, 500)}`,
		}
	} catch (error) {
		return {
			ok: false,
			status: 0,
			error:
				`WooCommerce 请求失败。` +
				`网站：${site.site_name}；` +
				`错误：${error.message}`,
		}
	}
}

async function writeSyncLog({
	siteId,
	status,
	message,
}) {
	try {
		await supabase
			.from('sync_logs')
			.insert({
				site_id: siteId,
				status,
				message: String(message || '')
					.slice(0, 1000),
			})
	} catch (error) {
		console.error(
			'Failed to write sync log:',
			error
		)
	}
}

export default async function handler(req, res) {
	try {
		const {
			data: sites,
			error: siteErr,
		} = await supabase
			.from('sites')
			.select('*')
			.eq('enabled', true)

		if (siteErr) {
			throw siteErr
		}

		let upserted = 0
		const results = []

		for (const site of sites || []) {

			/*
			 * 每个网站单独 try/catch。
			 * 一个网站报错，不影响其他网站继续同步。
			 */
			try {
				const base = String(
					site.site_url || ''
				)
					.trim()
					.replace(/\/+$/, '')

				if (!base) {
					const msg =
						`网站 ${site.site_name} 没有填写 site_url`

					await writeSyncLog({
						siteId: site.id,
						status: 'error',
						message: msg,
					})

					results.push({
						site: site.site_name,
						ok: false,
						error: msg,
					})

					continue
				}

				if (
					!site.consumer_key ||
					!site.consumer_secret
				) {
					const msg =
						`网站 ${site.site_name} 缺少 WooCommerce Consumer Key 或 Secret`

					await writeSyncLog({
						siteId: site.id,
						status: 'error',
						message: msg,
					})

					results.push({
						site: site.site_name,
						ok: false,
						error: msg,
					})

					continue
				}

				const after = toIsoAfter(
					site.sync_after
				)

				let siteCount = 0
				let pagesFetched = 0
				let authMethod = ''

				for (
					let page = 1;
					page <= MAX_PAGES_PER_SITE;
					page++
				) {
					const params =
						new URLSearchParams({
							per_page:
								String(PER_PAGE),
							page:
								String(page),
							orderby:
								'date',
							order:
								'desc',
							after,
							status:
								VALID_WOO_STATUSES.join(','),
						})

					const wooResult =
						await fetchWooOrders(
							site,
							base,
							params
						)

					if (!wooResult.ok) {
						await writeSyncLog({
							siteId: site.id,
							status: 'error',
							message:
								wooResult.error,
						})

						results.push({
							site:
								site.site_name,
							ok: false,
							error:
								wooResult.error,
						})

						break
					}

					authMethod =
						wooResult.method

					const originalOrders =
						wooResult.orders

					pagesFetched++

					if (
						!Array.isArray(
							originalOrders
						) ||
						originalOrders.length === 0
					) {
						break
					}

					/*
					 * 二次保险。
					 *
					 * 即使 Woo API status 参数没有生效，
					 * 也不会导入 cancelled / failed。
					 */
					const orders =
						originalOrders.filter(
							o =>
								VALID_WOO_STATUSES.includes(
									o.status
								)
						)

					for (const o of orders) {

						const row = {
							site_id:
								site.id,

							wc_order_id:
								String(o.id),

							order_number:
								String(
									o.number ||
									o.id
								),

							customer_name:
								[
									o.billing
										?.first_name,
									o.billing
										?.last_name,
								]
									.filter(Boolean)
									.join(' ') ||
								[
									o.shipping
										?.first_name,
									o.shipping
										?.last_name,
								]
									.filter(Boolean)
									.join(' ') ||
								'',

							customer_email:
								o.billing?.email ||
								'',

							customer_phone:
								o.billing?.phone ||
								'',

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
											o.date_created_gmt +
												'Z'
										).toISOString()
									: o.date_created
										? new Date(
												o.date_created
											).toISOString()
										: new Date()
												.toISOString(),

							synced_at:
								new Date()
									.toISOString(),

							raw: o,
						}

						const {
							data: existing,
							error:
								existingErr,
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

						if (existingErr) {
							throw existingErr
						}

						/*
						 * 非常重要：
						 *
						 * 同步不能覆盖员工已经处理过的：
						 * - internal_status
						 * - 负责人
						 * - 最后处理时间
						 */
						if (existing) {
							row.internal_status =
								existing.internal_status

							row.last_handled_by =
								existing.last_handled_by

							row.last_handled_at =
								existing.last_handled_at
						}

						const {
							data: ord,
							error: ordErr,
						} = await supabase
							.from('orders')
							.upsert(
								row,
								{
									onConflict:
										'site_id,wc_order_id',
								}
							)
							.select('id')
							.single()

						if (ordErr) {
							throw ordErr
						}

						const {
							error:
								deleteItemsErr,
						} = await supabase
							.from('order_items')
							.delete()
							.eq(
								'order_id',
								ord.id
							)

						if (
							deleteItemsErr
						) {
							throw deleteItemsErr
						}

						const items =
							(
								o.line_items ||
								[]
							).map(i => ({
								order_id:
									ord.id,

								product_name:
									i.name ||
									'',

								sku:
									i.sku ||
									'',

								quantity:
									Number(
										i.quantity ||
										0
									),

								price:
									money(
										i.total
									),
							}))

						if (
							items.length
						) {
							const {
								error:
									itemErr,
							} =
								await supabase
									.from(
										'order_items'
									)
									.insert(
										items
									)

							if (
								itemErr
							) {
								throw itemErr
							}
						}

						upserted++
						siteCount++
					}

					/*
					 * 注意这里必须看原始返回数量，
					 * 不能看过滤后的 orders.length。
					 *
					 * 否则某一页存在被过滤订单时，
					 * 可能提前停止分页。
					 */
					if (
						originalOrders.length <
						PER_PAGE
					) {
						break
					}
				}

				/*
				 * 如果这个网站前面已经产生 error result，
				 * 不再额外写 success。
				 */
				const alreadyFailed =
					results.some(
						r =>
							r.site ===
								site.site_name &&
							r.ok === false
					)

				if (!alreadyFailed) {
					await writeSyncLog({
						siteId: site.id,
						status: 'success',
						message:
							`synced ${siteCount} valid orders ` +
							`after ${after}; ` +
							`auth=${authMethod || 'unknown'}; ` +
							`pages=${pagesFetched}`,
					})

					results.push({
						site:
							site.site_name,

						ok:
							true,

						synced:
							siteCount,

						after,

						auth:
							authMethod,

						pages:
							pagesFetched,
					})
				}

			} catch (siteError) {
				const msg =
					`网站 ${site.site_name} 同步异常：` +
					siteError.message

				await writeSyncLog({
					siteId: site.id,
					status: 'error',
					message: msg,
				})

				results.push({
					site: site.site_name,
					ok: false,
					error: msg,
				})

				/*
				 * 不 throw。
				 * 继续同步下一个网站。
				 */
				continue
			}
		}

		return res.status(200).json({
			ok: true,
			upserted,
			results,
		})

	} catch (e) {
		console.error(
			'sync-orders fatal error:',
			e
		)

		return res.status(500).json({
			ok: false,
			error:
				e?.message ||
				'Unknown sync error',
		})
	}
}
