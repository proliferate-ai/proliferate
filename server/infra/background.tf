# ═══════════════════════════════════════════════════════════════════════
# Durable background runtime: broker (Amazon MQ RabbitMQ), scheduler store
# (ElastiCache Serverless Valkey), and the Celery worker + Beat ECS services.
#
# These are DEFINITIONS ONLY. Both stages gate on a count flag defaulting to
# false so a plan against an existing environment is a no-op until the founder
# enables the plane (or rebinds the worker/beat to already-operated managed
# endpoints via the *_secret_arn overrides). All broker/store traffic is TLS:
# Amazon MQ RabbitMQ exposes AMQPS (5671) only, and ElastiCache Serverless
# enforces in-transit encryption (rediss). Staging and production isolate on
# var.environment naming and their own broker/store instances.
# ═══════════════════════════════════════════════════════════════════════

variable "background_broker_enabled" {
  description = "Create the Amazon MQ broker + ElastiCache Serverless store for this environment."
  type        = bool
  default     = false
}

variable "background_services_enabled" {
  description = "Create the Celery worker + Beat ECS services and their alarms."
  type        = bool
  default     = false

  # Fail closed at plan time on the invalid partial combo. A services-enabled
  # plane MUST have connection secrets, and there are exactly two valid ways to
  # get them: (a) the managed stage (background_broker_enabled = true) creates
  # the broker/store and their TF-managed secrets, or (b) the founder rebinds to
  # existing external endpoints by supplying BOTH override secret ARNs. Enabling
  # the services while the broker is disabled AND no external secret ARNs are
  # set would register worker/Beat task definitions with empty `secrets`, so the
  # app would silently fall back to its loopback CELERY_BROKER_URL/REDBEAT_REDIS
  # defaults and never reach any broker/store. Reject that combination here so it
  # can never reach an apply. This validation references other input variables,
  # which Terraform >= 1.9 evaluates during plan.
  validation {
    condition = (
      var.background_services_enabled == false
      || var.background_broker_enabled == true
      || (var.celery_broker_url_secret_arn != "" && var.redbeat_redis_url_secret_arn != "")
    )
    error_message = "background_services_enabled = true requires either the managed stage (background_broker_enabled = true) OR both external endpoint references (celery_broker_url_secret_arn and redbeat_redis_url_secret_arn). Enabling the worker/Beat services without connection secrets would create services that fall back to loopback and cannot reach any broker/store."
  }
}

variable "background_broker_user" {
  description = "RabbitMQ application username for Amazon MQ."
  type        = string
  default     = "proliferate"
}

variable "background_broker_password" {
  description = "RabbitMQ application password for Amazon MQ (12-250 chars, no spaces)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "background_broker_instance_type" {
  description = "Amazon MQ RabbitMQ host instance type."
  type        = string
  default     = "mq.t3.micro"
}

variable "background_broker_deployment_mode" {
  description = "SINGLE_INSTANCE (staging) or CLUSTER_MULTI_AZ (production)."
  type        = string
  default     = "SINGLE_INSTANCE"
}

variable "background_store_max_ecpu" {
  description = "ElastiCache Serverless ECPU-per-second ceiling for the scheduler store."
  type        = number
  default     = 5000
}

variable "background_store_max_storage_gb" {
  description = "ElastiCache Serverless data storage ceiling (GB) for the scheduler store."
  type        = number
  default     = 5
}

# Founder rebind hooks: when set, the worker/beat consume these existing secret
# references instead of the TF-created broker/store URLs. Each must resolve to a
# full amqps:// / rediss:// URL in Secrets Manager or SSM.
variable "celery_broker_url_secret_arn" {
  description = "Override: existing CELERY_BROKER_URL secret ARN."
  type        = string
  default     = ""
}

variable "redbeat_redis_url_secret_arn" {
  description = "Override: existing REDBEAT_REDIS_URL secret ARN."
  type        = string
  default     = ""
}

