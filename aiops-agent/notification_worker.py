import json
import os
import boto3
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ses = boto3.client("ses", region_name=os.environ.get("AWS_REGION", "us-east-1"))
SES_SENDER_EMAIL = os.environ["SES_SENDER_EMAIL"]
ENVIRONMENT = os.environ.get("ENVIRONMENT", "prod")


def lambda_handler(event, context):
    for record in event["Records"]:
        try:
            body = json.loads(record["body"])
            appointment_id = body.get("appointment_id")
            user_email = body.get("user_email", SES_SENDER_EMAIL)
            status = body.get("status")

            subjects = {
                "pending":   "Arogya — Appointment Requested",
                "accepted":  "Arogya — Appointment Accepted!",
                "completed": "Arogya — Appointment Completed",
                "denied":    "Arogya — Appointment Update",
            }
            messages = {
                "pending":   f"Your appointment (ID: {appointment_id}) has been requested and is pending approval.",
                "accepted":  f"Great news! Your appointment (ID: {appointment_id}) has been accepted by the doctor.",
                "completed": f"Your appointment (ID: {appointment_id}) is complete. Records are available on the Arogya portal.",
                "denied":    f"Your appointment request (ID: {appointment_id}) could not be accepted. Please reschedule.",
            }

            subject = subjects.get(status, f"Arogya — Appointment {appointment_id} Update")
            message = messages.get(status, f"Your appointment {appointment_id} status changed to: {status}")

            ses.send_email(
                Source=SES_SENDER_EMAIL,
                Destination={"ToAddresses": [user_email]},
                Message={
                    "Subject": {"Data": subject},
                    "Body": {"Text": {"Data": message}},
                },
            )

            logger.info("Notification sent", extra={
                "appointment_id": appointment_id,
                "status": status,
                "message_id": record["messageId"],
            })

        except Exception as e:
            logger.error(f"Failed to process SQS record: {e}", extra={
                "message_id": record.get("messageId"),
            })
            raise
