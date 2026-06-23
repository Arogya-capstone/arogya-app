import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { userApi } from '../api/axios'

function CrossIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect width="48" height="48" rx="14" fill="url(#heroGrad2)"/>
      <path d="M24 10v28M10 24h28" stroke="white" strokeWidth="4" strokeLinecap="round"/>
      <defs>
        <linearGradient id="heroGrad2" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10b981"/>
          <stop offset="1" stopColor="#0891b2"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function Register() {
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole]       = useState('patient')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await userApi.post('/register', { name, email, password, role })
      navigate('/login')
    } catch (err) {
      const msg = err.response?.data?.detail?.error?.message || err.response?.data?.detail || 'Registration failed'
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
            Join Arogya Today
          </div>

          <div className="hero-logo">
            <CrossIcon />
            <h1>Arogya</h1>
          </div>

          <p className="hero-tagline">
            Create your account in seconds and gain access to AI-powered healthcare management
            — built on AWS with enterprise-grade security.
          </p>

          <div className="hero-features">
            {[
              'Free & secure patient accounts',
              'AI-assisted health record insights',
              'Encrypted document storage on S3',
              'Smart appointment management',
            ].map(f => (
              <div key={f} className="hero-feature">
                <div className="hero-feature-dot"></div>
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — register form */}
      <div className="auth-panel">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <h2>Create your account</h2>
              <p>Get started with Arogya in seconds</p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="name">Full Name</label>
                <input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="reg-email">Email Address</label>
                <input
                  id="reg-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="form-group">
                <label htmlFor="reg-password">Password</label>
                <input
                  id="reg-password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>

              <div className="form-group">
                <label htmlFor="role">I am a</label>
                <select id="role" value={role} onChange={e => setRole(e.target.value)}>
                  <option value="patient">Patient</option>
                  <option value="doctor">Doctor</option>
                </select>
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? <span className="spinner"></span> : 'Create Account'}
              </button>
            </form>

            <div className="auth-link">
              Already have an account? <Link to="/login">Sign in</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
