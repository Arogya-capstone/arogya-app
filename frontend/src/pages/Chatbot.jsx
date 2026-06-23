import { useState, useRef, useEffect } from 'react'
import { ragApi } from '../api/axios'
import Navbar from '../components/Navbar'

function BotIcon() {
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
      background: 'linear-gradient(135deg, #10b981, #06b6d4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
        <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
    </div>
  )
}

export default function Chatbot() {
  const [messages, setMessages] = useState([{
    role: 'bot',
    text: 'Hello! I\'m Arogya AI, your personal health assistant. I can answer questions about your uploaded medical records — lab reports, prescriptions, discharge summaries and more.',
    citations: [],
  }])
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const q = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: q, citations: [] }])
    setLoading(true)

    try {
      const { data } = await ragApi.post('/rag/query', {
        query: q,
        mode: 'patient_records',
      })
      setMessages(prev => [...prev, {
        role: 'bot',
        text: data.answer,
        citations: data.patient_citations || [],
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: "I'm having trouble connecting to the AI service. Please try again in a moment.",
        citations: [],
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content" style={{ display: 'flex', flexDirection: 'column', maxWidth: 780, margin: '0 auto', width: '100%' }}>

        <div className="page-header">
          <h2>Arogya AI Assistant</h2>
          <p>Ask questions about your health records — I search your uploaded documents using AI</p>
        </div>

        {/* Chat window */}
        <div style={{
          flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', minHeight: 500,
        }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start', gap: 10,
              }}>
                {msg.role === 'bot' && <BotIcon />}

                <div style={{ maxWidth: '76%' }}>
                  <div style={{
                    background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-elevated)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    padding: '12px 16px', fontSize: '0.9rem', lineHeight: 1.65,
                    border: msg.role === 'bot' ? '1px solid var(--border)' : 'none',
                  }}>
                    {msg.text}
                  </div>

                  {msg.role === 'bot' && msg.citations?.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: '0.73rem', color: 'var(--text-muted)', paddingLeft: 4 }}>
                      <strong style={{ color: 'var(--text-secondary)' }}>Sources from your records:</strong>
                      {msg.citations.map((c, j) => (
                        <div key={j}>· Chunk {c.chunk_index} (similarity {c.similarity})</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <BotIcon />
                <div style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: '18px 18px 18px 4px', padding: '14px 18px', display: 'flex', gap: 6,
                }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)',
                      animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite`,
                    }}/>
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={handleSend} style={{
            padding: '16px 20px', borderTop: '1px solid var(--border)',
            display: 'flex', gap: 10,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about your lab results, medications, diagnoses..."
              disabled={loading}
              style={{
                flex: 1, padding: '12px 16px', background: 'var(--bg-input)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)', fontSize: '0.9rem',
                outline: 'none', fontFamily: 'inherit', transition: 'border-color 150ms ease',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--primary)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'}
            />
            <button type="submit" disabled={!input.trim() || loading} className="btn btn-primary">
              Send
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 12 }}>
          Answers are based only on your uploaded documents · Always consult your doctor for medical decisions
        </p>
      </main>
    </div>
  )
}
