import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { userApi } from '../api/axios'

function CrossIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="14" fill="url(#heroGrad)"/>
      <path d="M24 10v28M10 24h28" stroke="white" strokeWidth="4" strokeLinecap="round"/>
      <defs>
        <linearGradient id="heroGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10b981"/>
          <stop offset="1" stopColor="#0891b2"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (localStorage.getItem('token')) navigate('/dashboard')
  }, [navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await userApi.post('/login', { email, password })
      localStorage.setItem('token', res.data.access_token)
      navigate('/dashboard')
    } catch (err) {
      const msg = err.response?.data?.detail?.error?.message || err.response?.data?.detail || 'Login failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      {/* Left — hero panel */}
      <div className="auth-hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span></span>
            AI-Powered Healthcare
          </div>

          <div className="hero-logo">
            <CrossIcon />
            <h1>Arogya</h1>
          </div>

          <p className="hero-tagline">
            Your intelligent health companion — manage appointments, access records,
            analyse documents, and get AI-driven insights, all in one place.
          </p>

          <div className="hero-features">
            {[
              'Secure end-to-end encrypted health records',
              'AI-powered document analysis with RAG',
              'Real-time appointment scheduling',
              'Automated health insights via Bedrock',
            ].map(f => (
              <div key={f} className="hero-feature">
                <div className="hero-feature-dot"></div>
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — login form */}
      <div className="auth-panel">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <h2>Welcome back</h2>
              <p>Sign in to your Arogya account</p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? <span className="spinner"></span> : 'Sign In'}
              </button>
            </form>

            <div className="auth-link">
              Don't have an account? <Link to="/register">Create one</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
