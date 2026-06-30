# Arogya — Cloud-Native Healthcare Platform

Arogya is a cloud-native healthcare platform built on AWS that connects patients and doctors through AI-assisted clinical workflows. It features a three-mode RAG AI for medical Q&A, automated document ingestion via Textract, and an AI-driven incident response agent.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Services](#services)
- [AWS Services Used](#aws-services-used)
- [RAG AI Pipeline](#rag-ai-pipeline)
- [Document Ingestion Pipeline](#document-ingestion-pipeline)
- [AIOps Agent](#aiops-agent)
- [Authentication](#authentication)
- [Database Schemas](#database-schemas)
- [CI/CD Pipeline](#cicd-pipeline)
- [Local Development](#local-development)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        End Users (Browser)                       │
│                     Patient / Doctor                             │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
              ┌──────────────▼──────────────┐
              │   Frontend (React + Nginx)   │
              │   Port 8080                  │
              └──────────────┬──────────────┘
                             │ HTTP (Internal ALB — EKS)
     ┌───────────────────────┼────────────────────────────────┐
     │                  Microservices (EKS)                    │
     │                                                         │
     │  user-service:8001     appointment-service:8002         │
     │  health-service:8003   document-service:8004            │
     │  rag-service:8005      rag-worker (KEDA/SQS-scaled)     │
     └────────┬──────────────────────┬──────────────┬──────────┘
              │                      │              │
         ┌────▼─────┐         ┌──────▼───┐   ┌─────▼──────┐
         │  RDS     │         │ S3       │   │ SQS Queues │
         │ (5 DBs + │         │ Documents│   │ RAG + Appt │
         │ pgvector)│         └──────────┘   └─────┬──────┘
         └──────────┘                              │
                           Textract ◄──────────────┘
                           Bedrock (Nova Lite, Titan)
                           PubMed E-utilities

     ┌────────────────────────────────────────────────┐
     │  CloudWatch Alarms → AIops Lambda              │
     │  Nova Lite Diagnosis → SNS → On-call Email     │
     └────────────────────────────────────────────────┘
```

---

## Services

### user-service (Port 8001)

Handles authentication and user management.

- User registration with `patient` / `doctor` roles
- Login with RS256 JWT token generation
- JWKS endpoint at `/.well-known/jwks.json` for Envoy Gateway validation
- Doctor listing (used by patients when booking appointments)

**Database:** `user_db`

---

### appointment-service (Port 8002)

Manages the full appointment lifecycle.

- Patients book appointments with doctors (must be a future datetime)
- Doctors accept / deny / complete appointments
- Role-filtered listing (patients see their own, doctors see assigned)
- Publishes status-change events to SQS → notification Lambda → SES email

**Database:** `appointment_db`

---

### health-service (Port 8003)

Stores clinical notes and medical records.

- Doctors create health records linked to completed appointments (one record per appointment enforced by unique constraint)
- Patients and doctors can view records (role-filtered)
- AI chatbot endpoint backed by Groq (HuggingFace fallback with circuit breaker)

**Database:** `health_db`

---

### document-service (Port 8004)

Handles secure medical document upload and lifecycle tracking.

- Generates presigned S3 URLs for direct browser-to-S3 uploads
- Supports PDF, JPG, PNG across categories: `lab_report`, `prescription`, `imaging`, `discharge_summary`, `insurance`, `referral`, `consultation`
- On `/confirm`, publishes a message to the SQS RAG queue to trigger async processing
- Document status tracked: `PENDING → PROCESSING → COMPLETED / FAILED`

**Database:** `document_db`

---

### rag-service (Port 8005)

AI-powered medical Q&A with retrieval-augmented generation. Supports three modes:

| Mode | Sources | Use Case |
|------|---------|----------|
| `patient_records` | Patient's own pgvector embeddings | Patient asking about their history |
| `literature` | PubMed abstracts via E-utilities API | Doctor researching treatments |
| `hybrid` | Both sources in parallel | Physician clinical decision support |

Primary LLM: **Amazon Nova Lite v1** via Bedrock (with Guardrails).
Fallback: **Groq Llama 3.1 70B** on throttling / timeout.

**Database:** `rag_db` (pgvector)

---

### rag-worker (No HTTP port — KEDA-scaled Kubernetes deployment)

Asynchronous document processing pipeline triggered by SQS. Scales automatically with KEDA based on queue depth.

Pipeline per message:
1. Pull message from SQS (long-poll, one at a time)
2. OCR the S3 document via **AWS Textract**
3. Chunk text into 500-char segments with 50-char overlap
4. Embed each chunk with **Amazon Titan Text Embeddings v2** (1024 dims)
5. Upsert vectors into pgvector (`document_chunks` table)
6. Update document status to `COMPLETED` (or `FAILED` on error)

Failed messages are left in the queue; after 3 visibility timeouts they move to the DLQ.

---

### aiops-agent (AWS Lambda — CloudWatch Alarm → SNS trigger)

Automated incident response. When a CloudWatch alarm fires:

1. Maps the alarm name to the affected service and its log group
2. Fetches the last 10 minutes of CloudWatch logs
3. Sends logs + alarm context to **Nova Lite** for diagnosis
4. Nova Lite returns: `ROOT CAUSE`, `SEVERITY`, `RECOMMENDED ACTIONS`
5. Publishes the formatted diagnosis + raw logs to SNS → on-call engineer email

---

### frontend (Port 8080)

React 18 SPA built with Vite, served by Nginx.

Pages: Login, Register, Dashboard, Appointments, Health Records, Documents, Chatbot, Doctor/Patient detail views.

Auth flow: JWT stored in `localStorage`, attached to all requests via Axios interceptor. `ProtectedRoute` HOC guards authenticated pages.

---

## AWS Services Used

| Service | Purpose |
|---------|---------|
| **Amazon Bedrock** | Nova Lite LLM inference; Titan Text Embeddings v2; Bedrock Guardrails |
| **AWS Textract** | OCR for uploaded PDFs and images |
| **Amazon RDS (PostgreSQL)** | Five relational databases with pgvector extension |
| **Amazon S3** | Medical document storage (MinIO used locally) |
| **Amazon SQS** | Async queues for document processing and appointment notifications |
| **Amazon SNS** | AIops diagnosis delivery; appointment notification fan-out |
| **Amazon SES** | Appointment notification emails |
| **AWS Secrets Manager** | JWT key pairs, DB credentials, API keys |
| **Amazon CloudWatch** | Centralized logging and alarms |
| **Amazon EKS** | Kubernetes cluster for all microservices |
| **Amazon ECR** | Primary Docker image registry |
| **KEDA** | Autoscale rag-worker based on SQS queue depth |

---

## RAG AI Pipeline

### Query flow (rag-service)

```
User Query
    │
    ▼
Titan Embed v2 (1024-dim vector)
    │
    ├─[patient_records]──► pgvector cosine search (top-5 chunks)
    │                           │
    ├─[literature]───────► PubMed esearch → efetch abstracts (top-4)
    │                           │
    └─[hybrid]──────────► Both above in parallel
                                │
                                ▼
                      Context assembly
                                │
                                ▼
                    Nova Lite v1 (primary)
                    Groq Mixtral (fallback)
                                │
                                ▼
                    Answer + citations (PMIDs / chunk refs)
```

### Guardrails

Bedrock Guardrails enforce strict medical scope — the model refuses off-topic queries. Responses for patients use a warm conversational tone; responses for doctors are clinical and cite all sources.

---

## Document Ingestion Pipeline

```
Patient uploads file (browser)
    │
    ▼
document-service: generate presigned S3 URL
    │
    ▼
Browser uploads directly to S3
    │
    ▼
POST /confirm → publish to SQS RAG queue
    │
    ▼
rag-worker (KEDA-scaled pod)
    ├── Textract: detect_document_text(S3Object)
    ├── Chunk text (500 chars / 50 overlap)
    ├── Titan Embed each chunk → vector(1024)
    └── pgvector INSERT into document_chunks
    │
    ▼
document status → COMPLETED
```

> **Note:** The synchronous Textract API (`detect_document_text`) is used, which works well for documents under ~5 pages. Larger documents would require the async `StartDocumentTextDetection` flow.

---

## AIOps Agent

```
CloudWatch Alarm fires
    │
    ▼
SNS → Lambda trigger
    │
    ▼
Parse AlarmName → map to service + log group
    │
    ▼
CloudWatch: filter_log_events (last 10 minutes)
    │
    ▼
Bedrock Nova Lite: diagnose(alarm_context + logs)
    │
    ▼
SNS publish:
    ├── ROOT CAUSE
    ├── SEVERITY
    ├── RECOMMENDED ACTIONS
    └── Last 50 log lines + CloudWatch console link
    │
    ▼
On-call engineer email (SNS subscription)
```

---

## Authentication

All services use **RS256 JWT** tokens issued by `user-service`.

| Item | Detail |
|------|--------|
| Algorithm | RS256 |
| Key storage | AWS Secrets Manager (prod) / local PEM files (dev) |
| Token claims | `user_id`, `role`, `iss`, `kid` |
| JWKS endpoint | `user-service:8001/.well-known/jwks.json` |
| Password hashing | bcrypt via passlib (72-byte truncation safe) |
| Request tracing | `X-Request-ID` UUID injected by middleware, propagated across services |

Roles: `patient`, `doctor`. Role is embedded in the JWT and enforced in each service's route handlers.

---

## Database Schemas

### user_db
```sql
users (id UUID PK, name, email UNIQUE, password_hash, role, created_at)
```

### appointment_db
```sql
appointments (id UUID PK, patient_id, doctor_id, datetime, status, created_at, updated_at, is_deleted)
-- status: pending | accepted | denied | completed
```

### health_db
```sql
health_records (id UUID PK, patient_id, doctor_id, appointment_id UNIQUE,
                title, description, diagnosis, prescription_text,
                created_at, updated_at, created_by_user_id, created_by_role, is_deleted)
```

### document_db
```sql
documents (id UUID PK, patient_id, record_id, file_name, s3_key,
           uploaded_by, file_type, category, status,
           uploaded_at, updated_at, created_by_user_id, created_by_role, is_deleted)
-- status: PENDING | PROCESSING | COMPLETED | FAILED
```

### rag_db
```sql
document_chunks (id SERIAL PK, document_id UUID, patient_id UUID,
                 chunk_index INT, content TEXT, embedding vector(1024), created_at)
-- Index: IVFFlat cosine (lists=100)
```

---

## CI/CD Pipeline

Defined in `.github/workflows/` — triggers on push to `main` and manual dispatch.

| Stage | Tool | Action |
|-------|------|--------|
| Secret scan | Gitleaks | Block merge if secrets found |
| SAST | Bandit | Python static analysis |
| Dependency audit | pip-audit | Known CVE check |
| Unit tests | pytest | Per-service test suites |
| Container scan | Trivy | Fail on CRITICAL, warn on HIGH |
| Image build & push | Docker | Push to ECR (primary) + Docker Hub (backup) |
| Helm lint | Helm | Validate chart against dev + prod values |
| Deploy to prod | GitOps | Update image tag in `arogya-gitops` repo → ArgoCD sync |

Prod deploy requires manual GitHub environment approval. Notifications sent via email on success and failure.

---

## Local Development

Each service is a standalone FastAPI app. To run locally:

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables (see config_loader.py for required vars)
export AWS_DEFAULT_REGION=us-east-1
export DATABASE_URL=postgresql+asyncpg://...

# Start service
uvicorn main:app --reload --port 8001
```

For S3, use MinIO locally by setting `S3_ENDPOINT_URL` to your MinIO address.

For Bedrock, AWS credentials with `bedrock:InvokeModel` permission are required.

The `rag-worker` runs as a plain Python script (no HTTP):

```bash
export SQS_RAG_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/...
python main.py
```
