import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ragApi } from '../api/axios'

// ── JWT role decode ─────────────────────────────────────────────────────────
function getUserRole() {
  try {
    const token = localStorage.getItem('token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.role || null
  } catch {
    return null
  }
}

// ── Icons ───────────────────────────────────────────────────────────────────
function ArogyaLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="10" fill="url(#logoGrad)"/>
      <path d="M16 7v18M7 16h18" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10b981"/>
          <stop offset="1" stopColor="#0891b2"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

function BookOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
    </svg>
  )
}

const PATIENT_NAV = [
  { to: '/dashboard',    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Dashboard' },
  { to: '/appointments', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', label: 'Appointments' },
  { to: '/records',      icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z', label: 'Health Records' },
  { to: '/documents',    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Documents' },
  { to: '/chatbot',      icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', label: 'AI Assistant' },
]

const DOCTOR_NAV = [
  { to: '/dashboard',    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Dashboard' },
  { to: '/appointments', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', label: 'Appointments' },
  { to: '/patients',     icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', label: 'My Patients' },
  { to: '/records',      icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z', label: 'Health Records' },
  { to: '/documents',    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Documents' },
]

// ── Doctor-only: floating literature chatbot ─────────────────────────────────
function LiteratureChatbot({ onClose }) {
  const [messages, setMessages] = useState([{
    role: 'bot',
    text: 'Ask me about any medical topic — I search PubMed\'s 35M+ papers and synthesize evidence-based answers with citations.',
    citations: [],
  }])
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { inputRef.current?.focus() }, [])

  const send = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const q = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: q, citations: [] }])
    setLoading(true)

    try {
      const { data } = await ragApi.post('/rag/query', { query: q, mode: 'literature' })
      setMessages(prev => [...prev, {
        role: 'bot',
        text: data.answer,
        citations: data.literature_citations || [],
      }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: 'PubMed search temporarily unavailable. Please try again.',
        citations: [],
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, width: 400, height: 520,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column',
      boxShadow: '0 24px 64px rgba(0,0,0,0.5)', zIndex: 9999,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(6,182,212,0.1))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #10b981, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BookOpenIcon />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              Literature Search
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>PubMed · 35M+ papers</div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: '18px', lineHeight: 1,
          padding: '4px 8px', borderRadius: 6,
        }}>×</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div style={{
              background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-elevated)',
              color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
              borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              padding: '9px 13px', fontSize: '0.82rem', lineHeight: 1.55,
              border: msg.role === 'bot' ? '1px solid var(--border)' : 'none',
            }}>
              {msg.text}
            </div>
            {msg.citations?.length > 0 && (
              <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)', paddingLeft: 4 }}>
                {msg.citations.slice(0, 3).map((c, j) => (
                  <div key={j}>
                    · <a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                      PMID {c.pmid}
                    </a> — {c.title?.slice(0, 60)}…
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: '14px 14px 14px 4px', padding: '10px 14px', display: 'flex', gap: 5 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: '50%',
                background: 'var(--primary)', animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }}/>
            ))}
          </div>
        )}
        <div ref={endRef}/>
      </div>

      {/* Input */}
      <form onSubmit={send} style={{
        padding: '10px 12px', borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8,
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Search medical literature..."
          disabled={loading}
          style={{
            flex: 1, padding: '9px 13px', background: 'var(--bg-input)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)', fontSize: '0.82rem',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
        <button type="submit" disabled={!input.trim() || loading}
          className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
          Search
        </button>
      </form>
    </div>
  )
}

// ── Navbar ───────────────────────────────────────────────────────────────────
export default function Navbar() {
  const navigate                         = useNavigate()
  const role                             = getUserRole()
  const [litOpen, setLitOpen]            = useState(false)
  const navItems                         = role === 'doctor' ? DOCTOR_NAV : PATIENT_NAV

  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/login')
  }

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <ArogyaLogo />
          <div>
            <h1>Arogya</h1>
            <span>Healthcare Platform</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon}/>
              </svg>
              {item.label}
            </NavLink>
          ))}

          {/* Doctor-only: literature search trigger */}
          {role === 'doctor' && (
            <button
              onClick={() => setLitOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                background: litOpen ? 'var(--primary-light)' : 'transparent',
                color: litOpen ? 'var(--primary)' : 'var(--text-secondary)',
                fontFamily: 'inherit', fontSize: '0.875rem', fontWeight: 500,
                transition: 'all 150ms ease',
              }}
            >
              <BookOpenIcon />
              Literature Search
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Literature chatbot panel (doctor only) */}
      {role === 'doctor' && litOpen && (
        <LiteratureChatbot onClose={() => setLitOpen(false)} />
      )}
    </>
  )
}
