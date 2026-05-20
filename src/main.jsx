import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './lib/supabase'
import { Search, RefreshCcw } from 'lucide-react'
import './style.css'

const STATUS = ['待处理','处理中','缺货待处理','客户待回复','已发货','已退款','已取消','已完成','异常订单']
const PENDING_STATUS = ['待处理','处理中','缺货待处理','客户待回复']
const PAGE_SIZE = 50

function getPendingDays(order){
  if(!order || !PENDING_STATUS.includes(order.internal_status)) return 0
  const createdAt = new Date(order.created_at)
  if(Number.isNaN(createdAt.getTime())) return 0
  const now = new Date()
  const diffMs = now - createdAt
  const days = Math.floor(diffMs / (1000*60*60*24))
  return Math.max(days,0)
}

function getPendingLabel(order){
  const days = getPendingDays(order)
  if(!PENDING_STATUS.includes(order.internal_status)) return ''
  if(days >= 2) return `⚠ Pending ${days}天`
  if(days === 1) return `Pending 1天`
  return ''
}

function getPendingStyle(order){
  const days = getPendingDays(order)
  if(days >= 2) return { color:'red', fontWeight:'bold' }
  return {}
}

function Orders({profile}){
  const [orders,setOrders] = useState([])
  const [sites,setSites] = useState([])
  const [employees,setEmployees] = useState([])
  const [selected,setSelected] = useState(null)
  const [msg,setMsg] = useState('')
  const [total,setTotal] = useState(0)
  const [pageNum,setPageNum] = useState(1)
  const [filters,setFilters] = useState({ q:'', status:'', site:'', handler:'', from:'', to:'' })

  useEffect(()=>{ loadSites(); loadEmployees(); },[])
  useEffect(()=>{ loadOrders(); },[pageNum])

  async function loadSites(){
    const {data} = await supabase.from('sites').select('id,site_name').order('site_name')
    setSites(data||[])
  }

  async function loadEmployees(){
    const {data} = await supabase.from('profiles').select('id,name,email,role').order('name')
    setEmployees(data||[])
  }

  async function loadOrders(){
    const fromIndex = (pageNum-1)*PAGE_SIZE
    const toIndex = fromIndex + PAGE_SIZE - 1

    let q = supabase.from('orders')
      .select('*,sites(site_name),profiles!orders_last_handled_by_fkey(name,email)')
      .order('created_at',{ascending:false})
      .range(fromIndex,toIndex)

    if(filters.status) q=q.eq('internal_status',filters.status)
    if(filters.site) q=q.eq('site_id',filters.site)
    if(filters.handler) q=q.eq('last_handled_by',filters.handler)
    if(filters.from) q=q.gte('created_at',filters.from+'T00:00:00')
    if(filters.to) q=q.lte('created_at',filters.to+'T23:59:59')
    if(filters.q) q=q.or(`order_number.ilike.%${filters.q}%,customer_name.ilike.%${filters.q}%,customer_email.ilike.%${filters.q}%,customer_phone.ilike.%${filters.q}%`)

    const {data,error,count} = await q
    if(error) alert(error.message)
    setOrders(data||[])
    setTotal(count||0)
  }

  async function syncOrders(){
    setMsg('正在同步...')
    const r = await fetch('/api/sync-orders')
    const j = await r.json().catch(()=>({}))
    setMsg(j.ok ? `同步完成：新增/更新 ${j.upserted||0} 个订单` : (j.error || '同步失败'))
    setPageNum(1)
    loadOrders()
  }

  const totalPages = Math.max(1,Math.ceil(total/PAGE_SIZE))

  function applyFilters(){ setPageNum(1); setTimeout(()=>loadOrders(),0) }
  function resetFilters(){ setFilters({q:'',status:'',site:'',handler:'',from:'',to:''}); setPageNum(1); setTimeout(()=>loadOrders(),0) }

  return (
    <section>
      <div className="top">
        <h1>订单列表</h1>
        <button onClick={syncOrders}><RefreshCcw size={16}/>同步订单</button>
      </div>

      {msg && <p className="notice">{msg}</p>}

      <div className="filters card">
        <div className="search"><Search size={16}/><input placeholder="订单号/客户/邮箱/电话" value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value})}/></div>
        <select value={filters.site} onChange={e=>setFilters({...filters,site:e.target.value})}><option value="">全部网站</option>{sites.map(s=><option key={s.id} value={s.id}>{s.site_name}</option>)}</select>
        <select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">全部状态</option>{STATUS.map(s=><option key={s}>{s}</option>)}</select>
        <select value={filters.handler} onChange={e=>setFilters({...filters,handler:e.target.value})}><option value="">全部员工</option>{employees.map(u=><option key={u.id} value={u.id}>{u.name||u.email}</option>)}</select>
        <input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/>
        <input type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/>
        <button className="primary" onClick={applyFilters}>筛选</button>
        <button onClick={resetFilters}>重置</button>
      </div>

      <div className="card" style={{marginBottom:'12px'}}>
        共 <b>{total}</b> 个订单，当前第 <b>{pageNum}</b> / <b>{totalPages}</b> 页，每页 <b>{PAGE_SIZE}</b> 条
        <button disabled={pageNum<=1} onClick={()=>setPageNum(pageNum-1)}>上一页</button>
        <button disabled={pageNum>=totalPages} onClick={()=>setPageNum(pageNum+1)}>下一页</button>
      </div>

      <div className="card table">
        <table>
          <thead>
            <tr><th>网站</th><th>订单</th><th>客户</th><th>金额</th><th>Woo状态</th><th>内部状态</th><th>Pending</th><th>负责人</th><th>日期</th></tr>
          </thead>
          <tbody>
            {orders.map(o=>(
              <tr key={o.id} onClick={()=>setSelected(o)}>
                <td>{o.sites?.site_name}</td>
                <td>#{o.order_number}</td>
                <td>{o.customer_name}<br/><span>{o.customer_phone}</span></td>
                <td>{o.currency} {o.total_amount}</td>
                <td>{o.wc_status}</td>
                <td style={{color: PENDING_STATUS.includes(o.internal_status)?'red':'inherit'}}><b>{o.internal_status}</b></td>
                <td style={getPendingStyle(o)}>{getPendingLabel(o)}</td>
                <td>{o.first_handler || '-'}</td>
                <td>{new Date(o.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {orders.length===0 && <tr><td colSpan="9" style={{textAlign:'center',padding:'24px'}}>暂无订单</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && <OrderModal order={selected} close={()=>{setSelected(null); loadOrders()}} statusList={STATUS}/>} 
    </section>
  )
}

export default Orders