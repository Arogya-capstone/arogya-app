"""
rag-service — unified AI query endpoint supporting three modes:

  patient_records : cosine search over patient's own pgvector embeddings
  literature      : PubMed E-utilities API → Nova Lite (no patient data)
  hybrid          : both in parallel → combined Nova Lite prompt with dual citations

Flow for patient_records / hybrid:
  query → Titan embedding → pgvector cosine search → context assembly
        → Nova Lite v1 → Bedrock Guardrails → answer + record citations

Flow for literature / hybrid:
  query → PubMed esearch → efetch abstracts → Nova Lite → answer + PMID citations
"""
import asyncio
import os
import json
from contextlib import asynccontextmanager
from typing import Literal

import boto3
import httpx
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel

from logging_config import setup_logger
from auth.jwt import get_current_user
from aws_utils import get_database_url

logger = setup_logger("rag-service")

AWS_REGION        = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
LLM_MODEL_ID      = os.getenv("BEDROCK_LLM_MODEL_ID", "amazon.nova-lite-v1:0")
EMBED_MODEL_ID    = os.getenv("BEDROCK_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
GUARDRAIL_ID      = os.getenv("BEDROCK_GUARDRAIL_ID", "")
GUARDRAIL_VERSION = os.getenv("BEDROCK_GUARDRAIL_VERSION", "DRAFT")
TOP_K             = int(os.getenv("TOP_K_CHUNKS", "5"))
PUBMED_MAX        = int(os.getenv("PUBMED_MAX_RESULTS", "4"))
GROQ_MODEL        = os.getenv("GROQ_FALLBACK_MODEL", "mixtral-8x7b-32768")
GROQ_API_URL      = "https://api.groq.com/openai/v1/chat/completions"

bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)
_sm     = boto3.client("secretsmanager", region_name=AWS_REGION)


def _get_groq_key() -> str:
    """Fetch Groq API key from Secrets Manager once at startup; fall back to env var."""
    env = os.getenv("APP_ENV", "dev")
    secret_name = f"arogya/{env}/groq-api-key"
    try:
        return _sm.get_secret_value(SecretId=secret_name)["SecretString"]
    except Exception:
        return os.getenv("GROQ_API_KEY", "")  # local dev / testing


_GROQ_KEY: str = ""  # loaded lazily on first fallback so startup never blocks


def groq_key() -> str:
    global _GROQ_KEY
    if not _GROQ_KEY:
        _GROQ_KEY = _get_groq_key()
    return _GROQ_KEY

PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_FETCH  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"


# ── pgvector ──────────────────────────────────────────────────────────────────
def get_pg_conn():
    url = get_database_url("rag_db").replace("postgresql+asyncpg://", "postgresql://")
    return psycopg2.connect(url)


def embed_query(text: str) -> list[float]:
    body = json.dumps({"inputText": text, "dimensions": 1024, "normalize": True})
    resp = bedrock.invoke_model(
        modelId=EMBED_MODEL_ID, body=body,
        contentType="application/json", accept="application/json",
    )
    return json.loads(resp["body"].read())["embedding"]


