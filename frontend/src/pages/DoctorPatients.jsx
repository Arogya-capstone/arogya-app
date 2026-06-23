import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { apptApi } from '../api/axios'

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

export default function DoctorPatients() {
  const [patients, setPatients] = useState([])   // [{ patient_id, lastVisit, appointmentCount }]
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apptApi.get('/appointments')
        const appts = res.data

        // Deduplicate by patient_id, track last visit + count
        const map = {}
        for (const a of appts) {
          const pid = a.patient_id
          if (!map[pid]) {
            map[pid] = { patient_id: pid, lastVisit: a.datetime, count: 0, statuses: [] }
          }
          map[pid].count++
          map[pid].statuses.push(a.status)
          if (new Date(a.datetime) > new Date(map[pid].lastVisit)) {
            map[pid].lastVisit = a.datetime
          }
        }

        setPatients(Object.values(map).sort((a, b) =>
          new Date(b.lastVisit) - new Date(a.lastVisit)
        ))
      } catch (err) {
        setError('Failed to load patients.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const shortId = id => id?.slice(0, 8).toUpperCase()

  const lastStatus = (statuses) => {
    if (statuses.includes('completed')) return { label: 'Completed', cls: 'badge-confirmed' }
    if (statuses.includes('confirmed')) return { label: 'Confirmed', cls: 'badge-confirmed' }
    return { label: 'Pending', cls: 'badge-pending' }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content">
        <div className="page-header">
          <h2>My Patients</h2>
          <p>Click a patient to view their full medical history and AI assistant</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
            <div className="spinner" style={{ margin: '0 auto' }}></div>
          </div>
        ) : patients.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              <h3>No patients yet</h3>
              <p>Patients will appear here once appointments are created.</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {patients.map(p => {
              const st = lastStatus(p.statuses)
              return (
                <div
                  key={p.patient_id}
                  className="doc-item"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/patients/${p.patient_id}`)}
                >
                  <div className="doc-item-info">
                    <div className="stat-icon cyan" style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }}>
                      <UserIcon />
                    </div>
                    <div>
                      <div className="doc-item-name">Patient #{shortId(p.patient_id)}</div>
                      <div className="doc-item-date">
                        {p.count} appointment{p.count !== 1 ? 's' : ''} · Last visit{' '}
                        {new Date(p.lastVisit).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short', year: 'numeric'
                        })}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                    <ChevronRight />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
