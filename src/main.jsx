import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './lib/supabase'
import { Search, RefreshCcw, LogOut, Settings, Users, Globe2, FileText } from 'lucide-react'
import './style.css'

const STATUS = ['待处理','处理中','缺货待处理','客户待回复','已发货','已退款','已取消','已完成','异常订单']

function getPendingDays(order) {
  if (
    !order ||
    !['待处理','处理中','缺货待处理','客户待回复'].includes(order.internal_status)
  ) {
    return 0
  }

  const createdAt = new Date(order.created_at)

  if (Number.isNaN(createdAt.getTime())) return 0

  const now = new Date()
  const diffMs = now - createdAt

  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

function getPendingLabel(order) {
  const days = getPendingDays(order)

  if (
    !['待处理','处理中','缺货待处理','客户待回复'].includes(order.internal_status)
  ) {
    return ''
  }

  if (days >= 2) return `⚠ Pending ${days}天`
  if (days === 1) return `Pending 1天`
  return ''
}

function getPendingStyle(order) {
  const days = getPendingDays(order)

  if (days >= 2) {
    return {
      color: '#dc2626',
      fontWeight: 700,
      background: '#fee2e2',
      padding: '4px 8px',
      borderRadius: '999px',
      display: 'inline-block',
    }
  }

  return {
    color: '#374151',
    fontWeight: 600,
  }
}

function App(){
  const [session,setSession]=useState(null)
  const [profile,setProfile]=useState(null)
  const [loading,setLoading]=useState(true)
  const [page,setPage]=useState('orders')

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{
      setSession(data.session)
      setLoading(false)
    })

    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{
    if(session) loadProfile()
    else setProfile(null)
  },[session])

  async function loadProfile(){
    const {data}=await supabase
      .from('profiles')
      .select('*')
      .eq('id',session.user.id)
      .single()

    setProfile(data)
  }

  if(loading) return <div className="center">加载中...</div>
  if(!session) return <Login />

  return (
    <div className="app">
      <aside>
        <h2>订单管理</h2>
        <p className="muted">{profile?.name || session.user.email}</p>

        <button className={page==='orders'?'active':''} onClick={()=>setPage('orders')}>
          <FileText size={16}/>订单
        </button>

        {profile?.role==='admin' && (
          <button className={page==='sites'?'active':''} onClick={()=>setPage('sites')}>
            <Globe2 size={16}/>网站管理
          </button>
        )}

        {profile?.role==='admin' && (
          <button className={page==='users'?'active':''} onClick={()=>setPage('users')}>
            <Users size={16}/>员工/权限
          </button>
        )}

        {profile?.role==='admin' && (
          <button className={page==='logs'?'active':''} onClick={()=>setPage('logs')}>
            <Settings size={16}/>操作日志
          </button>
        )}

        <button onClick={()=>supabase.auth.signOut()}>
          <LogOut size={16}/>退出
        </button>
      </aside>

      <main>
        {page==='orders' && <Orders profile={profile}/>} 
        {page==='sites' && profile?.role==='admin' && <Sites/>}
        {page==='users' && profile?.role==='admin' && <UsersPage/>}
        {page==='logs' && profile?.role==='admin' && <Logs/>}
      </main>
    </div>
  )
}

function Login(){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [err,setErr]=useState('')

  async function submit(e){
    e.preventDefault()
    setErr('')

    const {error}=await supabase.auth.signInWithPassword({email,password})
    if(error) setErr(error.message)
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card login-card">
        <h1>登录订单系统</h1>
        <input placeholder="邮箱" value={email} onChange={e=>setEmail(e.target.value)}/>
        <input placeholder="密码" type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
        {err && <p className="error">{err}</p>}
        <button className="primary">登录</button>
      </form>
    </div>
  )
}

