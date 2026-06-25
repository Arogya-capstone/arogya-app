# Arogya — Project Status & Deployment Roadmap

Last updated: 2026-06-25

---

## What Is Built (Code Complete)

### arogya-app — All services written, pushed to GitHub
| Component | Status | Notes |
|-----------|--------|-------|
| user-service | Code complete | JWT RS256, JWKS endpoint, register/login |
| appointment-service | Code complete | Doctor/patient appointments, SQS events |
| health-service | Code complete | Health records CRUD |
| document-service | Code complete | S3 presigned upload, SQS trigger fixed |
| rag-service | Code complete | 3-mode RAG: patient/literature/hybrid, PubMed, Groq fallback |
| rag-worker | Code complete | SQS consumer, Titan embeddings, pgvector write |
| aiops-agent | Code complete | CloudWatch alarm → Bedrock diagnosis → SES email |
| Frontend | Code complete | Arogya branding, doctor patient portal, literature chatbot |
| CI workflow | Written | Gitleaks, Bandit, Trivy, Helm lint |
| CD workflow | Written | OIDC push to ECR + Docker Hub, prod manual gate |

### arogya-infra — All Terraform written, pushed to GitHub
| Module | Status | Notes |
|--------|--------|-------|
| bootstrap | Written | S3 + DynamoDB for remote state — **run this first locally** |
| vpc | Written | VPC, public/private subnets, NAT gateway |
| eks | Written | EKS 1.30, managed node groups, OIDC provider |
| ecr | Written | 7 ECR repos with lifecycle policies |
| rds | Written | PostgreSQL 17.4, private subnet, random password |
| sqs | Written | RAG queue + appointment queue, both with DLQs + KMS |
| security | Written | KMS, Secrets Manager (DB/JWT/Groq), SSM params, Bedrock Guardrail, S3 docs bucket |
| irsa | Written | Per-service IAM roles, least-privilege policies |
| monitoring | Written | CloudWatch alarms, SNS, AIOps Lambda |
| Terraform pipeline | Written | OIDC federation, plan on PR, apply prod with manual approval |