# Optional Cloud-provider pair for the background plane. The API key reference
# is a base Secrets Manager ARN for a JSON record containing E2B_API_KEY; ECS
# performs the field projection at task start, so the key is never a plaintext
# task-definition environment value or Terraform input. Supplying exactly one
# half is rejected when the services are enabled.
variable "background_e2b_api_key_secret_arn" {
  description = "Base Secrets Manager ARN whose E2B_API_KEY field the worker and Beat resolve."
  type        = string
  default     = ""

  validation {
    condition = (
      var.background_services_enabled == false
      || (
        var.background_e2b_api_key_secret_arn == ""
        && var.background_e2b_template_name == ""
      )
      || (
        can(regex("^arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:[^:]+$", var.background_e2b_api_key_secret_arn))
        && var.background_e2b_template_name != ""
      )
    )
    error_message = "Background E2B configuration must be absent as a pair or use a base Secrets Manager ARN plus a non-empty background_e2b_template_name; partial or field-projected inputs are rejected."
  }
}

variable "background_e2b_template_name" {
  description = "Non-secret E2B template ref supplied to the worker and Beat with the API-key secret."
  type        = string
  default     = ""
}

variable "background_worker_desired_count" {
  description = "Celery worker replica count (horizontally scalable)."
  type        = number
  default     = 1
}

variable "background_worker_queues" {
  description = "Comma-separated queues the worker consumes."
  type        = string
  default     = "periodic.default,default,notifications"
}

variable "background_relay_oldest_due_slo_seconds" {
  description = "Alarm threshold for oldest due-but-unpublished outbox age (5-minute reviewable default)."
  type        = number
  default     = 300
}

variable "background_alarm_sns_topic_arn" {
  description = "Optional SNS topic to notify on background-plane alarms."
  type        = string
  default     = ""
}

# ── Security groups ──

resource "aws_security_group" "background_broker" {
  count       = var.background_broker_enabled ? 1 : 0
  name_prefix = "proliferate-mq-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "AMQPS from ECS tasks"
    from_port       = 5671
    to_port         = 5671
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "proliferate-mq-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_security_group" "background_store" {
  count       = var.background_broker_enabled ? 1 : 0
  name_prefix = "proliferate-redbeat-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Valkey/Redis TLS from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "proliferate-redbeat-${var.environment}"
    Environment = var.environment
  }
}

# ── Amazon MQ (RabbitMQ) broker ──

resource "aws_mq_broker" "background" {
  count = var.background_broker_enabled ? 1 : 0

  broker_name        = "proliferate-${var.environment}"
  engine_type        = "RabbitMQ"
  engine_version     = "3.13"
  host_instance_type = var.background_broker_instance_type
  deployment_mode    = var.background_broker_deployment_mode
  # Private only; reachable via the ECS security group over AMQPS. Amazon MQ
  # RabbitMQ terminates TLS on 5671 with no plaintext AMQP listener.
  publicly_accessible        = false
  auto_minor_version_upgrade = true
  # SINGLE_INSTANCE takes exactly one subnet; CLUSTER_MULTI_AZ takes several.
  subnet_ids = (
    var.background_broker_deployment_mode == "SINGLE_INSTANCE"
    ? [tolist(data.aws_subnets.default.ids)[0]]
    : slice(tolist(data.aws_subnets.default.ids), 0, 2)
  )
  security_groups = [aws_security_group.background_broker[0].id]

  user {
    username = var.background_broker_user
    password = var.background_broker_password
  }

  logs {
    general = true
  }

  tags = {
    Name        = "proliferate-${var.environment}"
    Environment = var.environment
  }
}

# ── ElastiCache Serverless (Valkey) scheduler store ──

resource "aws_elasticache_serverless_cache" "redbeat" {
  count = var.background_broker_enabled ? 1 : 0

  engine = "valkey"
  name   = "proliferate-redbeat-${var.environment}"

  cache_usage_limits {
    data_storage {
      maximum = var.background_store_max_storage_gb
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = var.background_store_max_ecpu
    }
  }

  major_engine_version = "8"
  security_group_ids   = [aws_security_group.background_store[0].id]
  subnet_ids           = slice(tolist(data.aws_subnets.default.ids), 0, 2)

  tags = {
    Name        = "proliferate-redbeat-${var.environment}"
    Environment = var.environment
  }
}