function Orders({profile}){
  const PAGE_SIZE = 50

  const [orders,setOrders]=useState([])
  const [sites,setSites]=useState([])
  const [employees,setEmployees]=useState([])
  const [selected,setSelected]=useState(null)
  const [msg,setMsg]=useState('')
  const [total,setTotal]=useState(0)
  const [pageNum,setPageNum]=useState(1)

  const [f,setF]=useState({
    q:'',
    status:'',
    site:'',
    handler:'',
    from:'',
    to:''
  })

  useEffect(()=>{
    loadSites()
    loadEmployees()
  },[])

  useEffect(()=>{
    loadOrders()
  },[pageNum])

  async function loadSites(){
    const {data}=await supabase
      .from('sites')
      .select('id,site_name')
      .order('site_name')

    setSites(data||[])
  }

  async function loadEmployees(){
    const {data,error}=await supabase
      .from('profiles')
      .select('id,name,email,role')
      .order('name')

    if(error){
      console.error(error)
      return
    }

    setEmployees(data||[])
  }

  async function loadOrders(){
    const fromIndex = (pageNum - 1) * PAGE_SIZE
    const toIndex = fromIndex + PAGE_SIZE - 1

    let q=supabase
      .from('orders')
      .select('*,sites(site_name),profiles!orders_last_handled_by_fkey(name,email)', { count: 'exact' })
      .order('created_at',{ascending:false})
      .range(fromIndex,toIndex)

    if(f.status) q=q.eq('internal_status',f.status)
    if(f.site) q=q.eq('site_id',f.site)
    if(f.handler) q=q.eq('last_handled_by',f.handler)
    if(f.from) q=q.gte('created_at',f.from+'T00:00:00')
    if(f.to) q=q.lte('created_at',f.to+'T23:59:59')

    if(f.q){
      q=q.or(
        `order_number.ilike.%${f.q}%,customer_name.ilike.%${f.q}%,customer_email.ilike.%${f.q}%,customer_phone.ilike.%${f.q}%`
      )
    }

    const {data,error,count}=await q

    if(error){
      alert(error.message)
      return
    }

    setOrders(data||[])
    setTotal(count||0)
  }

  function applyFilters(){
    setPageNum(1)
    setTimeout(()=>loadOrders(),0)
  }

  function resetFilters(){
    setF({
      q:'',
      status:'',
      site:'',
      handler:'',
      from:'',
      to:''
    })
    setPageNum(1)
    setTimeout(()=>loadOrders(),0)
  }

  async function sync(){
    setMsg('正在同步...')

    const r=await fetch('/api/sync-orders')
    const j=await r.json().catch(()=>({}))

    setMsg(j.ok ? `同步完成：新增/更新 ${j.upserted||0} 个订单` : (j.error || '同步失败'))
    setPageNum(1)
    loadOrders()
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <section>
      <div className="top">
        <h1>订单列表</h1>
        <button onClick={sync}>
          <RefreshCcw size={16}/>同步订单
        </button>
      </div>

      {msg && <p className="notice">{msg}</p>}

      <div className="filters card">
        <div className="search">
          <Search size={16}/>
          <input
            placeholder="订单号/客户/邮箱/电话"
            value={f.q}
            onChange={e=>setF({...f,q:e.target.value})}
          />
        </div>

        <select value={f.site} onChange={e=>setF({...f,site:e.target.value})}>
          <option value="">全部网站</option>
          {sites.map(s=>(
            <option key={s.id} value={s.id}>{s.site_name}</option>
          ))}
        </select>

        <select value={f.status} onChange={e=>setF({...f,status:e.target.value})}>
          <option value="">全部状态</option>
          {STATUS.map(s=>(
            <option key={s}>{s}</option>
          ))}
        </select>

        <select value={f.handler} onChange={e=>setF({...f,handler:e.target.value})}>
          <option value="">全部员工</option>
          {employees.map(u=>(
            <option key={u.id} value={u.id}>
              {u.name || u.email}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={f.from}
          onChange={e=>setF({...f,from:e.target.value})}
        />

        <input
          type="date"
          value={f.to}
          onChange={e=>setF({...f,to:e.target.value})}
        />

        <button className="primary" onClick={applyFilters}>筛选</button>
        <button onClick={resetFilters}>重置</button>
      </div>

      <div className="card" style={{marginBottom:'12px'}}>
        <div style={{
          display:'flex',
          justifyContent:'space-between',
          alignItems:'center',
          gap:'12px',
          flexWrap:'wrap'
        }}>
          <div>
            共 <b>{total}</b> 个订单，
            当前第 <b>{pageNum}</b> / <b>{totalPages}</b> 页，
            每页 <b>{PAGE_SIZE}</b> 条
          </div>

          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <button
              disabled={pageNum<=1}
              onClick={()=>setPageNum(pageNum-1)}
            >
              上一页
            </button>

            <button
              disabled={pageNum>=totalPages}
              onClick={()=>setPageNum(pageNum+1)}
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      <div className="card table">
        <table>
          <thead>
            <tr>
              <th>网站</th>
              <th>订单</th>
              <th>客户</th>
              <th>金额</th>
              <th>Woo状态</th>
              <th>内部状态</th>
              <th>Pending</th>
              <th>负责人</th>
              <th>日期</th>
            </tr>
          </thead>

          <tbody>
            {orders.map(o=>(
              <tr key={o.id} onClick={()=>setSelected(o)}>
                <td>{o.sites?.site_name}</td>
                <td>#{o.order_number}</td>
                <td>
                  {o.customer_name}
                  <br/>
                  <span>{o.customer_phone}</span>
                </td>
                <td>{o.currency} {o.total_amount}</td>
                <td>{o.wc_status}</td>
                <td>
                  <b style={o.internal_status === '待处理' ? { color: '#dc2626' } : {}}>
                    {o.internal_status}
                  </b>
                </td>
                <td>
                  {getPendingLabel(o) ? (
                    <span style={getPendingStyle(o)}>
                      {getPendingLabel(o)}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  {o.profiles?.name ||
                   o.profiles?.email ||
                   '-'}
                </td>
                <td>{new Date(o.created_at).toLocaleString()}</td>
              </tr>
            ))}

            {orders.length===0 && (
              <tr>
                <td colSpan="9" style={{textAlign:'center',padding:'24px'}}>
                  暂无订单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{marginTop:'12px'}}>
        <div style={{
          display:'flex',
          justifyContent:'space-between',
          alignItems:'center',
          gap:'12px',
          flexWrap:'wrap'
        }}>
          <div>
            共 <b>{total}</b> 个订单，
            当前第 <b>{pageNum}</b> / <b>{totalPages}</b> 页
          </div>

          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <button
              disabled={pageNum<=1}
              onClick={()=>setPageNum(pageNum-1)}
            >
              上一页
            </button>

            <button
              disabled={pageNum>=totalPages}
              onClick={()=>setPageNum(pageNum+1)}
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <OrderModal
          order={selected}
          close={()=>{
            setSelected(null)
            loadOrders()
          }}
          statusList={STATUS}
        />
      )}
    </section>
  )
}

function OrderModal({order,close,statusList}){
  const [items,setItems]=useState([])
  const [notes,setNotes]=useState([])
  const [status,setStatus]=useState(order.internal_status)
  const [note,setNote]=useState('')

  useEffect(()=>{
    load()
  },[])

  async function load(){
    const {data:i}=await supabase
      .from('order_items')
      .select('*')
      .eq('order_id',order.id)

    setItems(i||[])

    const {data:n}=await supabase
      .from('order_notes')
      .select('*,profiles(name,email)')
      .eq('order_id',order.id)
      .order('created_at',{ascending:false})

    setNotes(n||[])
  }

  async function save(){
    const {data:{user}}=await supabase.auth.getUser()

    if(status!==order.internal_status){
      const ownerPayload = {
        last_handled_at: new Date().toISOString()
      }
      
      if (!order.last_handled_by) {
        ownerPayload.last_handled_by = user.id
      }
      
      await supabase
        .from('orders')
        .update(ownerPayload)
        .eq('id', order.id)

      await supabase
        .from('operation_logs')
        .insert({
          order_id:order.id,
          user_id:user.id,
          action:'修改状态',
          old_value:order.internal_status,
          new_value:status
        })
    }

    if(note.trim()){
      await supabase
        .from('order_notes')
        .insert({
          order_id:order.id,
          user_id:user.id,
          note
        })

      await supabase
        .from('operation_logs')
        .insert({
          order_id:order.id,
          user_id:user.id,
          action:'新增备注',
          new_value:note
        })
    }

    close()
  }

  return (
    <div className="modal">
      <div className="modal-card">
        <div className="top">
          <h2>订单 #{order.order_number}</h2>
          <button onClick={close}>关闭</button>
        </div>

        <p><b>客户：</b>{order.customer_name} / {order.customer_phone} / {order.customer_email}</p>
        <p><b>地址：</b>{order.customer_address}</p>

        {getPendingLabel(order) && (
          <p>
            <b>Pending 预警：</b>
            <span style={getPendingStyle(order)}>
              {getPendingLabel(order)}
            </span>
          </p>
        )}

        <h3>商品</h3>
        <table>
          <tbody>
            {items.map(i=>(
              <tr key={i.id}>
                <td>
                  {i.product_name}
                  <br/>
                  <span>{i.sku}</span>
                </td>
                <td>x{i.quantity}</td>
                <td>{i.price}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>处理</h3>
        <select value={status} onChange={e=>setStatus(e.target.value)}>
          {statusList.map(s=><option key={s}>{s}</option>)}
        </select>

        <textarea
          placeholder="填写处理备注，例如：Mango缺货，已联系客户换口味"
          value={note}
          onChange={e=>setNote(e.target.value)}
        />

        <button className="primary" onClick={save}>保存处理结果</button>

        <h3>备注记录</h3>
        {notes.map(n=>(
          <div className="note" key={n.id}>
            <b>{n.profiles?.name || n.profiles?.email}</b>：{n.note}
            <br/>
            <span>{new Date(n.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Sites(){
  const [rows,setRows]=useState([])
  const [form,setForm]=useState({
    site_name:'',
    site_url:'',
    consumer_key:'',
    consumer_secret:'',
    sync_after:'2026-05-12'
  })

  useEffect(()=>{
    load()
  },[])

  async function load(){
    const {data}=await supabase
      .from('sites')
      .select('*')
      .order('created_at',{ascending:false})

    setRows(data||[])
  }

  async function add(){
    const payload={
      ...form,
      enabled:true,
      sync_after:form.sync_after ? form.sync_after+'T00:00:00Z' : '2026-05-12T00:00:00Z'
    }

    const {error}=await supabase.from('sites').insert(payload)

    if(error) alert(error.message)

    setForm({
      site_name:'',
      site_url:'',
      consumer_key:'',
      consumer_secret:'',
      sync_after:'2026-05-12'
    })

    load()
  }

  return (
    <section>
      <h1>网站管理</h1>

      <div className="card grid">
        <input
          placeholder="网站名称"
          value={form.site_name}
          onChange={e=>setForm({...form,site_name:e.target.value})}
        />

        <input
          placeholder="https://example.com"
          value={form.site_url}
          onChange={e=>setForm({...form,site_url:e.target.value})}
        />

        <input
          placeholder="Consumer Key"
          value={form.consumer_key}
          onChange={e=>setForm({...form,consumer_key:e.target.value})}
        />

        <input
          placeholder="Consumer Secret"
          value={form.consumer_secret}
          onChange={e=>setForm({...form,consumer_secret:e.target.value})}
        />

        <input
          type="date"
          title="只同步这个日期之后的订单"
          value={form.sync_after}
          onChange={e=>setForm({...form,sync_after:e.target.value})}
        />

        <button className="primary" onClick={add}>添加网站</button>
      </div>

      <div className="card table">
        <table>
          <tbody>
            {rows.map(r=>(
              <tr key={r.id}>
                <td>{r.site_name}</td>
                <td>{r.site_url}</td>
                <td>{r.enabled ? '启用' : '停用'}</td>
                <td>
                  从 {r.sync_after ? new Date(r.sync_after).toLocaleDateString() : '2026/5/12'} 同步
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function UsersPage(){
  return (
    <section>
      <h1>员工/权限</h1>
      <div className="card">
        <p>员工账号建议先在 Supabase Authentication 里创建，然后在 profiles 表设置 role：admin 或 staff。</p>
      </div>
    </section>
  )
}

function Logs(){
  const [logs,setLogs]=useState([])

  useEffect(()=>{
    supabase
      .from('operation_logs')
      .select('*,orders(order_number),profiles(name,email)')
      .order('created_at',{ascending:false})
      .limit(300)
      .then(({data})=>setLogs(data||[]))
  },[])

  return (
    <section>
      <h1>操作日志</h1>

      <div className="card table">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>订单</th>
              <th>员工</th>
              <th>动作</th>
              <th>旧值</th>
              <th>新值</th>
            </tr>
          </thead>

          <tbody>
            {logs.map(l=>(
              <tr key={l.id}>
                <td>{new Date(l.created_at).toLocaleString()}</td>
                <td>#{l.orders?.order_number}</td>
                <td>{l.profiles?.name || l.profiles?.email}</td>
                <td>{l.action}</td>
                <td>{l.old_value}</td>
                <td>{l.new_value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

createRoot(document.getElementById('root')).render(<App />)