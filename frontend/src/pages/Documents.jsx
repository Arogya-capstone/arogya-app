import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { documentApi } from '../api/axios'

const CATEGORIES = [
  { value: 'lab_report',        label: 'Lab Report' },
  { value: 'prescription',      label: 'Prescription' },
  { value: 'imaging',           label: 'Imaging / Scan' },
  { value: 'discharge_summary', label: 'Discharge Summary' },
  { value: 'referral',          label: 'Referral Letter' },
  { value: 'consultation',      label: 'Consultation Notes' },
  { value: 'insurance',         label: 'Insurance' },
  { value: 'other',             label: 'Other' },
]

function statusBadge(status) {
  if (status === 'PROCESSING') return <span className="badge badge-pending">Processing</span>
  if (status === 'COMPLETED')  return <span className="badge badge-confirmed">Indexed</span>
  if (status === 'PENDING')    return <span className="badge badge-pending">Pending</span>
  return null
}

function FileIcon({ name }) {
  const ext = name.split('.').pop().toLowerCase()
  const icons = { pdf: '📕', jpg: '🖼️', jpeg: '🖼️', png: '🖼️' }
  return <span>{icons[ext] || '📄'}</span>
}

export default function Documents() {
  const [documents, setDocuments]   = useState([])
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')
  const [uploading, setUploading]   = useState(false)
  const [dragover, setDragover]     = useState(false)
  const [category, setCategory]     = useState('other')
  const [searchParams] = useSearchParams()
  const appointmentId = searchParams.get('appointment_id')

  const fetchDocuments = async () => {
    try {
      const url = appointmentId ? `/documents?appointment_id=${appointmentId}` : '/documents'
      const res = await documentApi.get(url)
      setDocuments(res.data)
    } catch (err) {
      console.error('Fetch documents error:', err)
    }
  }

  useEffect(() => { fetchDocuments() }, [])

  const handleUpload = async (file) => {
    if (!file) return
    setError(''); setSuccess('')

    // Client-side size check (5 MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File exceeds 5 MB limit.')
      return
    }

    const allowed = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(file.type)) {
      setError('Only PDF, JPG, and PNG files are allowed.')
      return
    }

    setUploading(true)
    try {
      // 1. Request presigned S3 URL
      const { data } = await documentApi.post('/documents/presigned-url', {
        file_name:      file.name,
        file_type:      file.type,
        category,
        appointment_id: appointmentId || undefined,
      })
      const { upload_url, document_id } = data

      // 2. Upload directly to S3 — backend never sees the file bytes
      const s3Res = await fetch(upload_url, {
        method:  'PUT',
        headers: { 'Content-Type': file.type },
        body:    file,
      })
      if (!s3Res.ok) throw new Error('S3 upload failed')

      // 3. Confirm — triggers SQS message → rag-worker indexes into pgvector
      await documentApi.post(`/documents/${document_id}/confirm`)

      setSuccess(`"${file.name}" uploaded. AI indexing in progress — this takes ~30 seconds.`)
      fetchDocuments()
    } catch (err) {
      const msg = err.response?.data?.detail?.error?.message
               || err.response?.data?.detail
               || err.message
               || 'Upload failed'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e) => handleUpload(e.target.files[0])

  const handleDrop = (e) => {
    e.preventDefault()
    setDragover(false)
    handleUpload(e.dataTransfer.files[0])
  }

  const handleView = async (id) => {
    try {
      const res = await documentApi.get(`/documents/${id}`)
      window.open(res.data.url, '_blank')
    } catch (err) {
      setError('Failed to get file URL')
    }
  }

  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content">
        <div className="page-header">
          <h2>Documents</h2>
          <p>
            Upload medical documents — PDFs and images are automatically OCR-processed
            and indexed for AI-powered queries.
          </p>
        </div>

        {error   && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* Category selector */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="category">Document Category</label>
            <select
              id="category"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Upload area */}
        <div
          className={`upload-area ${dragover ? 'dragover' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragover(true) }}
          onDragLeave={() => setDragover(false)}
          onDrop={handleDrop}
          style={{ marginBottom: '28px' }}
        >
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileChange}
            disabled={uploading}
          />
          <div className="upload-icon">{uploading ? '⏳' : '☁️'}</div>
          <h4>{uploading ? 'Uploading...' : 'Drop file here or click to browse'}</h4>
          <p>PDF, JPG, PNG · Max 5 MB · Will be AI-indexed automatically</p>
        </div>

        {/* Document list */}
        <div className="section-header">
          <h3>Uploaded Documents</h3>
          <button className="btn btn-secondary btn-sm" onClick={fetchDocuments}>
            Refresh
          </button>
        </div>

        {documents.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <h3>No documents yet</h3>
              <p>Upload your first document above — it will be indexed for AI queries automatically.</p>
            </div>
          </div>
        ) : (
          <div className="doc-list">
            {documents.map(doc => {
              const cat = CATEGORIES.find(c => c.value === doc.category)
              return (
                <div className="doc-item" key={doc.id}>
                  <div className="doc-item-info">
                    <div className="doc-item-icon">
                      <FileIcon name={doc.file_name} />
                    </div>
                    <div>
                      <div className="doc-item-name">{doc.file_name}</div>
                      <div className="doc-item-date">
                        {cat?.label || doc.category} · {new Date(doc.uploaded_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {statusBadge(doc.status)}
                    <button className="btn btn-secondary btn-sm" onClick={() => handleView(doc.id)}>
                      View
                    </button>
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