# ── Connection secrets ──
#
# The full broker/store URLs carry credentials, so they are projected to the
# worker/beat exclusively as ECS secrets (never plaintext environment). When the
# founder rebinds to an existing endpoint via *_secret_arn, these TF-managed
# secrets are not created.

resource "aws_secretsmanager_secret" "celery_broker_url" {
  count = var.background_broker_enabled && var.celery_broker_url_secret_arn == "" ? 1 : 0
  name  = "proliferate/${var.environment}/background/celery-broker-url"

  tags = {
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "celery_broker_url" {
  count     = var.background_broker_enabled && var.celery_broker_url_secret_arn == "" ? 1 : 0
  secret_id = aws_secretsmanager_secret.celery_broker_url[0].id
  # Inject credentials into the amqps endpoint Amazon MQ publishes.
  secret_string = replace(
    aws_mq_broker.background[0].instances[0].endpoints[0],
    "amqps://",
    "amqps://${var.background_broker_user}:${var.background_broker_password}@"
  )
}

resource "aws_secretsmanager_secret" "redbeat_redis_url" {
  count = var.background_broker_enabled && var.redbeat_redis_url_secret_arn == "" ? 1 : 0
  name  = "proliferate/${var.environment}/background/redbeat-redis-url"

  tags = {
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "redbeat_redis_url" {
  count     = var.background_broker_enabled && var.redbeat_redis_url_secret_arn == "" ? 1 : 0
  secret_id = aws_secretsmanager_secret.redbeat_redis_url[0].id
  secret_string = format(
    "rediss://%s:%s/0",
    aws_elasticache_serverless_cache.redbeat[0].endpoint[0].address,
    aws_elasticache_serverless_cache.redbeat[0].endpoint[0].port,
  )
}

locals {
  celery_broker_url_secret_arn = (
    var.celery_broker_url_secret_arn != ""
    ? var.celery_broker_url_secret_arn
    : (var.background_broker_enabled ? aws_secretsmanager_secret.celery_broker_url[0].arn : "")
  )
  redbeat_redis_url_secret_arn = (
    var.redbeat_redis_url_secret_arn != ""
    ? var.redbeat_redis_url_secret_arn
    : (var.background_broker_enabled ? aws_secretsmanager_secret.redbeat_redis_url[0].arn : "")
  )
  background_connection_secret_arns = compact([
    local.celery_broker_url_secret_arn,
    local.redbeat_redis_url_secret_arn,
    var.background_e2b_api_key_secret_arn,
  ])
  # Shared with API so worker/beat reach the same Postgres outbox.
  background_database_url = "postgresql+asyncpg://proliferate:${var.db_password}@${aws_db_instance.postgres.endpoint}/proliferate"
  background_common_environment = concat(
    [
      { name = "DATABASE_URL", value = local.background_database_url },
      { name = "JWT_SECRET", value = var.jwt_secret },
      { name = "PROLIFERATE_TELEMETRY_MODE", value = var.telemetry_mode },
      { name = "BACKGROUND_RELAY_OLDEST_DUE_SLO_SECONDS", value = tostring(var.background_relay_oldest_due_slo_seconds) },
    ],
    var.background_e2b_template_name == "" ? [] : [
      { name = "E2B_TEMPLATE_NAME", value = var.background_e2b_template_name },
    ],
  )
  background_connection_secrets = concat(
    local.celery_broker_url_secret_arn == "" ? [] : [
      { name = "CELERY_BROKER_URL", valueFrom = local.celery_broker_url_secret_arn }
    ],
    local.redbeat_redis_url_secret_arn == "" ? [] : [
      { name = "REDBEAT_REDIS_URL", valueFrom = local.redbeat_redis_url_secret_arn }
    ],
    var.background_e2b_api_key_secret_arn == "" ? [] : [
      {
        name      = "E2B_API_KEY"
        valueFrom = "${var.background_e2b_api_key_secret_arn}:E2B_API_KEY::"
      }
    ],
  )
  # Whether the plane has connection secrets, decided from KNOWN inputs only.
  # The managed stage always creates both secrets; a rebind supplies external
  # ARNs. The background_services_enabled validation guarantees at least one of
  # these is true whenever the services exist, so this is effectively always
  # true for an enabled plane. Gating the IAM policy count on this (rather than
  # length() of the computed ARN list) keeps the count predictable at plan time:
  # a count that depended on a not-yet-created secret ARN could not be planned.
  background_has_connection_secrets = (
    var.background_broker_enabled
    || var.celery_broker_url_secret_arn != ""
    || var.redbeat_redis_url_secret_arn != ""
  )
}

# Allow the ECS execution role to resolve the connection secrets at task start.
data "aws_iam_policy_document" "background_connection_secrets" {
  count = var.background_services_enabled && local.background_has_connection_secrets ? 1 : 0

  statement {
    actions   = ["secretsmanager:GetSecretValue", "ssm:GetParameters"]
    resources = local.background_connection_secret_arns
  }
}

resource "aws_iam_role_policy" "background_connection_secrets" {
  count  = var.background_services_enabled && local.background_has_connection_secrets ? 1 : 0
  name   = "background-connection-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.background_connection_secrets[0].json
}

# ── Worker + Beat task definitions (same image as the API) ──

resource "aws_ecs_task_definition" "background_worker" {
  count                    = var.background_services_enabled ? 1 : 0
  family                   = "proliferate-worker-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${aws_ecr_repository.server.repository_url}:latest"
      essential = true
      command = [
        "celery", "-A", "proliferate.background.celery_app:celery_app",
        "worker", "--loglevel=info", "-Q", var.background_worker_queues,
      ]
      environment = concat(local.background_common_environment, [
        { name = "CELERY_WORKER_QUEUES", value = var.background_worker_queues },
      ])
      secrets = local.background_connection_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "background_beat" {
  count                    = var.background_services_enabled ? 1 : 0
  family                   = "proliferate-beat-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "beat"
      image     = "${aws_ecr_repository.server.repository_url}:latest"
      essential = true
      command = [
        "celery", "-A", "proliferate.background.celery_app:celery_app",
        "beat", "--loglevel=info",
      ]
      environment = local.background_common_environment
      secrets     = local.background_connection_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "beat"
        }
      }
    }
  ])
}

