import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { userApi, apptApi, healthApi, documentApi } from '../api/axios'

function parseToken() {
  try {
    const token = localStorage.getItem('token')
    if (!token) return null
    return JSON.parse(atob(token.split('.')[1]))
  } catch { return null }
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}

function BotIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/>
      <path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="14" height="14">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

export default function Dashboard() {
  const [user, setUser]   = useState(null)
  const [stats, setStats] = useState({ appointments: 0, records: 0, documents: 0 })
  const tokenData = parseToken()
  const role = tokenData?.role || ''

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [userRes, apptRes, recRes, docRes] = await Promise.allSettled([
          userApi.get('/me'),
          apptApi.get('/appointments'),
          healthApi.get('/health-records'),
          documentApi.get('/documents'),
        ])
        if (userRes.status === 'fulfilled') setUser(userRes.value.data)
        setStats({
          appointments: apptRes.status === 'fulfilled' ? apptRes.value.data.length : 0,
          records:      recRes.status  === 'fulfilled' ? recRes.value.data.length  : 0,
          documents:    docRes.status  === 'fulfilled' ? docRes.value.data.length  : 0,
        })
      } catch (err) {
        console.error('Dashboard fetch error:', err)
      }
    }
    fetchData()
  }, [])

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content">
        {/* Header */}
        <div className="page-header">
          <h2>{greeting()}{user ? `, ${user.name.split(' ')[0]}` : ''}</h2>
          <p>Here is an overview of your healthcare dashboard</p>
        </div>

        {/* Stat cards */}
        <div className="card-grid" style={{ marginBottom: '28px' }}>
          <Link to="/appointments" className="stat-card stat-card-link">
            <div className="stat-icon purple">
              <CalendarIcon />
            </div>
            <div className="stat-info">
              <h3>{stats.appointments}</h3>
              <p>Appointments</p>
            </div>
          </Link>

          <Link to="/records" className="stat-card stat-card-link">
            <div className="stat-icon cyan">
              <HeartIcon />
            </div>
            <div className="stat-info">
              <h3>{stats.records}</h3>
              <p>Health Records</p>
            </div>
          </Link>

          <Link to="/documents" className="stat-card stat-card-link">
            <div className="stat-icon green">
              <FileIcon />
            </div>
            <div className="stat-info">
              <h3>{stats.documents}</h3>
              <p>Documents</p>
            </div>
          </Link>

          <div className="stat-card">
            <div className="stat-icon amber">
              <ShieldIcon />
            </div>
            <div className="stat-info">
              <h3 style={{ textTransform: 'capitalize', fontSize: '1.1rem' }}>{user?.role || '—'}</h3>
              <p>Account Role</p>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="card">
          <div className="section-header">
            <h3>Quick Actions</h3>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {role === 'patient' && (
              <Link to="/appointments" className="btn btn-primary btn-sm">
                <PlusIcon /> New Appointment
              </Link>
            )}
            {role === 'doctor' && (
              <Link to="/records" className="btn btn-primary btn-sm">
                <PlusIcon /> Add Health Record
              </Link>
            )}
            <Link to="/records" className="btn btn-secondary btn-sm">
              <HeartIcon /> View Records
            </Link>
            <Link to="/documents" className="btn btn-secondary btn-sm">
              <FileIcon /> Upload Document
            </Link>
            <Link to="/chatbot" className="btn btn-secondary btn-sm">
              <BotIcon /> AI Assistant
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
