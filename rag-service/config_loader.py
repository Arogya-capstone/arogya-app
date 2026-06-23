"""
Config loader — fetches all runtime configuration at pod startup and caches it.

Pattern:
  SSM Parameter Store  → non-sensitive infra config (bucket names, queue URLs,
                          Bedrock model IDs, guardrail ID, RDS endpoint)
  Secrets Manager      → sensitive secrets only (DB password, JWT keys)

Why two stores:
  SSM standard parameters are free and Terraform-owned (no ignore_changes needed).
  Secrets Manager costs $0.40/secret/month and is for values that need rotation,
  audit trails, and encryption — i.e. actual secrets, not config.
"""
import json
import os
import boto3

_cache: dict = {}


def load_config() -> dict:
    global _cache
    if _cache:
        return _cache

    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    # ENV is injected by Helm as the only static env var
    env = os.environ.get("APP_ENV", "dev")
    ssm_prefix = f"/arogya/{env}"

    ssm = boto3.client("ssm", region_name=region)
    sm  = boto3.client("secretsmanager", region_name=region)

    # ── 1. SSM: all infra config in one paginated call ────────────────────────
    paginator = ssm.get_paginator("get_parameters_by_path")
    for page in paginator.paginate(Path=ssm_prefix, Recursive=True, WithDecryption=False):
        for param in page["Parameters"]:
            # /arogya/dev/s3-bucket-name → S3_BUCKET_NAME
            key = param["Name"].replace(f"{ssm_prefix}/", "").upper().replace("-", "_")
            _cache[key] = param["Value"]

    # ── 2. Secrets Manager: sensitive values only ─────────────────────────────
    sensitive = {
        "DB_CREDENTIALS": f"arogya/{env}/db-credentials",
        "JWT_PRIVATE_KEY": f"arogya/{env}/jwt-private-key",
        "JWT_PUBLIC_KEY":  f"arogya/{env}/jwt-public-key",
    }
    for cache_key, secret_name in sensitive.items():
        try:
            resp  = sm.get_secret_value(SecretId=secret_name)
            value = resp["SecretString"]
            try:
                # JSON blob (e.g. db-credentials) → merge all keys
                _cache.update(json.loads(value))
            except json.JSONDecodeError:
                # Plain string (PEM key) → store under the key name
                _cache[cache_key] = value
        except Exception as e:
            print(f"Warning: could not load secret {secret_name}: {e}")

    return _cache


def get(key: str, default=None):
    return load_config().get(key, default)
