import json
import os
import boto3
from datetime import datetime, timedelta, timezone

logs_client = boto3.client("logs", region_name=os.environ["REGION"])
bedrock_client = boto3.client("bedrock-runtime", region_name=os.environ["REGION"])
sns_client = boto3.client("sns", region_name=os.environ["REGION"])

SNS_TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]
PROJECT = os.environ["PROJECT"]
ENVIRONMENT = os.environ["ENVIRONMENT"]
REGION = os.environ["REGION"]


def _fetch_recent_logs(log_group: str, minutes: int = 10) -> str:
    """Pull the last `minutes` worth of log events from a CloudWatch log group."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes)

    try:
        resp = logs_client.filter_log_events(
            logGroupName=log_group,
            startTime=int(start.timestamp() * 1000),
            endTime=int(end.timestamp() * 1000),
            limit=100,
        )
        events = resp.get("events", [])
        if not events:
            return "No log events found in the last 10 minutes."
        return "\n".join(e["message"] for e in events[-50:])  # last 50 lines
    except Exception as e:
        return f"Could not retrieve logs: {e}"


def _diagnose_with_bedrock(alarm_name: str, service: str, logs: str) -> str:
    """Ask Bedrock Nova Lite to diagnose the issue from the logs."""
    prompt = f"""You are a senior DevOps and cloud engineer. A CloudWatch alarm has fired in production.

Alarm: {alarm_name}
Service: {service}
Environment: {ENVIRONMENT}
Project: {PROJECT}

Recent logs from the affected service:
---
{logs}
---

Provide a concise diagnosis in this exact format:
ROOT CAUSE: <one sentence>
SEVERITY: <LOW | MEDIUM | HIGH | CRITICAL>
RECOMMENDED ACTIONS:
- <action 1>
- <action 2>
- <action 3>"""

    body = json.dumps({
        "messages": [{"role": "user", "content": prompt}],
        "inferenceConfig": {"maxTokens": 512, "temperature": 0.1},
    })

    try:
        response = bedrock_client.invoke_model(
            modelId="amazon.nova-lite-v1:0",
            contentType="application/json",
            accept="application/json",
            body=body,
        )
        result = json.loads(response["body"].read())
        return result["output"]["message"]["content"][0]["text"]
    except Exception as e:
        return f"AI diagnosis unavailable: {e}"


def _infer_service_and_log_group(alarm_name: str) -> tuple[str, str]:
    """Map alarm name to service name and its CloudWatch log group."""
    if "rag-dlq" in alarm_name:
        return "rag-worker", f"/{PROJECT}/{ENVIRONMENT}/rag-worker"
    if "appointment-dlq" in alarm_name:
        return "appointment-service", f"/{PROJECT}/{ENVIRONMENT}/appointment-service"
    if "user-service" in alarm_name:
        return "user-service", f"/{PROJECT}/{ENVIRONMENT}/user-service"
    if "health-service" in alarm_name:
        return "health-service", f"/{PROJECT}/{ENVIRONMENT}/health-service"
    if "document-service" in alarm_name:
        return "document-service", f"/{PROJECT}/{ENVIRONMENT}/document-service"
    if "rag-service" in alarm_name:
        return "rag-service", f"/{PROJECT}/{ENVIRONMENT}/rag-service"
    return "unknown", f"/{PROJECT}/{ENVIRONMENT}/rag-worker"


def lambda_handler(event, context):
    for record in event.get("Records", []):
        sns_message = json.loads(record["Sns"]["Message"])
        alarm_name = sns_message.get("AlarmName", "unknown-alarm")
        alarm_state = sns_message.get("NewStateValue", "ALARM")
        alarm_reason = sns_message.get("NewStateReason", "")
        timestamp = sns_message.get("StateChangeTime", datetime.now(timezone.utc).isoformat())

        # Skip if alarm is returning to OK — only diagnose actual alarms
        if alarm_state == "OK":
            print(f"Alarm {alarm_name} returned to OK — no diagnosis needed")
            continue

        service, log_group = _infer_service_and_log_group(alarm_name)
        logs = _fetch_recent_logs(log_group)
        diagnosis = _diagnose_with_bedrock(alarm_name, service, logs)

        subject = f"[{ENVIRONMENT.upper()}] AIOps Alert: {alarm_name}"
        message = f"""🚨 ALARM FIRED — AI Diagnosis Ready

Project:     {PROJECT}
Environment: {ENVIRONMENT}
Alarm:       {alarm_name}
Service:     {service}
Time:        {timestamp}
Trigger:     {alarm_reason}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AI DIAGNOSIS (Bedrock Nova Lite)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{diagnosis}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RAW LOG SAMPLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{logs[:1000]}
...

CloudWatch: https://{REGION}.console.aws.amazon.com/cloudwatch/home?region={REGION}#alarmsV2:alarm/{alarm_name}
"""

        sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=subject,
            Message=message,
        )
        print(f"AIOps diagnosis published for alarm: {alarm_name}")

    return {"statusCode": 200, "body": "AIOps diagnosis complete"}
