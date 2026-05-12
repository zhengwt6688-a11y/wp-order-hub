# WordPress/WooCommerce 多站订单管理系统 MVP

功能：多网站订单同步、员工查看全部订单、按网站/状态/日期/订单筛选、修改内部状态、添加备注、管理员查看日志和管理网站 API。

## 1. Supabase 建库

1. 新建 Supabase 项目
2. 打开 SQL Editor
3. 复制 `supabase/schema.sql` 全部执行
4. 在 Authentication 里创建你的管理员账号
5. 在 SQL Editor 执行，把你的账号改成 admin：

```sql
update profiles set role='admin', name='Admin' where email='你的登录邮箱';
```

## 2. 本地环境变量

复制 `.env.example` 为 `.env.local`：

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=你的 anon publishable key
SUPABASE_SERVICE_ROLE_KEY=你的 service role secret key
```

注意：`SUPABASE_SERVICE_ROLE_KEY` 只放在 Vercel 环境变量里，不要暴露给别人。

## 3. 本地运行

```bash
npm install
npm run dev
```

## 4. 添加网站

登录系统 → 网站管理 → 添加：

- 网站名称
- 网站 URL，例如 `https://notablevape.com`
- WooCommerce Consumer Key
- WooCommerce Consumer Secret

WooCommerce Key 创建位置：WordPress 后台 → WooCommerce → Settings → Advanced → REST API。
权限建议选择 Read。

## 5. 同步订单

订单页点击“同步订单”。
部署到 Vercel 后，系统会按 `vercel.json` 每 10 分钟自动同步一次。

## 6. Vercel 部署

把项目上传 GitHub，然后 Vercel 导入项目。
在 Vercel Project Settings → Environment Variables 添加：

```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

然后重新 Deploy。

## 7. 第一版状态

- 待处理
- 处理中
- 缺货待处理
- 客户待回复
- 已发货
- 已退款
- 已取消
- 已完成
- 异常订单