# ── Worker + Beat services ──

resource "aws_ecs_service" "background_worker" {
  count           = var.background_services_enabled ? 1 : 0
  name            = "proliferate-worker-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.background_worker[0].arn
  desired_count   = var.background_worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }
}

resource "aws_ecs_service" "background_beat" {
  count           = var.background_services_enabled ? 1 : 0
  name            = "proliferate-beat-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.background_beat[0].arn
  # Exactly one Beat scheduler per environment. RedBeat holds schedule state in
  # the store and prevents duplicate ownership.
  desired_count = 1
  launch_type   = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }
}

# ── Metrics + alarms ──
#
# The relay task logs one low-cardinality metric line per tick under the field
# `background_relay`. A CloudWatch metric filter lifts the oldest-due age and the
# failed count into custom metrics that the SLO and repeated-failure alarms
# watch. Worker/Beat liveness rides on the ECS RunningTaskCount metric.

resource "aws_cloudwatch_log_metric_filter" "background_oldest_due_age" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-outbox-oldest-due-age"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_relay.oldest_due_pending_age_seconds = * }"

  metric_transformation {
    name          = "OutboxOldestDuePendingAgeSeconds"
    namespace     = "Proliferate/Background/${var.environment}"
    value         = "$.background_relay.oldest_due_pending_age_seconds"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "background_relay_failed" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-relay-failed"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_relay.failed = * }"

  metric_transformation {
    name          = "RelayFailedCount"
    namespace     = "Proliferate/Background/${var.environment}"
    value         = "$.background_relay.failed"
    default_value = "0"
  }
}

