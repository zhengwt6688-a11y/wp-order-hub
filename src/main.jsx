function Orders({profile}){
  const [orders,setOrders]=useState([])
  const [sites,setSites]=useState([])
  const [employees,setEmployees]=useState([])
  const [selected,setSelected]=useState(null)
  const [msg,setMsg]=useState('')
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
    loadOrders()
  },[])

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
    let q=supabase
      .from('orders')
      .select('*,sites(site_name),profiles!orders_last_handled_by_fkey(name,email)')
      .order('created_at',{ascending:false})
      .limit(300)

    if(f.status) q=q.eq('internal_status',f.status)
    if(f.site) q=q.eq('site_id',f.site)
    if(f.handler) q=q.eq('last_handled_by',f.handler)
    if(f.from) q=q.gte('created_at',f.from+'T00:00:00')
    if(f.to) q=q.lte('created_at',f.to+'T23:59:59')
    if(f.q) q=q.or(`order_number.ilike.%${f.q}%,customer_name.ilike.%${f.q}%,customer_email.ilike.%${f.q}%,customer_phone.ilike.%${f.q}%`)

    const {data,error}=await q

    if(error) alert(error.message)
    setOrders(data||[])
  }

  async function sync(){
    setMsg('正在同步...')

    const r=await fetch('/api/sync-orders')
    const j=await r.json().catch(()=>({}))

    setMsg(j.ok ? `同步完成：新增/更新 ${j.upserted||0} 个订单` : (j.error || '同步失败'))
    loadOrders()
  }

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

        <input type="date" value={f.from} onChange={e=>setF({...f,from:e.target.value})}/>
        <input type="date" value={f.to} onChange={e=>setF({...f,to:e.target.value})}/>

        <button className="primary" onClick={loadOrders}>筛选</button>
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
              <th>最后处理</th>
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
                <td><b>{o.internal_status}</b></td>
                <td>
                  {getPendingLabel(o) ? (
                    <span style={getPendingStyle(o)}>
                      {getPendingLabel(o)}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>
                <td>{o.profiles?.name || o.profiles?.email || '-'}</td>
                <td>{new Date(o.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
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