def search_chunks(patient_id: str, query_vector: list[float], top_k: int) -> list[dict]:
    conn = get_pg_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            vec = "[" + ",".join(str(v) for v in query_vector) + "]"
            cur.execute(
                """
                SELECT document_id, chunk_index, content,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM document_chunks
                WHERE patient_id = %s
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (vec, patient_id, vec, top_k),
            )
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ── PubMed E-utilities (free, no API key needed) ──────────────────────────────
async def search_pubmed(query: str, max_results: int = PUBMED_MAX) -> list[dict]:
    """
    1. esearch → get PMIDs matching the query
    2. efetch  → get title + abstract for each PMID
    Returns list of { pmid, title, authors, journal, year, abstract }
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        # Step 1 — search
        search_resp = await client.get(PUBMED_SEARCH, params={
            "db": "pubmed", "term": query, "retmax": max_results,
            "retmode": "json", "sort": "relevance",
        })
        search_resp.raise_for_status()
        pmids = search_resp.json().get("esearchresult", {}).get("idlist", [])

        if not pmids:
            return []

        # Step 2 — fetch abstracts in one call
        fetch_resp = await client.get(PUBMED_FETCH, params={
            "db": "pubmed", "id": ",".join(pmids),
            "rettype": "abstract", "retmode": "text",
        })
        fetch_resp.raise_for_status()
        raw = fetch_resp.text

    # Parse the plain-text response into per-paper dicts
    papers = []
    for i, pmid in enumerate(pmids):
        block_start = raw.find(f"{i+1}.")
        block_end   = raw.find(f"{i+2}.") if i + 1 < len(pmids) else len(raw)
        block = raw[block_start:block_end].strip() if block_start != -1 else ""

        lines  = [l.strip() for l in block.splitlines() if l.strip()]
        title  = lines[1] if len(lines) > 1 else "Title unavailable"
        # Extract author line (usually line 2 or 3)
        author = lines[2] if len(lines) > 2 else ""
        abstract = " ".join(lines[4:]) if len(lines) > 4 else block

        papers.append({
            "pmid":     pmid,
            "title":    title[:200],
            "authors":  author[:150],
            "abstract": abstract[:800],
            "url":      f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        })

    return papers


# ── LLM inference — Nova Lite (primary) with Groq fallback ───────────────────
def _invoke_bedrock(system_prompt: str, user_message: str) -> str:
    body = json.dumps({
        "schemaVersion": "messages-v1",
        "system": [{"text": system_prompt}],
        "messages": [{"role": "user", "content": [{"text": user_message}]}],
        "inferenceConfig": {"maxTokens": 1024, "temperature": 0.1, "topP": 0.9},
    })
    kwargs: dict = dict(
        modelId=LLM_MODEL_ID, body=body,
        contentType="application/json", accept="application/json",
    )
    if GUARDRAIL_ID:
        kwargs["guardrailIdentifier"] = GUARDRAIL_ID
        kwargs["guardrailVersion"]    = GUARDRAIL_VERSION

    resp   = bedrock.invoke_model(**kwargs)
    result = json.loads(resp["body"].read())
    return result["output"]["message"]["content"][0]["text"]


def _invoke_groq(system_prompt: str, user_message: str) -> str:
    """
    Groq API is OpenAI-compatible. Uses Llama 3.1 70B (free tier, ~200ms).
    Note: Guardrail does NOT wrap Groq calls — system prompt is the only safety layer.
    The system prompt already constrains the model to medical topics only.
    """
    key = groq_key()
    if not key or key.startswith("REPLACE_"):
        raise RuntimeError("Groq API key not configured")

    resp = httpx.post(
        GROQ_API_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_message},
            ],
            "temperature": 0.1,
            "max_tokens":  1024,
        },
        timeout=20.0,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def invoke_nova(system_prompt: str, user_message: str) -> str:
    """
    Primary: Amazon Nova Lite via Bedrock (with Guardrails).
    Fallback: Groq Llama 3.1 70B — triggered on throttling, service errors, or timeouts.
    The fallback answer is tagged so it's visible in logs but transparent to users.
    """
    try:
        return _invoke_bedrock(system_prompt, user_message)
    except bedrock.exceptions.ThrottlingException as e:
        logger.warning(f"Bedrock throttled — switching to Groq fallback: {e}")
    except bedrock.exceptions.ModelTimeoutException as e:
        logger.warning(f"Bedrock timeout — switching to Groq fallback: {e}")
    except bedrock.exceptions.ServiceUnavailableException as e:
        logger.warning(f"Bedrock unavailable — switching to Groq fallback: {e}")
    except Exception as e:
        logger.error(f"Bedrock unexpected error ({type(e).__name__}) — switching to Groq fallback: {e}")

    try:
        answer = _invoke_groq(system_prompt, user_message)
        logger.info("Groq fallback succeeded")
        return answer
    except Exception as e:
        logger.error(f"Groq fallback also failed: {e}")
        raise RuntimeError("Both primary (Bedrock) and fallback (Groq) AI providers are unavailable.")


