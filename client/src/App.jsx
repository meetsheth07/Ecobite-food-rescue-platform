import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BadgeCheck, Bike, Boxes,
  Building2, Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, Compass,
  Leaf, LogOut, MapPin, Menu, PackageCheck, PackagePlus, Pause, Play,
  ShieldCheck, Sparkles, Truck, Users, Utensils, X,
} from 'lucide-react'
import {
  Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
} from 'recharts'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip as MapTooltip } from 'react-leaflet'
import L from 'leaflet'
import api, { getApiError } from './api'
import { useSession } from './store'

const roles = {
  donor: { label: 'Food donor', plural: 'Donor portal', icon: Building2 },
  receiver: { label: 'Relief organization', plural: 'NGO portal', icon: HeartIcon },
  volunteer: { label: 'Volunteer driver', plural: 'Volunteer portal', icon: Bike },
  admin: { label: 'Platform admin', plural: 'Operations', icon: ShieldCheck },
}

function HeartIcon(props) {
  return <Leaf {...props} />
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(100),
  organization: z.string().trim().max(120),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(128),
  role: z.enum(['donor', 'receiver', 'volunteer']),
  phone: z.string().trim().max(30),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  capacityMeals: z.coerce.number().int().min(0).max(1000000),
  serviceRadiusKm: z.coerce.number().min(1).max(100),
})

const listingSchema = z.object({
  title: z.string().trim().min(3, 'Add a clear food title.').max(120),
  description: z.string().trim().max(500),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least one.').max(100000),
  unit: z.enum(['meals', 'kg']),
  foodType: z.enum(['cooked', 'raw', 'packaged']),
  preparedAt: z.string().min(1, 'Preparation time is required.'),
  expiresAt: z.string().min(1, 'Expiry time is required.'),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  temperatureControlled: z.boolean(),
  allergens: z.array(z.string()),
  liabilityWaiver: z.literal(true, { errorMap: () => ({ message: 'Confirm the food safety declaration to continue.' }) }),
}).superRefine((values, context) => {
  const prepared = new Date(values.preparedAt).getTime()
  const expiry = new Date(values.expiresAt).getTime()
  const now = Date.now()
  if (prepared > now) context.addIssue({ code: z.ZodIssueCode.custom, path: ['preparedAt'], message: 'Preparation time cannot be in the future.' })
  if (expiry <= now) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'The food must not be expired.' })
  if (expiry - prepared < 2 * 60 * 60 * 1000 || expiry - prepared > 4 * 60 * 60 * 1000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Safe-consumption window must be 2–4 hours after preparation.' })
  }
})

function localDateTime(offsetHours) {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function ExpiryTimer({ expiresAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const remaining = new Date(expiresAt).getTime() - now
  if (remaining <= 0) return <span className="font-bold text-rose-600">Expired</span>
  const hours = Math.floor(remaining / 3600000)
  const minutes = Math.floor((remaining % 3600000) / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  return <span className="font-bold text-amber-700">{hours ? `${hours}h ` : ''}{minutes}m {seconds.toString().padStart(2, '0')}s left</span>
}

function distanceLabel(km) {
  return typeof km === 'number' ? `${km.toFixed(1)} km away` : null
}

function userPoint(user) {
  const coords = user?.location?.coordinates
  return coords?.length === 2 ? [coords[1], coords[0]] : null
}

function App() {
  const user = useSession((state) => state.user)
  const setUser = useSession((state) => state.setUser)
  const hydrated = useSession((state) => state.hydrated)

  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => setUser(null))
  }, [setUser])

  if (!hydrated) return <div className="grid min-h-screen place-items-center text-forest-700"><Leaf className="animate-pulse" size={32} /></div>

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/portal" replace /> : <AuthScreen />} />
      <Route path="/register" element={user ? <Navigate to="/portal" replace /> : <AuthScreen initialRegister />} />
      <Route element={user ? <PortalLayout /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<Navigate to="/portal" replace />} />
        <Route path="/portal" element={<PortalHome />} />
        <Route path="/impact" element={user?.role === 'donor' ? <ImpactPage /> : <Navigate to="/portal" replace />} />
        <Route path="/routes" element={user?.role === 'volunteer' || user?.role === 'receiver' ? <RoutesPage /> : <Navigate to="/portal" replace />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/portal' : '/login'} replace />} />
    </Routes>
  )
}

