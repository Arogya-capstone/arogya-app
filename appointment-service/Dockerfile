FROM public.ecr.aws/docker/library/python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM public.ecr.aws/docker/library/python:3.11-slim
WORKDIR /app
COPY --from=builder /usr/local /usr/local
COPY . .
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