# ── Mode: patient records only ────────────────────────────────────────────────
def answer_patient_records(query: str, patient_id: str) -> dict:
    query_vec = embed_query(query)
    chunks    = search_chunks(patient_id, query_vec, TOP_K)

    if not chunks:
        return {
            "answer": (
                "No relevant documents found in your medical records for this query. "
                "Please upload your medical documents first."
            ),
            "patient_citations": [], "literature_citations": [], "chunks_used": 0,
        }

    context = "\n\n".join(
        f"[Document chunk {i+1} — similarity {round(float(c['similarity']),3)}]:\n{c['content']}"
        for i, c in enumerate(chunks)
    )
    system = (
        "You are Arogya AI, a friendly and caring personal health assistant. "
        "A patient is asking you about their own medical records. "
        "Answer their specific question in a warm, conversational tone — like a knowledgeable friend explaining things simply. "
        "Rules:\n"
        "- Answer the question directly. Do NOT list every number or value unless the patient asks for them.\n"
        "- Use plain language. Avoid medical jargon; if you must use a term, explain it in simple words.\n"
        "- Keep responses concise — 2 to 4 sentences for simple questions, a short paragraph for complex ones.\n"
        "- Only mention values that are relevant to the question.\n"
        "- If something looks outside the normal range, mention it gently and suggest seeing a doctor.\n"
        "- Never fabricate information not present in the records.\n"
        "- End with one short reassuring sentence and a brief reminder to consult their doctor if needed."
    )
    user_msg = f"Medical records context:\n{context}\n\nPatient's question: {query}"
    answer   = invoke_nova(system, user_msg)

    return {
        "answer": answer,
        "patient_citations": [
            {"document_id": str(c["document_id"]), "chunk_index": c["chunk_index"],
             "similarity": round(float(c["similarity"]), 4)}
            for c in chunks
        ],
        "literature_citations": [],
        "chunks_used": len(chunks),
    }


# ── Mode: literature only ─────────────────────────────────────────────────────
async def answer_literature(query: str) -> dict:
    papers = await search_pubmed(query)

    if not papers:
        return {
            "answer": "No relevant medical literature found for this query on PubMed. Try rephrasing.",
            "patient_citations": [], "literature_citations": [], "chunks_used": 0,
        }

    context = "\n\n".join(
        f"[Paper {i+1} — PMID {p['pmid']}]\n"
        f"Title: {p['title']}\nAuthors: {p['authors']}\n"
        f"Abstract: {p['abstract']}"
        for i, p in enumerate(papers)
    )
    system = (
        "You are Arogya AI, a friendly health assistant. "
        "Answer the question clearly and simply using the provided medical literature. "
        "Rules:\n"
        "- Be conversational and easy to understand — avoid heavy jargon.\n"
        "- Give a direct, useful answer first, then add supporting detail if needed.\n"
        "- Keep it concise. Cite sources with PMID in brackets e.g. [PMID 38291047].\n"
        "- End with a gentle reminder to consult a doctor for personal medical advice."
    )
    user_msg = f"Medical literature:\n{context}\n\nQuestion: {query}"
    answer   = invoke_nova(system, user_msg)

    return {
        "answer": answer,
        "patient_citations": [],
        "literature_citations": [
            {"pmid": p["pmid"], "title": p["title"],
             "authors": p["authors"], "url": p["url"]}
            for p in papers
        ],
        "chunks_used": len(papers),
    }


