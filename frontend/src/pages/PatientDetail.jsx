import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { apptApi, healthApi, documentApi, ragApi } from '../api/axios'

// ── Citation components ──────────────────────────────────────────────────────
function PatientCitations({ citations }) {
  if (!citations?.length) return null
  return (
    <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
      <strong style={{ color: 'var(--text-secondary)' }}>From patient records:</strong>
      {citations.map((c, i) => (
        <div key={i}>· Chunk {c.chunk_index} (similarity: {c.similarity})</div>
      ))}
    </div>
  )
}

function LiteratureCitations({ citations }) {
  if (!citations?.length) return null
  return (
    <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
      <strong style={{ color: 'var(--text-secondary)' }}>Medical literature:</strong>
      {citations.map((c, i) => (
        <div key={i}>
          · <a href={c.url} target="_blank" rel="noreferrer"
              style={{ color: 'var(--accent)' }}>
            PMID {c.pmid}
          </a> — {c.title}
        </div>
      ))}
    </div>
  )
}

// ── Embedded patient AI chatbot ───────────────────────────────────────────────
function PatientChatbot({ patientId }) {
  const [messages, setMessages] = useState([{
    role: 'bot',
    text: "Ask me anything about this patient's health records. I can also search medical literature if you combine a clinical question with the patient context.",
    patientCitations: [], literatureCitations: [],
  }])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode]       = useState('hybrid')
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const send = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)

    try {
      const { data } = await ragApi.post('/rag/query', {
        query: userMsg, patient_id: patientId, mode,
      })
      setMessages(prev => [...prev, {
        role: 'bot',
        text: data.answer,
        patientCitations:    data.patient_citations,
        literatureCitations: data.literature_citations,
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: 'Sorry, the AI service is temporarily unavailable.',
        patientCitations: [], literatureCitations: [],
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'patient_records', label: 'Patient Records' },
          { key: 'hybrid',          label: 'Records + Literature' },
        ].map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`btn btn-sm ${mode === m.key ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '5px 12px' }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div style={{
              background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-elevated)',
              color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
              borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              padding: '10px 14px',
              fontSize: '0.875rem',
              lineHeight: 1.6,
              border: msg.role === 'bot' ? '1px solid var(--border)' : 'none',
            }}>
              {msg.text}
            </div>
            {msg.role === 'bot' && (
              <>
                <PatientCitations    citations={msg.patientCitations} />
                <LiteratureCitations citations={msg.literatureCitations} />
              </>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start' }}>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                          borderRadius: '14px 14px 14px 4px', padding: '12px 16px', display: 'flex', gap: 6 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--primary)',
                  animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite`,
                }}/>
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={mode === 'hybrid'
            ? 'Ask about this patient + search literature...'
            : "Ask about this patient's records..."}
          disabled={loading}
          style={{
            flex: 1, padding: '10px 14px', background: 'var(--bg-input)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit',
          }}
        />
        <button type="submit" disabled={!input.trim() || loading} className="btn btn-primary btn-sm">
          Send
        </button>
      </form>
    </div>
  )
}

// ── Main PatientDetail page ───────────────────────────────────────────────────
export default function PatientDetail() {
  const { patientId } = useParams()
  const navigate      = useNavigate()
  const [tab, setTab] = useState('records')

  const [appointments, setAppointments] = useState([])
  const [records,      setRecords]      = useState([])
  const [documents,    setDocuments]    = useState([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [apptRes, recRes, docRes] = await Promise.allSettled([
          apptApi.get('/appointments'),
          healthApi.get(`/health-records?patient_id=${patientId}`),
          documentApi.get(`/documents?patient_id=${patientId}`),
        ])

        if (apptRes.status === 'fulfilled') {
          setAppointments(apptRes.value.data.filter(a => a.patient_id === patientId))
        }
        if (recRes.status === 'fulfilled')  setRecords(recRes.value.data)
        if (docRes.status === 'fulfilled')  setDocuments(docRes.value.data)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [patientId])

  const shortId = id => id?.slice(0, 8).toUpperCase()

  const handleViewDoc = async (docId) => {
    try {
      const res = await documentApi.get(`/documents/${docId}`)
      window.open(res.data.url, '_blank')
    } catch {}
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content" style={{ padding: '24px 32px' }}>

        {/* Back + header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button onClick={() => navigate('/patients')} className="btn btn-secondary btn-sm">
            ← Back
          </button>
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
              Patient #{shortId(patientId)}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
              Full medical history and AI-assisted clinical support
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="card-grid" style={{ marginBottom: 24 }}>
          {[
            { label: 'Appointments', value: appointments.length, color: 'purple' },
            { label: 'Health Records', value: records.length, color: 'cyan' },
            { label: 'Documents', value: documents.length, color: 'green' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className={`stat-icon ${s.color}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="3" y1="9" x2="21" y2="9"/>
                </svg>
              </div>
              <div className="stat-info">
                <h3>{loading ? '—' : s.value}</h3>
                <p>{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Two-panel layout: tabs left, chatbot right */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 20, alignItems: 'start' }}>

          {/* Left: tabs */}
          <div>
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-card)',
                          border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 4 }}>
              {['records', 'documents', 'appointments'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontWeight: 600, fontSize: '0.82rem', textTransform: 'capitalize',
                    background: tab === t ? 'var(--primary-light)' : 'transparent',
                    color: tab === t ? 'var(--primary)' : 'var(--text-secondary)',
                    transition: 'all 150ms ease',
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Records tab */}
            {tab === 'records' && (
              records.length === 0 ? (
                <div className="card"><div className="empty-state"><p>No health records found.</p></div></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {records.map(r => (
                    <div key={r.id} className="card" style={{ padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.title || 'Health Record'}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(r.created_at).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                      {r.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 6 }}>{r.description}</p>}
                      {r.diagnosis   && <div style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>Diagnosis: {r.diagnosis}</div>}
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Documents tab */}
            {tab === 'documents' && (
              documents.length === 0 ? (
                <div className="card"><div className="empty-state"><p>No documents uploaded for this patient.</p></div></div>
              ) : (
                <div className="doc-list">
                  {documents.map(doc => (
                    <div key={doc.id} className="doc-item">
                      <div className="doc-item-info">
                        <div className="doc-item-icon">📄</div>
                        <div>
                          <div className="doc-item-name">{doc.file_name}</div>
                          <div className="doc-item-date">
                            {doc.category?.replace('_', ' ')} · {new Date(doc.uploaded_at).toLocaleDateString('en-IN')}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className={`badge ${doc.status === 'COMPLETED' ? 'badge-confirmed' : 'badge-pending'}`}>
                          {doc.status === 'COMPLETED' ? 'Indexed' : doc.status}
                        </span>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleViewDoc(doc.id)}>View</button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Appointments tab */}
            {tab === 'appointments' && (
              appointments.length === 0 ? (
                <div className="card"><div className="empty-state"><p>No appointments with this patient.</p></div></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {appointments.map(a => (
                    <div key={a.id} className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {new Date(a.datetime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          ID: {a.id.slice(0, 8).toUpperCase()}
                        </div>
                      </div>
                      <span className={`badge badge-${a.status === 'completed' ? 'confirmed' : a.status === 'pending' ? 'pending' : 'completed'}`}>
                        {a.status}
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Right: AI chatbot panel */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', height: 560, position: 'sticky', top: 24,
          }}>
            <div style={{
              padding: '14px 16px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface)',
            }}>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>AI Clinical Assistant</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Combines patient records + PubMed literature
              </div>
            </div>
            <PatientChatbot patientId={patientId} />
          </div>
        </div>
      </main>
    </div>
  )
}
