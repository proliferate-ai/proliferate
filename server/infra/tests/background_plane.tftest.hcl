# Plan-time proof for the background-plane fail-closed contract (BG4-IAC-02).
#
# The worker/Beat services must never be created without a reachable broker and
# scheduler store. `background_services_enabled = true` is only valid when either
# the managed stage is on (background_broker_enabled = true, which creates the
# broker/store and their secrets) OR both external endpoint secret ARNs are
# supplied (a founder rebind to already-operated managed endpoints). The invalid
# partial combo — services on, broker off, no external secrets — would register
# task definitions with empty `secrets` and silently fall back to loopback, so a
# variable validation on background_services_enabled must reject it AT PLAN TIME.
#
# Runs use `command = plan` with a mocked AWS provider, so no AWS credentials,
# API calls, backend, or apply are involved. Terraform still evaluates variable
# validations against the supplied values during plan, which is exactly the gate
# under test.

mock_provider "aws" {
  # The default AWS mock returns empty values for these data sources, which the
  # managed path indexes/slices (subnets) or embeds as policy JSON. Supply
  # minimal well-formed values so the VALID plans reach a real plan; the invalid
  # runs fail earlier on the variable validation regardless.
  mock_data "aws_subnets" {
    defaults = {
      ids = ["subnet-aaaa1111", "subnet-bbbb2222"]
    }
  }
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

variables {
  # Required root variables (no defaults in main.tf). Values are throwaway; the
  # mocked provider never contacts AWS.
  db_password = "test-db-password"
  jwt_secret  = "test-jwt-secret"
}

# Valid: managed stage on. The broker/store and their TF-managed connection
# secrets are created, so the services have real endpoints to reach.
run "valid_managed_plane" {
  command = plan
  variables {
    background_broker_enabled   = true
    background_services_enabled = true
    # Satisfies the aws provider's client-side RabbitMQ password constraint
    # (12-250 chars, >= 4 unique). Checked during plan; no AWS call.
    background_broker_password = "test-broker-password-123"
  }
}

# Valid: rebound to existing external endpoints. Broker stage off, but BOTH
# override secret ARNs are supplied, so the worker/Beat consume the founder's
# already-operated broker/store.
run "valid_rebound_external" {
  command = plan
  variables {
    background_broker_enabled    = false
    background_services_enabled  = true
    celery_broker_url_secret_arn = "arn:aws:secretsmanager:us-east-1:111122223333:secret:existing-broker"
    redbeat_redis_url_secret_arn = "arn:aws:secretsmanager:us-east-1:111122223333:secret:existing-store"
  }
}

# Invalid: services on, broker off, no external secrets. This is the partial
# combo that would create services with no connection secrets. It must fail at
# plan time on the background_services_enabled validation.
run "invalid_partial_no_secrets_fails" {
  command = plan
  variables {
    background_broker_enabled   = false
    background_services_enabled = true
  }
  expect_failures = [
    var.background_services_enabled,
  ]
}

# Invalid: services on, broker off, only ONE external secret supplied. A single
# reference is still a broken plane (the other URL falls back to loopback), so
# this must also fail at plan time.
run "invalid_partial_one_secret_fails" {
  command = plan
  variables {
    background_broker_enabled    = false
    background_services_enabled  = true
    celery_broker_url_secret_arn = "arn:aws:secretsmanager:us-east-1:111122223333:secret:existing-broker"
  }
  expect_failures = [
    var.background_services_enabled,
  ]
}