# Direct scheduler-store / relay liveness. Every completed relay tick logs
# `relay_heartbeat=1`; a tick only runs when Beat dispatches it, which requires
# RedBeat/Valkey to be reachable. So a steady heartbeat means Beat AND the
# scheduler store are alive, and the ABSENCE of the heartbeat (no data) breaches
# — this is what catches a live-Beat-but-dead-store outage that the oldest-due
# SLO alarm (treat_missing_data = notBreaching) cannot see.
resource "aws_cloudwatch_log_metric_filter" "background_relay_heartbeat" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-relay-heartbeat"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_relay.relay_heartbeat = * }"

  metric_transformation {
    name          = "RelayHeartbeat"
    namespace     = "Proliferate/Background/${var.environment}"
    value         = "$.background_relay.relay_heartbeat"
    default_value = "0"
  }
}

# Publishing lease-expiry recovery: rows re-claimed after a relay crash mid
# publish. A steady nonzero stream is a signal of relay instability.
resource "aws_cloudwatch_log_metric_filter" "background_recovered_leases" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-relay-recovered-leases"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_relay.recovered_leases = * }"

  metric_transformation {
    name          = "RelayRecoveredLeases"
    namespace     = "Proliferate/Background/${var.environment}"
    value         = "$.background_relay.recovered_leases"
    default_value = "0"
  }
}

# Supported pending rows for the health no-op family. Cardinality is bounded by
# the relay's supported-task allowlist, so this filter set does not widen as new
# task families are added without a matching filter.
resource "aws_cloudwatch_log_metric_filter" "background_supported_pending_health_noop" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-supported-pending-health-noop"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_relay.supported_pending_by_family.background_health_noop = * }"

  metric_transformation {
    name          = "SupportedPendingHealthNoop"
    namespace     = "Proliferate/Background/${var.environment}"
    value         = "$.background_relay.supported_pending_by_family.background_health_noop"
    default_value = "0"
  }
}