function AuthScreen({ initialRegister = false }) {
  const [registering, setRegistering] = useState(initialRegister)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setUser = useSession((state) => state.setUser)
  const navigate = useNavigate()
  const form = useForm({
    resolver: zodResolver(registering ? registerSchema : loginSchema),
    defaultValues: {
      name: '', organization: '', email: '', password: '', role: 'donor', phone: '',
      lat: 12.9716, lng: 77.5946, capacityMeals: 250, serviceRadiusKm: 10,
    },
  })
  const role = form.watch('role')

  async function submit(values) {
    setLoading(true)
    setError('')
    try {
      const payload = registering
        ? {
            ...values,
            location: { lat: Number(values.lat), lng: Number(values.lng) },
            capacityMeals: Number(values.capacityMeals),
            serviceRadiusKm: Number(values.serviceRadiusKm),
          }
        : values
      const { data } = await api.post(registering ? '/auth/register' : '/auth/login', payload)
      setUser(data.user)
      navigate('/portal', { replace: true })
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  function useDemo(email) {
    setRegistering(false)
    form.reset({ email, password: 'EcoBite123!' })
  }

  const field = (name, label, options = {}) => (
    <label className="block" key={name}>
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      <input
        {...form.register(name, options)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-forest-500 focus:ring-4 focus:ring-forest-50"
        type={options.type || 'text'}
        placeholder={options.placeholder || ''}
        autoComplete={options.autoComplete}
      />
      {form.formState.errors[name] && <span className="mt-1 block text-xs text-rose-600">{form.formState.errors[name].message}</span>}
    </label>
  )

  return (
    <main className="min-h-screen bg-[#f7f8f5] lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-forest-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-40 -top-40 h-[550px] w-[550px] rounded-full border border-white/10" />
        <div className="absolute -bottom-64 -left-40 h-[600px] w-[600px] rounded-full border border-white/10" />
        <Link to="/" className="relative z-10 flex items-center gap-3 text-lg font-extrabold tracking-tight"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#c6eb86] text-forest-900"><Leaf size={21} /></span>ecobite</Link>
        <div className="relative z-10 max-w-xl py-16">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-forest-100"><Sparkles size={14} /> A better end for good food</span>
          <h1 className="font-display text-5xl font-bold leading-[1.12] tracking-tight">Rescue more.<br /><span className="text-[#c6eb86]">Waste less.</span><br />Move together.</h1>
          <p className="mt-6 max-w-md text-base leading-7 text-forest-100/80">One shared network turning surplus meals into timely nourishment for local communities.</p>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-sm text-forest-100/80"><div className="flex -space-x-2"><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-forest-900 bg-[#e9b885] text-[10px] font-bold text-forest-900">M</span><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-forest-900 bg-[#b9d7a1] text-[10px] font-bold text-forest-900">A</span><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-forest-900 bg-[#e9d994] text-[10px] font-bold text-forest-900">R</span></div><span>Local food relief, coordinated in real time.</span></div>
      </section>

      <section className="flex min-h-screen items-center justify-center p-5 py-12 sm:p-10">
        <div className="w-full max-w-[440px]">
          <Link to="/" className="mb-10 flex items-center gap-2 text-lg font-extrabold tracking-tight text-forest-900 lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-xl bg-forest-100"><Leaf size={19} /></span>ecobite</Link>
          <p className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-forest-600">{registering ? 'Get started' : 'Welcome back'}</p>
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink">{registering ? 'Join the food rescue network' : 'Good to see you again.'}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{registering ? 'Create your organization account and find your place in the loop.' : 'Sign in to keep good food moving to the people who need it.'}</p>

          {error && <div role="alert" className="mt-5 flex gap-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700"><CircleHelp size={17} className="mt-0.5 shrink-0" />{error}</div>}
          <form className="mt-7 space-y-4" onSubmit={form.handleSubmit(submit)}>
            {registering && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {field('name', 'Your name', { placeholder: 'Alex Morgan' })}
                  {field('organization', 'Organization', { placeholder: 'Optional' })}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-600">I am joining as</span>
                  <select {...form.register('role')} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-forest-500">
                    <option value="donor">Food donor</option>
                    <option value="receiver">Relief organization</option>
                    <option value="volunteer">Volunteer driver</option>
                  </select>
                </label>
                {field('phone', 'Phone number', { placeholder: '+91 98765 43210', autoComplete: 'tel' })}
                {role === 'receiver' && field('capacityMeals', 'Acceptance capacity (meals)', { type: 'number' })}
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-slate-600">Service location · Bengaluru default</span>
                  <div className="grid grid-cols-2 gap-3">
                    {field('lat', 'Latitude', { type: 'number', step: 'any' })}
                    {field('lng', 'Longitude', { type: 'number', step: 'any' })}
                  </div>
                </div>
              </>
            )}
            {field('email', 'Email address', { placeholder: 'you@organization.org', type: 'email', autoComplete: 'email' })}
            {field('password', 'Password', { placeholder: registering ? 'At least 8 characters' : 'Enter your password', type: 'password', autoComplete: registering ? 'new-password' : 'current-password' })}
            {registering && role === 'receiver' && <p className="-mt-2 text-xs leading-5 text-amber-700">New relief organizations are verified by EcoBite before they can claim food.</p>}
            <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest-700 py-3.5 text-sm font-bold text-white shadow-lg shadow-forest-700/15 transition hover:bg-forest-900 disabled:cursor-wait disabled:opacity-60">
              {loading ? 'Please wait…' : registering ? 'Create account' : 'Sign in'} {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          {!registering && (
            <div className="mt-6 rounded-2xl border border-slate-200/80 bg-white/80 p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Explore a demo portal</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Donor', 'donor1@ecobite.org'],
                  ['NGO', 'ngo1@ecobite.org'],
                  ['Volunteer', 'volunteer1@ecobite.org'],
                  ['Admin', 'admin@ecobite.org'],
                ].map(([label, email]) => <button key={label} onClick={() => useDemo(email)} className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-forest-200 hover:bg-forest-50 hover:text-forest-700">{label}</button>)}
              </div>
              <p className="mt-2.5 text-center text-[11px] text-slate-400">Demo password: <span className="font-semibold">EcoBite123!</span></p>
            </div>
          )}
          <p className="mt-6 text-center text-sm text-slate-500">
            {registering ? 'Already part of the network?' : 'New to the network?'}{' '}
            <button type="button" className="font-bold text-forest-700 hover:text-forest-900" onClick={() => { setError(''); setRegistering(!registering); form.reset() }}>
              {registering ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
      </section>
    </main>
  )
}

function PortalLayout() {
  const user = useSession((state) => state.user)
  const clearUser = useSession((state) => state.clearUser)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pause, setPause] = useState(false)
  const navigate = useNavigate()
  const roleInfo = roles[user.role] || roles.donor
  const RoleIcon = roleInfo.icon
  const links = [
    { to: '/portal', label: user.role === 'receiver' ? 'Food nearby' : user.role === 'admin' ? 'Operations' : user.role === 'volunteer' ? 'Dispatch board' : 'Overview', icon: user.role === 'receiver' ? Compass : user.role === 'admin' ? Activity : user.role === 'volunteer' ? Truck : Boxes },
    ...(user.role === 'donor' ? [{ to: '/impact', label: 'Impact report', icon: Leaf }] : []),
    ...(user.role === 'volunteer' || user.role === 'receiver' ? [{ to: '/routes', label: user.role === 'receiver' ? 'My claims' : 'My routes', icon: MapPin }] : []),
  ]

  useEffect(() => {
    api.get('/system').then(({ data }) => setPause(data.emergencyPause)).catch(() => {})
  }, [])

  async function logout() {
    await api.post('/auth/logout').catch(() => {})
    clearUser()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#f7f8f5]">
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[258px] flex-col border-r border-slate-200/70 bg-white px-5 py-6 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Link to="/portal" className="flex items-center gap-3 px-2 text-lg font-extrabold tracking-tight text-forest-900"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-forest-100"><Leaf size={21} /></span>ecobite<span className="ml-auto rounded-md bg-forest-50 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider text-forest-700">Beta</span></Link>
        <div className="mt-9 rounded-2xl bg-[#f7f8f5] p-3.5">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-forest-700 shadow-sm"><RoleIcon size={18} /></span><div className="min-w-0"><p className="truncate text-xs font-bold text-ink">{user.organization || user.name}</p><p className="mt-0.5 text-[11px] text-slate-500">{roleInfo.label}</p></div><ChevronDown size={15} className="ml-auto text-slate-400" /></div>
        </div>
        <p className="mb-2 mt-8 px-3 text-[10px] font-extrabold uppercase tracking-[.16em] text-slate-400">Workspace</p>
        <nav className="space-y-1">
          {links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-forest-50 text-forest-800' : 'text-slate-500 hover:bg-slate-50 hover:text-ink'}`}><Icon size={17} strokeWidth={2} />{label}</NavLink>)}
        </nav>
        <div className="mt-auto">
          <div className="rounded-2xl bg-forest-900 p-4 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-[#c6eb86]"><Sparkles size={16} /></div>
            <p className="mt-3 text-sm font-bold">Every meal matters.</p>
            <p className="mt-1 text-xs leading-5 text-white/60">Your next action can make a real difference in your neighbourhood.</p>
          </div>
          <button onClick={logout} className="mt-5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 hover:text-rose-600"><LogOut size={17} />Sign out</button>
        </div>
      </aside>
      <div className="min-h-screen lg:pl-[258px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-slate-200/70 bg-[#f7f8f5]/90 px-5 backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <button aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg bg-white text-slate-600 shadow-sm lg:hidden"><Menu size={18} /></button>
            <div><p className="text-[11px] font-semibold text-slate-400">EcoBite network <span className="mx-1">/</span> <span className="text-slate-600">{roleInfo.plural}</span></p><p className="mt-0.5 text-sm font-bold text-ink">{greeting()}</p></div>
          </div>
          <div className="flex items-center gap-3">
            {pause && <span className="hidden items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 sm:inline-flex"><Pause size={13} />Platform paused</span>}
            <button aria-label="Help" title="Contact your EcoBite administrator for support" className="hidden h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 sm:grid"><CircleHelp size={17} /></button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e1efdf] text-xs font-extrabold text-forest-800">{user.name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
          </div>
        </header>
        {pause && <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs font-semibold text-amber-900 sm:px-8 lg:px-10"><Pause size={14} />New food listings and claims are temporarily paused by EcoBite operations.</div>}
        <main className="mx-auto max-w-[1480px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function PortalHome() {
  const user = useSession((state) => state.user)
  if (user.role === 'donor') return <DonorDashboard />
  if (user.role === 'receiver') return <ReceiverDashboard />
  if (user.role === 'volunteer') return <VolunteerDashboard />
  return <AdminDashboard />
}

function PageIntro({ eyebrow, title, description, action }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-[11px] font-extrabold uppercase tracking-[.17em] text-forest-600">{eyebrow}</p><h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p></div>{action}</div>
}

function MetricCard({ label, value, detail, icon: Icon, tint = 'green' }) {
  const tintClasses = {
    green: 'bg-forest-50 text-forest-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-sky-50 text-sky-700',
    purple: 'bg-violet-50 text-violet-700',
  }
  return <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card sm:p-5"><div className="flex items-start justify-between"><p className="text-sm font-semibold text-slate-500">{label}</p><span className={`grid h-9 w-9 place-items-center rounded-xl ${tintClasses[tint]}`}><Icon size={17} /></span></div><p className="mt-5 font-display text-3xl font-extrabold tracking-tight text-ink">{value}</p><p className="mt-1.5 text-xs text-slate-400">{detail}</p></div>
}

function SectionHeading({ title, detail, action }) {
  return <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-display text-lg font-extrabold text-ink">{title}</h2>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>{action}</div>
}

function DonorDashboard() {
  const user = useSession((state) => state.user)
  const [impact, setImpact] = useState(null)
  const [listings, setListings] = useState([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const form = useForm({
    resolver: zodResolver(listingSchema),
    defaultValues: {
      title: '', description: '', quantity: 80, unit: 'meals', foodType: 'cooked',
      preparedAt: localDateTime(-3), expiresAt: localDateTime(1),
      lat: user.location?.coordinates?.[1] ?? 12.9716,
      lng: user.location?.coordinates?.[0] ?? 77.5946,
      temperatureControlled: true, allergens: [], liabilityWaiver: false,
    },
  })
  const selectedAllergens = form.watch('allergens')

  async function refresh() {
    const [impactResponse, listingsResponse] = await Promise.all([api.get('/impact'), api.get('/listings/mine')])
    setImpact(impactResponse.data)
    setListings(listingsResponse.data.listings)
  }

  useEffect(() => { refresh().catch((requestError) => setError(getApiError(requestError))) }, [])

  async function submit(values) {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const { lat, lng, ...listingValues } = values
      const response = await api.post('/listings', {
        ...listingValues,
        quantity: Number(values.quantity),
        preparedAt: new Date(values.preparedAt).toISOString(),
        expiresAt: new Date(values.expiresAt).toISOString(),
        location: { lat: Number(lat), lng: Number(lng) },
      })
      setNotice(`Donation published and shared with ${response.data.nearbyReceivers.length} nearby verified organizations.`)
      form.reset({ ...form.getValues(), title: '', description: '', liabilityWaiver: false })
      await refresh()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  const toggleAllergen = (tag) => {
    const current = selectedAllergens || []
    form.setValue('allergens', current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag], { shouldValidate: true })
  }
  const fieldError = (name) => form.formState.errors[name]?.message

  return (
    <>
      <PageIntro eyebrow="Your donor workspace" title="Make surplus count." description="Share safe, fresh food with verified local organizations—and see the impact your team is creating." action={<Link to="/impact" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:border-forest-200 hover:text-forest-700">View impact <ArrowRight size={15} /></Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Meals rescued" value={(impact?.mealsSaved || 0).toLocaleString()} detail="Across your EcoBite donations" icon={Utensils} />
        <MetricCard label="Active donations" value={impact?.activeDonations ?? '—'} detail="Available for nearby partners" icon={Boxes} tint="amber" />
        <MetricCard label="CO₂ avoided" value={`${impact?.co2Kg ?? 0} kg`} detail="Estimated from meals redistributed" icon={Leaf} tint="blue" />
        <MetricCard label="Food in circulation" value={(impact?.activeMeals || 0).toLocaleString()} detail="Meals ready to be matched" icon={Activity} tint="purple" />
      </div>

      {(notice || error) && <AlertBanner type={error ? 'error' : 'success'} message={error || notice} onClose={() => { setError(''); setNotice('') }} />}

      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)]">
        <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card sm:p-6">
          <SectionHeading title="List a food donation" detail="Every listing includes a safe-consumption window and handling declaration." />
          <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Food title" error={fieldError('title')}><input {...form.register('title')} className="input" placeholder="e.g. Fresh vegetable pulao" /></FormField>
              <FormField label="Food type"><select {...form.register('foodType')} className="input"><option value="cooked">Cooked</option><option value="raw">Raw produce</option><option value="packaged">Packaged</option></select></FormField>
              <FormField label="Quantity"><div className="flex gap-2"><input {...form.register('quantity')} type="number" min="1" className="input min-w-0" /><select {...form.register('unit')} className="input w-28 shrink-0"><option value="meals">meals</option><option value="kg">kg</option></select></div>{fieldError('quantity') && <FieldError>{fieldError('quantity')}</FieldError>}</FormField>
              <FormField label="Description (optional)"><input {...form.register('description')} className="input" placeholder="Packing or pickup notes" /></FormField>
              <FormField label="Prepared at" error={fieldError('preparedAt')}><input {...form.register('preparedAt')} className="input" type="datetime-local" /></FormField>
              <FormField label="Safe until" error={fieldError('expiresAt')}><input {...form.register('expiresAt')} className="input" type="datetime-local" /></FormField>
              <FormField label="Pickup latitude"><input {...form.register('lat')} className="input" type="number" step="any" /></FormField>
              <FormField label="Pickup longitude"><input {...form.register('lng')} className="input" type="number" step="any" /></FormField>
            </div>
            <div className="rounded-xl bg-[#f7f8f5] p-4">
              <p className="mb-2 text-xs font-bold text-slate-700">Food handling details</p>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600"><input type="checkbox" {...form.register('temperatureControlled')} className="h-4 w-4 accent-forest-700" />Kept under temperature control</label>
              <p className="mb-2 mt-4 text-xs font-semibold text-slate-500">Dietary and allergen tags</p>
              <div className="flex flex-wrap gap-2">
                {['Vegan', 'Halal', 'Jain', 'Nut-free'].map((tag) => <button type="button" onClick={() => toggleAllergen(tag)} key={tag} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selectedAllergens?.includes(tag) ? 'border-forest-300 bg-forest-100 text-forest-800' : 'border-slate-200 bg-white text-slate-500 hover:border-forest-200'}`}>{selectedAllergens?.includes(tag) && <Check size={12} className="mr-1 inline" />}{tag}</button>)}
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5">
              <input type="checkbox" {...form.register('liabilityWaiver')} className="mt-0.5 h-4 w-4 accent-forest-700" />
              <span className="text-xs leading-5 text-slate-600">I confirm this food was handled safely, the details are accurate, and it is suitable for redistribution before the stated expiry time.</span>
            </label>
            {fieldError('liabilityWaiver') && <FieldError>{fieldError('liabilityWaiver')}</FieldError>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><ShieldCheck size={14} className="text-forest-600" />Safe-consumption window: 2–4 hours</p>
              <button disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-forest-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-forest-900 disabled:opacity-60">{loading ? 'Publishing…' : 'Publish donation'} <ArrowRight size={15} /></button>
            </div>
          </form>
        </section>
        <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card sm:p-6">
          <SectionHeading title="Recent donations" detail="Your food listings and their current status." />
          <div className="space-y-3">
            {listings.length === 0 && <EmptyState icon={PackagePlus} title="Your first rescue starts here" text="Publish a safe surplus listing and nearby verified partners can claim it." />}
            {listings.slice(0, 6).map((listing) => <ListingRow key={listing._id} listing={listing} />)}
          </div>
          {listings.length > 6 && <p className="mt-4 text-center text-xs text-slate-400">Showing your 6 most recent of {listings.length} donations.</p>}
        </section>
      </div>
    </>
  )
}

function FormField({ label, error, children }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}{error && <FieldError>{error}</FieldError>}</label>
}
function FieldError({ children }) { return <span className="mt-1.5 block text-xs text-rose-600">{children}</span> }

function ListingRow({ listing }) {
  const tone = listing.status === 'available' ? 'bg-emerald-50 text-emerald-700' : listing.status === 'claimed' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'
  return <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3.5">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest-700"><Utensils size={17} /></span>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{listing.title}</p><p className="mt-1 text-xs text-slate-500">{listing.quantity} {listing.unit} <span className="mx-1 text-slate-300">·</span> {listing.status === 'available' ? <ExpiryTimer expiresAt={listing.expiresAt} /> : <>until {formatDate(listing.expiresAt)}</>}</p></div>
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${tone}`}>{listing.status}</span>
  </div>
}

function ReceiverDashboard() {
  const user = useSession((state) => state.user)
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [matches, setMatches] = useState([])

  async function refresh() {
    const [feedResponse, matchesResponse] = await Promise.all([
      api.get('/listings/nearby'),
      api.get('/matches/mine'),
    ])
    setListings(feedResponse.data.listings)
    setMatches(matchesResponse.data.matches)
  }

  useEffect(() => { refresh().catch((requestError) => setError(getApiError(requestError))).finally(() => setLoading(false)) }, [])

  async function claim(listing) {
    setBusy(listing._id)
    setError('')
    setNotice('')
    try {
      await api.post('/matches/claim', { listingId: listing._id })
      setNotice(`${listing.title} is reserved for ${user.organization || 'your organization'}. A volunteer dispatch alert has been sent.`)
      await refresh()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy('')
    }
  }

  if (!user.verified) return <UnverifiedNotice />
  const freeCapacity = Math.max(0, (user.capacityMeals || 0) - (user.reservedMeals || 0))

  return <>
    <PageIntro eyebrow="Verified relief partner" title="Food, close to home." description="Browse fresh surplus matched to your capacity, within a 10 km service radius." action={<span className="inline-flex items-center gap-2 rounded-full bg-forest-50 px-3 py-2 text-xs font-bold text-forest-700"><MapPin size={14} />10 km matching radius</span>} />
    {(error || notice) && <AlertBanner type={error ? 'error' : 'success'} message={error || notice} onClose={() => { setError(''); setNotice('') }} />}
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <MetricCard label="Available meals" value={listings.reduce((total, listing) => total + (listing.unit === 'meals' ? listing.availableQuantity : listing.availableQuantity * 2), 0).toLocaleString()} detail="Matched to your service area" icon={Utensils} />
      <MetricCard label="Remaining capacity" value={freeCapacity.toLocaleString()} detail="Meals your organization can accept" icon={Boxes} tint="blue" />
      <MetricCard label="Active claims" value={matches.filter((match) => match.status !== 'delivered').length} detail="Food being coordinated" icon={PackageCheck} tint="amber" />
    </div>
    <SectionHeading title="Nearby food" detail="Ranked by distance, safety window, and your organization’s capacity." />
    {loading ? <LoadingBlock /> : listings.length === 0 ? <EmptyState icon={Compass} title="No matching donations right now" text="We’ll show food as soon as a nearby donor publishes a suitable listing." /> : (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {listings.map((listing) => <article key={listing._id} className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-card">
          <div className="flex items-center justify-between bg-forest-50/80 px-5 py-3"><span className="inline-flex items-center gap-1.5 text-xs font-bold text-forest-800"><MapPin size={14} />{distanceLabel(listing.distanceKm)}</span><span className="text-[11px] font-semibold capitalize text-slate-500">{listing.foodType}</span></div>
          <div className="p-5"><div className="flex items-start justify-between gap-3"><h3 className="font-display text-lg font-extrabold text-ink">{listing.title}</h3><span className="shrink-0 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800">{listing.quantity} {listing.unit}</span></div>
            <p className="mt-2 text-sm text-slate-500">{listing.description || 'Fresh surplus, prepared today.'}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{listing.allergens?.map((allergen) => <span key={allergen} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{allergen}</span>)}{listing.temperatureControlled && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">Temperature controlled</span>}</div>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs"><span className="text-slate-500">Donated by <b className="text-slate-700">{listing.donor?.organization || listing.donor?.name}</b></span><span className="inline-flex items-center gap-1"><Clock3 size={13} /><ExpiryTimer expiresAt={listing.expiresAt} /></span></div>
            <button onClick={() => claim(listing)} disabled={Boolean(busy) || (listing.mealEstimate || listing.quantity) > freeCapacity} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-forest-700 py-3 text-sm font-bold text-white transition hover:bg-forest-900 disabled:cursor-not-allowed disabled:bg-slate-300">{busy === listing._id ? 'Reserving…' : (listing.mealEstimate || listing.quantity) > freeCapacity ? 'Capacity reached' : 'Reserve this donation'} {!busy && <ArrowRight size={15} />}</button>
          </div>
        </article>)}
      </div>
    )}
  </>
}

function UnverifiedNotice() {
  const user = useSession((state) => state.user)
  const rejected = user.verificationStatus === 'rejected'
  return <div className="mx-auto max-w-2xl rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-card"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700"><Clock3 size={25} /></span><p className="mt-5 text-xs font-bold uppercase tracking-[.16em] text-amber-700">{rejected ? 'Verification decision' : 'Verification in progress'}</p><h1 className="mt-2 font-display text-2xl font-extrabold text-ink">{rejected ? 'Your organization was not approved.' : 'We’re reviewing your organization.'}</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">{rejected ? 'Contact EcoBite operations if you would like to learn more or request another review.' : 'EcoBite operations will verify your details before enabling food claims. You can sign in again once your account is approved.'}</p></div>
}

function VolunteerDashboard() {
  const [available, setAvailable] = useState([])
  const [myRoutes, setMyRoutes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState(null)

  async function refresh() {
    const [availableResponse, mineResponse] = await Promise.all([api.get('/volunteer/available'), api.get('/matches/mine')])
    setAvailable(availableResponse.data.matches)
    setMyRoutes(mineResponse.data.matches)
    if (selected) setSelected(mineResponse.data.matches.find((match) => match._id === selected._id) || null)
  }
  useEffect(() => { refresh().catch((requestError) => setError(getApiError(requestError))) }, [])

  async function assign(match) {
    setBusy(match._id)
    setError('')
    try {
      await api.post(`/volunteer/${match._id}/assign`, {})
      setSelected(match)
      await refresh()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy('')
    }
  }

  async function updateStatus(match, status) {
    setBusy(match._id)
    setError('')
    try {
      await api.patch(`/matches/${match._id}/status`, { status })
      await refresh()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy('')
    }
  }

  const currentRoute = selected || myRoutes.find((match) => match.status !== 'delivered') || null
  return <>
    <PageIntro eyebrow="Volunteer dispatch" title="Good food is going places." description="Choose an unassigned pickup, follow the donor-to-organization route, and keep everyone updated." action={<span className="inline-flex items-center gap-2 rounded-full bg-forest-50 px-3 py-2 text-xs font-bold text-forest-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Available for dispatch</span>} />
    {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(320px,.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card">
        <SectionHeading title="Open pickups" detail={`${available.length} donation${available.length === 1 ? '' : 's'} waiting for a driver`} />
        {available.length === 0 && <EmptyState icon={Bike} title="All caught up" text="New pickup opportunities will appear here after a nearby NGO claims a donation." />}
        <div className="space-y-3">
          {available.map((match) => <div key={match._id} className="rounded-xl border border-slate-100 p-4">
            <div className="flex items-center justify-between gap-2"><p className="font-bold text-ink">{match.listing?.title}</p><span className="text-xs font-bold text-forest-700">{match.meals} meals</span></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">Pickup: {match.donor?.organization || match.donor?.name}<br />Drop-off: {match.receiver?.organization || match.receiver?.name}</p>
            <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-700"><Clock3 size={13} />Safe until {formatDate(match.listing?.expiresAt)}</p>
            <button onClick={() => assign(match)} disabled={Boolean(busy)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-forest-700 py-2.5 text-xs font-bold text-white hover:bg-forest-900 disabled:opacity-60">{busy === match._id ? 'Assigning…' : 'Accept pickup'} <ArrowRight size={14} /></button>
          </div>)}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card sm:p-6">
        <SectionHeading title="Route view" detail={currentRoute ? `${currentRoute.listing?.title} · ${currentRoute.meals} meals` : 'Pickup and delivery routes appear here.'} />
        <RouteMap match={currentRoute} />
        {currentRoute && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f8f5] p-4">
          <div><p className="text-xs font-bold text-ink">{currentRoute.donor?.organization || currentRoute.donor?.name} <ArrowRight size={12} className="mx-1 inline text-forest-600" /> {currentRoute.receiver?.organization || currentRoute.receiver?.name}</p><p className="mt-1 text-[11px] text-slate-500">Safe until <ExpiryTimer expiresAt={currentRoute.listing?.expiresAt} /></p></div>
          <div className="flex gap-2">
            {currentRoute.status === 'claimed' && <button onClick={() => updateStatus(currentRoute, 'picked_up')} disabled={Boolean(busy)} className="rounded-lg bg-forest-700 px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-50">{busy === currentRoute._id ? 'Saving…' : 'Mark picked up'}</button>}
            {currentRoute.status === 'picked_up' && <button onClick={() => updateStatus(currentRoute, 'delivered')} disabled={Boolean(busy)} className="rounded-lg bg-forest-700 px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-50">{busy === currentRoute._id ? 'Saving…' : 'Confirm delivery'}</button>}
            {currentRoute.status === 'delivered' && <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} />Delivered</span>}
          </div>
        </div>}
        {currentRoute && <DisputeReporter matchId={currentRoute._id} />}
        {myRoutes.length > 0 && <div className="mt-6"><SectionHeading title="My active routes" detail="Pick a route to view its details." /><div className="space-y-2">{myRoutes.map((match) => <button key={match._id} onClick={() => setSelected(match)} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${currentRoute?._id === match._id ? 'border-forest-200 bg-forest-50/60' : 'border-slate-100 hover:bg-slate-50'}`}><span className="min-w-0"><span className="block truncate text-xs font-bold text-ink">{match.listing?.title}</span><span className="mt-1 block text-[11px] text-slate-500">{match.receiver?.organization || match.receiver?.name}</span></span><RouteStatus status={match.status} /></button>)}</div></div>}
      </section>
    </div>
  </>
}

function RoutesPage() {
  const user = useSession((state) => state.user)
  return user.role === 'receiver' ? <ReceiverClaims /> : <VolunteerDashboard />
}

function ReceiverClaims() {
  const [matches, setMatches] = useState([])
  const [error, setError] = useState('')
  useEffect(() => { api.get('/matches/mine').then(({ data }) => setMatches(data.matches)).catch((requestError) => setError(getApiError(requestError))) }, [])
  return <>
    <PageIntro eyebrow="Relief partner" title="Your claimed food." description="Track your organization’s active claims and volunteer delivery progress." />
    {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}
    {matches.length === 0 ? <EmptyState icon={PackageCheck} title="No food claimed yet" text="Donations you reserve from the nearby feed will show up here." /> : <div className="grid gap-5 lg:grid-cols-2">
      {matches.map((match) => <div key={match._id} className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-extrabold text-ink">{match.listing?.title}</h2><RouteStatus status={match.status} /></div><p className="mt-2 text-sm text-slate-500">{match.meals} meals from {match.donor?.organization || match.donor?.name}</p><p className="mt-2 text-xs text-slate-500">Volunteer: {match.volunteer?.name || 'Looking for a driver'} · Safe until <ExpiryTimer expiresAt={match.listing?.expiresAt} /></p><div className="mt-4"><RouteMap match={match} /></div><DisputeReporter matchId={match._id} /></div>)}
    </div>}
  </>
}

function DisputeReporter({ matchId }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('delivery')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await api.post('/disputes', { matchId, reason, description })
      setMessage('Your report was sent to EcoBite operations.')
      setOpen(false)
      setDescription('')
    } catch (requestError) {
      setMessage(getApiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  return <div className="mt-3">
    {!open && <button onClick={() => { setOpen(true); setMessage('') }} className="text-xs font-bold text-slate-500 hover:text-forest-700">Report a route issue</button>}
    {message && <p role="status" className="mb-2 text-xs text-forest-700">{message}</p>}
    {open && <form onSubmit={submit} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between"><p className="text-xs font-bold text-ink">Report an issue</p><button type="button" onClick={() => setOpen(false)} aria-label="Close report form"><X size={14} /></button></div>
      <select value={reason} onChange={(event) => setReason(event.target.value)} className="input !py-2 text-xs">
        <option value="delivery">Delivery delay or issue</option><option value="food-safety">Food safety concern</option><option value="quantity">Quantity mismatch</option><option value="conduct">Conduct concern</option><option value="other">Other</option>
      </select>
      <textarea required minLength={10} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} className="input min-h-[76px] resize-y !py-2 text-xs" placeholder="Describe what happened (at least 10 characters)." />
      <button disabled={busy} className="rounded-lg bg-forest-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send report'}</button>
    </form>}
  </div>
}

function RouteMap({ match }) {
  const donorPoint = userPoint(match?.donor)
  const receiverPoint = userPoint(match?.receiver)
  const center = donorPoint && receiverPoint
    ? [(donorPoint[0] + receiverPoint[0]) / 2, (donorPoint[1] + receiverPoint[1]) / 2]
    : donorPoint || receiverPoint || [12.9716, 77.5946]
  const points = donorPoint && receiverPoint ? [donorPoint, receiverPoint] : []
  const donorIcon = useMemo(() => L.divIcon({ className: '', html: '<div style="width:30px;height:30px;border:3px solid white;border-radius:50%;background:#378754;box-shadow:0 2px 9px #0003;display:grid;place-items:center;color:white;font-size:13px;font-weight:800">D</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), [])
  const receiverIcon = useMemo(() => L.divIcon({ className: '', html: '<div style="width:30px;height:30px;border:3px solid white;border-radius:50%;background:#e8a547;box-shadow:0 2px 9px #0003;display:grid;place-items:center;color:white;font-size:13px;font-weight:800">N</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), [])
  return <div className="map-wrap overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100">
    <MapContainer center={center} zoom={12} scrollWheelZoom={false}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {donorPoint && <Marker position={donorPoint} icon={donorIcon}><MapTooltip direction="top">{match?.donor?.organization || 'Food donor'}</MapTooltip></Marker>}
      {receiverPoint && <Marker position={receiverPoint} icon={receiverIcon}><MapTooltip direction="top">{match?.receiver?.organization || 'Relief partner'}</MapTooltip></Marker>}
      {points.length > 1 && <Polyline positions={points} pathOptions={{ color: '#398454', weight: 4, dashArray: '8 8' }} />}
    </MapContainer>
  </div>
}

function AdminDashboard() {
  const [overview, setOverview] = useState(null)
  const [disputes, setDisputes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function refresh() {
    const [overviewResponse, disputeResponse] = await Promise.all([
      api.get('/admin/overview'),
      api.get('/admin/disputes'),
    ])
    setOverview(overviewResponse.data)
    setDisputes(disputeResponse.data.disputes)
  }
  useEffect(() => { refresh().catch((requestError) => setError(getApiError(requestError))) }, [])

  async function togglePause() {
    setBusy('pause')
    setError('')
    try {
      const { data } = await api.patch('/admin/system', { emergencyPause: !overview.emergencyPause })
      setOverview((current) => ({ ...current, emergencyPause: data.emergencyPause }))
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy('')
    }
  }

  async function verify(userId, verified) {
    setBusy(userId)
    setError('')
    try {
      await api.patch(`/admin/users/${userId}/verify`, { verified })
      await refresh()
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setBusy('')
    }
  }

  return <>
    <PageIntro eyebrow="Platform operations" title="Keep the network moving." description="Review relief partners, monitor active food logistics, and protect the platform during an incident." action={<button onClick={togglePause} disabled={busy === 'pause' || !overview} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:opacity-50 ${overview?.emergencyPause ? 'bg-forest-700 hover:bg-forest-900' : 'bg-rose-600 hover:bg-rose-700'}`}>{overview?.emergencyPause ? <Play size={15} /> : <Pause size={15} />}{busy === 'pause' ? 'Updating…' : overview?.emergencyPause ? 'Resume platform' : 'Emergency pause'}</button>} />
    {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}
    {overview?.emergencyPause && <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">Emergency pause is active. New donor listings and NGO claims are blocked.</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Food donors" value={overview?.donors ?? '—'} detail="Commercial partners" icon={Building2} />
      <MetricCard label="NGOs to review" value={overview?.pendingReceivers?.length ?? '—'} detail="Verification requests" icon={Users} tint="amber" />
      <MetricCard label="Volunteer drivers" value={overview?.volunteers ?? '—'} detail="Available in the network" icon={Bike} tint="blue" />
      <MetricCard label="Open disputes" value={overview?.openDisputes ?? '—'} detail={`${overview?.activeClaims ?? '—'} active claims`} icon={Truck} tint="purple" />
    </div>
    <section className="mt-7 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card sm:p-6">
      <SectionHeading title="NGO verification queue" detail="Approving an organization enables it to receive proximity matches and claim donations." />
      {overview?.pendingReceivers?.length === 0 && <EmptyState icon={BadgeCheck} title="All clear" text="There are no new organizations waiting for review." />}
      <div className="divide-y divide-slate-100">
        {overview?.pendingReceivers?.map((receiver) => <div key={receiver._id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest-700"><Building2 size={18} /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{receiver.organization || receiver.name}</p><p className="mt-1 truncate text-xs text-slate-500">{receiver.name} · {receiver.email} · Applied {formatDate(receiver.createdAt)}</p></div>
          <div className="flex gap-2"><button onClick={() => verify(receiver._id, false)} disabled={Boolean(busy)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{busy === receiver._id ? 'Saving…' : 'Decline'}</button><button onClick={() => verify(receiver._id, true)} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg bg-forest-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-forest-900 disabled:opacity-50">{busy === receiver._id ? 'Saving…' : 'Verify'} <Check size={13} /></button></div>
        </div>)}
      </div>
    </section>
    <section className="mt-6 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card sm:p-6">
      <SectionHeading title="Dispute log" detail="Review reports raised by donors, relief organizations, and delivery volunteers." />
      {disputes.length === 0 && <EmptyState icon={ShieldCheck} title="No reports logged" text="Route and food safety reports will appear here for review." />}
      <div className="space-y-3">
        {disputes.map((dispute) => <AdminDisputeRow key={dispute._id} dispute={dispute} onResolved={refresh} onError={setError} busy={busy} setBusy={setBusy} />)}
      </div>
    </section>
  </>
}

function AdminDisputeRow({ dispute, onResolved, onError, busy, setBusy }) {
  const [resolution, setResolution] = useState('')
  async function resolve(event) {
    event.preventDefault()
    setBusy(dispute._id)
    onError('')
    try {
      await api.patch(`/admin/disputes/${dispute._id}/resolve`, { resolution })
      await onResolved()
    } catch (requestError) {
      onError(getApiError(requestError))
    } finally {
      setBusy('')
    }
  }
  return <article className="rounded-xl border border-slate-100 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><p className="text-sm font-bold capitalize text-ink">{dispute.reason.replace('-', ' ')}</p><p className="mt-1 text-xs text-slate-500">Reported by {dispute.createdBy?.organization || dispute.createdBy?.name} ({dispute.createdBy?.role}) · {formatDate(dispute.createdAt)}</p></div>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${dispute.status === 'open' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{dispute.status}</span>
    </div>
    <p className="mt-3 text-sm leading-6 text-slate-600">{dispute.description}</p>
    {dispute.status === 'open'
      ? <form onSubmit={resolve} className="mt-3 flex flex-col gap-2 sm:flex-row"><input required minLength={5} maxLength={1000} value={resolution} onChange={(event) => setResolution(event.target.value)} className="input min-w-0 flex-1 !py-2 text-xs" placeholder="Resolution notes (at least 5 characters)" /><button disabled={Boolean(busy)} className="rounded-lg bg-forest-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy === dispute._id ? 'Saving…' : 'Resolve'}</button></form>
      : <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><b>Resolution:</b> {dispute.resolution}</p>}
  </article>
}

function ImpactPage() {
  const [impact, setImpact] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  useEffect(() => { api.get('/impact').then(({ data }) => setImpact(data)).catch((requestError) => setError(getApiError(requestError))) }, [])
  const chartData = [
    { name: 'Meals redistributed', value: impact?.mealsSaved || 0, color: '#398454' },
    { name: 'Meals available', value: impact?.activeMeals || 0, color: '#dfeee0' },
  ]

  async function downloadReport() {
    setDownloading(true)
    setError('')
    try {
      const { data } = await api.get('/impact/report', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'ecobite-impact-report.pdf'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setError(getApiError(requestError))
    } finally {
      setDownloading(false)
    }
  }

  return <>
    <PageIntro eyebrow="Your impact" title="Good food. Measurable good." description="A transparent view of meals your team has rescued and the environmental impact of getting them to people." action={<button onClick={downloadReport} disabled={downloading} className="inline-flex items-center gap-2 rounded-xl bg-forest-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-forest-900 disabled:opacity-60">{downloading ? 'Preparing…' : 'Download CSR report'} <ArrowDownToLine size={15} /></button>} />
    {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Meals saved" value={(impact?.mealsSaved || 0).toLocaleString()} detail="Claimed for local redistribution" icon={Utensils} />
      <MetricCard label="CO₂ footprint avoided" value={`${impact?.co2Kg ?? 0} kg`} detail="Estimated at 2.5 kg per meal" icon={Leaf} tint="blue" />
      <MetricCard label="Active donations" value={impact?.activeDonations ?? '—'} detail="Currently matched to partners" icon={Boxes} tint="amber" />
      <MetricCard label="Meals available" value={(impact?.activeMeals || 0).toLocaleString()} detail="Food ready to find a home" icon={PackageCheck} tint="purple" />
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
      <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-card">
        <SectionHeading title="Meals in motion" detail="A snapshot of rescued meals and current surplus." />
        <div className="mt-3 h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={72} outerRadius={104} paddingAngle={3} stroke="none">{chartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip formatter={(value) => [`${Number(value).toLocaleString()} meals`, '']} /></PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-5 text-xs font-semibold text-slate-500"><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-forest-500" />Rescued</span><span><i className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#dfeee0]" />Available</span></div>
      </section>
      <section className="rounded-2xl border border-forest-100 bg-forest-900 p-6 text-white shadow-card sm:p-7">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-[#c6eb86]"><Sparkles size={20} /></span>
        <p className="mt-6 text-xs font-extrabold uppercase tracking-[.16em] text-[#c6eb86]">Your ripple effect</p>
        <h2 className="mt-2 font-display text-2xl font-extrabold">A rescued meal is more than a number.</h2>
        <p className="mt-3 text-sm leading-6 text-white/70">Every donation can reduce food waste, lower avoidable emissions, and help a local partner serve their community with dignity.</p>
        <div className="mt-7 grid grid-cols-2 gap-4 border-t border-white/15 pt-5"><div><p className="font-display text-2xl font-extrabold text-[#c6eb86]">{impact?.activeMatches ?? 0}</p><p className="mt-1 text-xs text-white/60">active handoffs</p></div><div><p className="font-display text-2xl font-extrabold text-[#c6eb86]">{impact?.activeDonations ?? 0}</p><p className="mt-1 text-xs text-white/60">available donations</p></div></div>
      </section>
    </div>
  </>
}

function RouteStatus({ status }) {
  const label = status === 'picked_up' ? 'Picked up' : status === 'delivered' ? 'Delivered' : 'Claimed'
  const color = status === 'delivered' ? 'bg-emerald-50 text-emerald-700' : status === 'picked_up' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${color}`}>{label}</span>
}

function EmptyState({ icon: Icon, title, text }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-forest-600 shadow-sm"><Icon size={21} /></span><h3 className="mt-4 text-sm font-bold text-ink">{title}</h3><p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-slate-500">{text}</p></div>
}

function LoadingBlock() {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl bg-white shadow-card" />)}</div>
}

function AlertBanner({ type, message, onClose }) {
  const isError = type === 'error'
  return <div role={isError ? 'alert' : 'status'} className={`my-5 flex items-start justify-between gap-3 rounded-xl border p-3.5 text-sm ${isError ? 'border-rose-100 bg-rose-50 text-rose-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}><span className="flex items-start gap-2"><span className="mt-0.5">{isError ? <CircleHelp size={16} /> : <CheckCircle2 size={16} />}</span>{message}</span><button onClick={onClose} aria-label="Dismiss message" className="opacity-60 hover:opacity-100"><X size={16} /></button></div>
}

export default App