### arogya-gitops — All Helm/ArgoCD written, pushed to GitHub
| Component | Status | Notes |
|-----------|--------|-------|
| Helm chart | Written | All 7 services + rag-worker |
| KGateway HTTPRoutes | Written | JWT policy, /rag route, /api/* routes |
| KEDA ScaledObject | Written | rag-worker scales 0–5 on SQS depth |
| ArgoCD app manifests | Written | prod environment |

---

## What Is NOT Done (Deployment Phase)

Everything below requires actual AWS execution — nothing here is just code.

---

## Phase 0 — One-Time Local Setup (Do First)

These are done **once from your local machine**, never repeated.

### 0A. Generate RSA key pair for JWT
```powershell
# Run in terminal — generates the keys needed for user-service JWT
ssh-keygen -t rsa -b 4096 -m PEM -f arogya_jwt -N ""
# arogya_jwt      = private key (goes to Secrets Manager)
# arogya_jwt.pub  = public key  (goes to Secrets Manager)
```
Store both in GitHub Actions secrets (`TF_VAR_jwt_private_key`, `TF_VAR_jwt_public_key`).

### 0B. Get a Groq API key
- Go to console.groq.com → free account → API Keys → Create
- Store as GitHub Actions secret: `TF_VAR_groq_api_key`

### 0C. Create GitHub Actions IAM role (chicken-and-egg fix)
The Terraform pipeline needs an IAM role to run — but that role is created by Terraform.
Fix: create it **manually once** via AWS CLI before the first pipeline run.

```powershell
# This creates the OIDC provider + role that lets GitHub Actions run Terraform
# Run this from your local machine (you already have AWS credentials configured)
# (Claude can run this for you — just say the word)
```

### 0D. Run bootstrap Terraform (local, one-time)
```powershell
cd arogya-infra/bootstrap
terraform init
terraform apply   # creates S3 bucket + DynamoDB table for state
```

### 0E. Set up GitHub secrets
Add to **arogya-app** repo (Settings → Secrets → Actions):
- `AWS_ACCOUNT_ID` = `371454942267`
- `AWS_REGION` = `us-east-1`
- `DOCKERHUB_USERNAME` = your Docker Hub username
- `DOCKERHUB_TOKEN` = Docker Hub access token
- `GITOPS_DEPLOY_KEY` = GitHub PAT with write access to arogya-gitops

Add to **arogya-infra** repo:
- `AWS_ACCOUNT_ID` = `371454942267`
- `AWS_REGION` = `us-east-1`
- `TF_VAR_groq_api_key` = Groq key
- `TF_VAR_jwt_private_key` = RSA private key PEM
- `TF_VAR_jwt_public_key` = RSA public key PEM

### 0F. Set up GitHub Environments
On **arogya-app** and **arogya-infra** → Settings → Environments:
- Create `prod` → add `neerajb03` as required reviewer

### 0G. Create `develop` branch + branch protection
- Push `develop` branch to all three repos
- Protect `main`: require PR, require CI to pass, no direct push
- Protect `develop`: require PR, no direct push

---

## Phase 1 — Provision AWS Infrastructure

### 1A. Trigger Terraform pipeline
- Open a PR from `develop` → `main` on `arogya-infra`
- Pipeline runs `terraform plan` and posts it as a PR comment
- Review the plan, merge PR
- Pipeline pauses for **manual approval** (you approve in GitHub)
- `terraform apply` runs — creates everything:

```
VPC → EKS cluster → RDS (PostgreSQL) → SQS queues → ECR repos
   → KMS key → Secrets Manager secrets → SSM parameters
   → Bedrock Guardrail → S3 documents bucket → IRSA roles
   → CloudWatch alarms → SNS topic → AIOps Lambda
```
Estimated time: ~20–25 minutes.

### 1B. Verify infrastructure
```powershell
aws eks list-clusters
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
aws sqs list-queues
aws ecr describe-repositories
```

---

## Phase 2 — Build & Push Docker Images

### 2A. Trigger CD pipeline
- Merge any change into `main` on `arogya-app`
- Pipeline builds all 7 images and pushes to ECR + Docker Hub
- Then pauses for prod approval → you approve → ArgoCD sync begins

### 2B. Verify images in ECR
```powershell
aws ecr list-images --repository-name arogya/user-service
```

---

## Phase 3 — Kubernetes Cluster Setup (One-Time)

After EKS is up, these tools are installed into the cluster **once**. They are not managed by ArgoCD — they are prerequisites.

### 3A. Connect to EKS
```powershell
aws eks update-kubeconfig --name arogya-prod-eks --region us-east-1
kubectl get nodes
```

### 3B. Install KGateway (Envoy Gateway)
```powershell
helm repo add envoy-gateway https://charts.envoyproxy.io
helm install eg envoy-gateway/gateway-helm --version v1.2.0 -n envoy-gateway-system --create-namespace
```

### 3C. Install KEDA
```powershell
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace
```

### 3D. Install ArgoCD
```powershell
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# Wait for pods
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=argocd-server -n argocd --timeout=120s
```

### 3E. Apply ArgoCD Application manifest
```powershell
kubectl apply -f arogya-gitops/argocd/app-prod.yaml
```
ArgoCD will now watch `arogya-gitops` and sync all Helm resources to the cluster.

---

## Phase 4 — Database Setup (One-Time)

### 4A. Enable pgvector extension on RDS
```sql
-- Connect to RDS and run:
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE document_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    patient_id  UUID NOT NULL,
    chunk_index INT NOT NULL,
    content     TEXT NOT NULL,
    embedding   vector(1024),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 4B. Run Alembic migrations (for all services)
Each service with a DB (user, appointment, health, document) needs its Alembic migrations run against RDS:
```powershell
# Run once per service via a K8s Job or kubectl exec
kubectl exec -it deploy/user-service -n arogya-prod -- alembic upgrade head
kubectl exec -it deploy/appointment-service -n arogya-prod -- alembic upgrade head
kubectl exec -it deploy/health-service -n arogya-prod -- alembic upgrade head
kubectl exec -it deploy/document-service -n arogya-prod -- alembic upgrade head
```

### 4C. Verify SES email identity
- AWS Console → SES → Verified identities
- Check `neerajbalamurali@gmail.com` is verified (you'll get a verification email)

---

## Phase 5 — Domain & HTTPS (Route 53 + ACM)

### 5A. Register or transfer a domain
Options (cheapest first):
- `.xyz` domain: ~$1/year on Route 53 (e.g., `arogyahealth.xyz`)
- `.com` domain: ~$12/year
- Use a free subdomain from a service like `nip.io` for demo only

### 5B. Create hosted zone in Route 53
```powershell
aws route53 create-hosted-zone --name arogyahealth.xyz --caller-reference arogya-$(Get-Date -Format yyyyMMddHHmmss)
```

### 5C. Request SSL certificate (ACM)
```powershell
aws acm request-certificate --domain-name arogyahealth.xyz --subject-alternative-names "*.arogyahealth.xyz" --validation-method DNS
```
Then add the DNS validation CNAME record to your Route 53 hosted zone.

### 5D. Get the KGateway Load Balancer hostname
```powershell
kubectl get svc -n envoy-gateway-system
# Note the EXTERNAL-IP / hostname of the LoadBalancer
```

### 5E. Create Route 53 alias record
- Point `arogyahealth.xyz` → ALB hostname (A record alias)
- Point `www.arogyahealth.xyz` → same ALB

### 5F. Update KGateway to use HTTPS + ACM cert
Add TLS listener to `gateway.yaml` with the ACM certificate ARN.

---

## Phase 6 — Verification & Demo Prep

### 6A. End-to-end smoke test
- [ ] Register as doctor → login → JWT issued
- [ ] Register as patient → login
- [ ] Doctor books appointment with patient
- [ ] Patient uploads a PDF document → status goes PROCESSING → COMPLETED
- [ ] Patient asks AI chatbot about their document → answer with citations
- [ ] Doctor opens patient detail page → sees records + AI assistant
- [ ] Doctor uses literature chatbot → PubMed results with PMID links
- [ ] Doctor asks hybrid query → both patient records + literature cited

### 6B. Test KEDA autoscaling
- Upload 10 documents rapidly
- `kubectl get pods -n arogya-prod -w` — watch rag-worker scale up

### 6C. Trigger AIOps Lambda
- Manually put a CloudWatch alarm into ALARM state → check ops email for AI diagnosis

### 6D. Demo the manual approval gate
- Make a small code change → push to main → show GitHub pausing for approval → approve → show ArgoCD syncing

---

## Deferred Features (Implement Before Final Presentation)

See `memory/project_pending_features.md` for full details.

| Feature | Effort | When |
|---------|--------|------|
| GuardDuty + Security Hub | ~3 Terraform resources | Enable 30 days before presentation (free trial) |
| WAF | ~20 lines Terraform | If budget allows |
| Appointment Reminder Lambda | ~80 lines Python | Good demo feature — before presentation |
| Comprehend Medical enrichment | Medium | If time allows |

---

## Cost Estimate (Prod Only, us-east-1)

| Service | Approx monthly |
|---------|---------------|
| EKS cluster | ~$73 (control plane) |
| EC2 nodes (2× t3.small) | ~$30 |
| RDS db.t3.micro | ~$15 |
| NAT Gateway | ~$35 |
| SQS, SNS, CloudWatch | ~$2 |
| Bedrock (Nova Lite, Titan) | Pay per use — light demo usage ~$5 |
| S3, ECR | ~$2 |
| Secrets Manager (3 secrets) | ~$1.20 |
| **Total** | **~$165/month** |

> Tear down the EKS cluster when not presenting to avoid the ~$100/month compute cost.
> `terraform destroy` takes ~15 minutes and can be re-applied in ~25 minutes before demo.

---

## Immediate Next Steps (In Order)

1. **Generate RSA key pair** — Claude can run this in terminal
2. **Get Groq API key** — console.groq.com (2 minutes, free)
3. **Create GitHub Actions IAM role manually** — Claude can run the AWS CLI commands
4. **Run bootstrap Terraform** — Claude can run this in terminal
5. **Add GitHub secrets** — you do this in the browser
6. **Set up GitHub Environments** — you do this in the browser
7. **Create develop branch + branch protection** — Claude can do this from terminal
8. **Trigger Terraform pipeline** — open a PR, watch it plan, approve, apply
9. **Install cluster tools** — KGateway, KEDA, ArgoCD
10. **Run DB migrations**
11. **Domain + Route 53 setup**
12. **Full smoke test**