# Worker-side task outcomes. The task_metrics signal handlers log one line per
# success/retry/failure carrying a safe task name and error code. These filters
# lift success/retry/failure counts into the metric plane, dimensioned by the
# safe task name (and, for failures/retries, the safe error code) so the frozen
# "task success/retry/failure counts by task name and safe error code" surface
# actually exists. Both dimension sources are low-cardinality — task_name is a
# fixed registry value and error_code is an exception class name — so the
# dimensioned metric set stays bounded. A CloudWatch metric filter only emits a
# data point when the matched log line carries every declared dimension field;
# task_metrics.build_task_metric always emits task_name and error_code, so every
# outcome line produces a fully dimensioned point.
#
# NOTE: a dimensioned metric transformation cannot also carry a default_value
# (CloudWatch rejects the combination), so these three declare dimensions and
# omit default_value; absence of any emission simply means no such outcome
# occurred in the period.
resource "aws_cloudwatch_log_metric_filter" "background_task_success" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-task-success"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_task.outcome = \"success\" }"

  metric_transformation {
    name      = "TaskSuccessCount"
    namespace = "Proliferate/Background/${var.environment}"
    value     = "$.background_task.count"
    dimensions = {
      task_name = "$.background_task.task_name"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "background_task_retry" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-task-retry"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_task.outcome = \"retry\" }"

  metric_transformation {
    name      = "TaskRetryCount"
    namespace = "Proliferate/Background/${var.environment}"
    value     = "$.background_task.count"
    dimensions = {
      task_name  = "$.background_task.task_name"
      error_code = "$.background_task.error_code"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "background_task_failure" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-task-failure"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_task.outcome = \"failure\" }"

  metric_transformation {
    name      = "TaskFailureCount"
    namespace = "Proliferate/Background/${var.environment}"
    value     = "$.background_task.count"
    dimensions = {
      task_name  = "$.background_task.task_name"
      error_code = "$.background_task.error_code"
    }
  }
}

# Terminal rows: only unsupported/invalid task names go terminal, so any
# nonzero failed_rows gauge means a committed task can never execute and needs
# an operational drain decision.
resource "aws_cloudwatch_log_metric_filter" "background_terminal_rows" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-outbox-terminal-rows"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_relay.failed_rows = * }"

  metric_transformation {
    name          = "OutboxTerminalRows"
    namespace     = "Proliferate/Background/${var.environment}"
    value         = "$.background_relay.failed_rows"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "background_terminal_rows" {
  count               = var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-outbox-terminal-rows"
  alarm_description   = "Terminal (failed/unsupported_task) outbox rows exist; committed work is stranded."
  namespace           = "Proliferate/Background/${var.environment}"
  metric_name         = "OutboxTerminalRows"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "background_oldest_due_slo" {
  count               = var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-outbox-oldest-due-slo"
  alarm_description   = "Oldest due-but-unpublished outbox row exceeded the ${var.background_relay_oldest_due_slo_seconds}s SLO."
  namespace           = "Proliferate/Background/${var.environment}"
  metric_name         = "OutboxOldestDuePendingAgeSeconds"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = var.background_relay_oldest_due_slo_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "background_relay_failures" {
  count               = var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-relay-repeated-failures"
  alarm_description   = "Repeated relay publication failures (broker/store trouble or terminal unsupported rows)."
  namespace           = "Proliferate/Background/${var.environment}"
  metric_name         = "RelayFailedCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]
}

# Desired-vs-running truth for the worker service. RunningTaskCount is published
# under ECS/ContainerInsights (NOT AWS/ECS, which only carries service-level
# CPU/Memory utilization), so the namespace must be ECS/ContainerInsights or the
# alarm would see no data and breach continuously regardless of actual health.
# Container Insights is enabled on the cluster (aws_ecs_cluster.main sets
# containerInsights = enabled in main.tf), so this metric is populated.
resource "aws_cloudwatch_metric_alarm" "background_worker_running" {
  count               = var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-worker-not-running"
  alarm_description   = "Celery worker running task count fell below the desired replica count."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = var.background_worker_desired_count
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.background_worker[0].name
  }
}

# Scheduler-store / relay liveness. The oldest-due SLO alarm treats missing data
# as not-breaching, so if RedBeat/Valkey is unreachable while the Beat process is
# still alive, relay ticks silently stop and that alarm stays healthy. This alarm
# closes that hole directly: the relay heartbeat only advances when a tick runs,
# which requires the scheduler store to be reachable, and missing data breaches.
resource "aws_cloudwatch_metric_alarm" "background_relay_heartbeat" {
  count               = var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-relay-heartbeat-missing"
  alarm_description   = "Relay ticks stopped (Beat dead or RedBeat/Valkey scheduler store unreachable); no outbox work will publish."
  namespace           = "Proliferate/Background/${var.environment}"
  metric_name         = "RelayHeartbeat"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  # Absence of the heartbeat is the outage signal, so missing data breaches.
  treat_missing_data = "breaching"
  alarm_actions      = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]
}

# Broker unavailability: Amazon MQ publishes broker metrics under AWS/AmazonMQ
# automatically. When the broker is down or unreachable the metric stream stops,
# so missing data is treated as breaching. Scheduler-store unavailability has no
# native ElastiCache Serverless signal; the relay-heartbeat alarm above is its
# direct detector (a dead store halts relay ticks -> the heartbeat goes missing
# -> that alarm breaches), rather than relying on the oldest-due SLO alarm which
# does not fire on missing data.
resource "aws_cloudwatch_metric_alarm" "background_broker_unreachable" {
  count               = var.background_broker_enabled && var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-broker-unreachable"
  alarm_description   = "Amazon MQ broker stopped reporting connection metrics (down or unreachable)."
  namespace           = "AWS/AmazonMQ"
  metric_name         = "ConnectionCount"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]

  dimensions = {
    Broker = aws_mq_broker.background[0].broker_name
  }
}

# Per-task broker-residence LATENCY, observed on consume: worker task_prerun
# emits `background_queue_age` carrying age_seconds = worker-consume time minus
# relay-publish time, i.e. how long a task that DID get consumed waited in
# RabbitMQ before a worker picked it up. This is a LAGGING signal: it is emitted
# only when a task is actually consumed, so it goes silent exactly when
# consumption stalls and is NOT a truthful "current oldest queued-task age".
# Amazon MQ exposes no native oldest-message-age metric, so current-oldest-age is
# not available from this substrate; broker backlog is instead covered by the
# AWS/AmazonMQ MessageCount depth alarm below. Distinct from
# OutboxOldestDuePendingAgeSeconds, which measures the row's pre-publish wait in
# Postgres. Dimensioned by the fixed-registry task name.
resource "aws_cloudwatch_log_metric_filter" "background_queue_age" {
  count          = var.background_services_enabled ? 1 : 0
  name           = "proliferate-${var.environment}-task-broker-residence-latency"
  log_group_name = aws_cloudwatch_log_group.server.name
  pattern        = "{ $.background_queue_age.age_seconds = * }"

  metric_transformation {
    name      = "TaskBrokerResidenceLatencySeconds"
    namespace = "Proliferate/Background/${var.environment}"
    value     = "$.background_queue_age.age_seconds"
    dimensions = {
      task_name = "$.background_queue_age.task_name"
    }
  }
}

# Celery queue depth: Amazon MQ publishes MessageCount (total queued messages)
# per broker; sustained depth means workers are absent or starved. This is the
# substrate's truthful CURRENT-backlog signal and it does NOT go silent when
# consumption stalls (unlike the consume-time residence-latency metric above), so
# it is what catches "tasks are piling up and not being consumed"; the residence
# latency metric only reports lag for tasks that eventually were consumed.
resource "aws_cloudwatch_metric_alarm" "background_queue_depth" {
  count               = var.background_broker_enabled && var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-queue-depth"
  alarm_description   = "Broker queue depth stayed high; workers are absent or not keeping up."
  namespace           = "AWS/AmazonMQ"
  metric_name         = "MessageCount"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 1000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]

  dimensions = {
    Broker = aws_mq_broker.background[0].broker_name
  }
}

# Desired-vs-running truth for the single Beat service. Same namespace fix as
# the worker alarm: RunningTaskCount lives in ECS/ContainerInsights, so querying
# AWS/ECS here would return no data and breach forever. Container Insights is
# enabled on the cluster (see main.tf), so this metric is populated.
resource "aws_cloudwatch_metric_alarm" "background_beat_running" {
  count               = var.background_services_enabled ? 1 : 0
  alarm_name          = "proliferate-${var.environment}-beat-not-running"
  alarm_description   = "Celery Beat scheduler is not running (no relay ticks will fire)."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.background_alarm_sns_topic_arn == "" ? [] : [var.background_alarm_sns_topic_arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.background_beat[0].name
  }
}

# ── Outputs ──

output "background_broker_endpoint" {
  description = "Amazon MQ RabbitMQ AMQPS endpoint (credentials injected via secret)."
  value       = var.background_broker_enabled ? aws_mq_broker.background[0].instances[0].endpoints[0] : ""
}

output "background_store_endpoint" {
  description = "ElastiCache Serverless (Valkey) endpoint address for RedBeat."
  value       = var.background_broker_enabled ? aws_elasticache_serverless_cache.redbeat[0].endpoint[0].address : ""
}

output "background_worker_service_name" {
  value = var.background_services_enabled ? aws_ecs_service.background_worker[0].name : ""
}

output "background_beat_service_name" {
  value = var.background_services_enabled ? aws_ecs_service.background_beat[0].name : ""
}
