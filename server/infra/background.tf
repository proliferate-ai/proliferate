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
        && trimspace(var.background_e2b_template_name) == var.background_e2b_template_name
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

# ── Deploy-gate sensor ──
#
# The ONE retained metric filter. It is not an alert: no CloudWatch alarm may
# consume it (Grafana is the sole alert-evaluation engine; see
# specs/engineering/observability/grafana-logging.md). The server deploy
# workflow's background health gate (_deploy-server.yml) reads the
# RelayHeartbeat custom metric to prove a fresh relay tick before rolling the
# API, so this filter is a deploy-gate sensor and lives or dies with that gate.

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