# ── Mode: hybrid (patient records + PubMed in parallel) ──────────────────────
async def answer_hybrid(query: str, patient_id: str) -> dict:
    # Run patient record search (sync, in thread) and PubMed search in parallel
    loop = asyncio.get_event_loop()

    def _patient_search():
        vec = embed_query(query)
        return search_chunks(patient_id, vec, TOP_K)

    chunks, papers = await asyncio.gather(
        loop.run_in_executor(None, _patient_search),
        search_pubmed(query),
    )

    patient_context = "\n\n".join(
        f"[Patient record chunk {i+1} — similarity {round(float(c['similarity']),3)}]:\n{c['content']}"
        for i, c in enumerate(chunks)
    ) if chunks else "No relevant records found in this patient's uploaded documents."

    literature_context = "\n\n".join(
        f"[Literature — PMID {p['pmid']}]\nTitle: {p['title']}\n{p['abstract']}"
        for p in papers
    ) if papers else "No relevant PubMed literature found."

    system = (
        "You are assisting a licensed physician with clinical decision support. "
        "You have access to the patient's own health records AND relevant medical literature. "
        "Structure your response as:\n"
        "1. PATIENT FINDINGS: what their records show relevant to this question\n"
        "2. MEDICAL EVIDENCE: what the literature says (cite PMIDs)\n"
        "3. CLINICAL CONSIDERATIONS: patient-specific concerns based on their history vs literature\n"
        "Do NOT make the final clinical decision — support the physician's judgement. "
        "Always cite record chunks or PMIDs for every claim."
    )
    user_msg = (
        f"=== PATIENT'S MEDICAL RECORDS ===\n{patient_context}\n\n"
        f"=== MEDICAL LITERATURE (PubMed) ===\n{literature_context}\n\n"
        f"=== PHYSICIAN'S QUESTION ===\n{query}"
    )
    answer = invoke_nova(system, user_msg)

    return {
        "answer": answer,
        "patient_citations": [
            {"document_id": str(c["document_id"]), "chunk_index": c["chunk_index"],
             "similarity": round(float(c["similarity"]), 4)}
            for c in chunks
        ],
        "literature_citations": [
            {"pmid": p["pmid"], "title": p["title"],
             "authors": p["authors"], "url": p["url"]}
            for p in papers
        ],
        "chunks_used": len(chunks) + len(papers),
    }


# ── FastAPI ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(lifespan=lifespan, title="Arogya RAG Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=400, content={"error": "Invalid input", "details": str(exc.errors())})

@app.exception_handler(Exception)
async def global_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}")
    return JSONResponse(status_code=500, content={"error": "Internal server error"})

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.get("/ready")
async def ready():
    try:
        conn = get_pg_conn()
        conn.cursor().execute("SELECT 1")
        conn.close()
        return {"status": "ready"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database not ready")


class RAGQueryRequest(BaseModel):
    query:      str
    patient_id: str | None = None
    mode:       Literal["patient_records", "literature", "hybrid"] = "patient_records"


@app.post("/rag/query")
async def rag_query(data: RAGQueryRequest, user=Depends(get_current_user)):
    if not data.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    role = user["role"]

    # ── patient: own records first, fall back to literature if no docs uploaded ─
    if role == "patient":
        try:
            result = answer_patient_records(data.query, user["user_id"])
            if result["chunks_used"] == 0:
                return await answer_literature(data.query)
            return result
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))
        except Exception as e:
            logger.error(f"Patient RAG failed: {e}")
            raise HTTPException(status_code=503, detail="AI service temporarily unavailable")

    # ── doctor: mode determines which sources to use ───────────────────────
    if role == "doctor":
        try:
            if data.mode == "literature":
                return await answer_literature(data.query)

            if data.mode in ("patient_records", "hybrid"):
                if not data.patient_id:
                    raise HTTPException(status_code=400,
                                        detail="patient_id is required for patient_records and hybrid modes")
                if data.mode == "hybrid":
                    return await answer_hybrid(data.query, data.patient_id)
                else:
                    return answer_patient_records(data.query, data.patient_id)
        except HTTPException:
            raise
        except RuntimeError as e:
            # Both providers failed — surface the specific message
            raise HTTPException(status_code=503, detail=str(e))
        except Exception as e:
            logger.error(f"Doctor RAG failed (mode={data.mode}): {e}")
            raise HTTPException(status_code=503, detail="AI service temporarily unavailable")

    raise HTTPException(status_code=403, detail="Access denied")
