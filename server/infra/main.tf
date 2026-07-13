terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "proliferate-terraform-state"
    key    = "server/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# ── Variables ──

variable "aws_region" {
  default = "us-east-1"
}

variable "environment" {
  default = "production"
}

variable "db_password" {
  sensitive = true
}

variable "jwt_secret" {
  sensitive = true
}

variable "e2b_api_key" {
  sensitive = true
  default   = ""
}

variable "e2b_template_name" {
  default = ""
}

variable "telemetry_mode" {
  default = "hosted_product"
}

variable "sentry_dsn" {
  sensitive = true
  default   = ""
}

variable "sentry_environment" {
  default = "production"
}

variable "sentry_release" {
  default = "proliferate-server@production"
}

variable "sentry_traces_sample_rate" {
  default = "1.0"
}

variable "cloud_runtime_sentry_dsn" {
  sensitive = true
  default   = ""
}

variable "cloud_runtime_sentry_environment" {
  default = "production"
}

variable "cloud_runtime_sentry_release" {
  default = ""
}

variable "cloud_runtime_sentry_traces_sample_rate" {
  default = "1.0"
}

variable "cloud_target_sentry_dsn" {
  sensitive = true
  default   = ""
}

variable "cloud_target_sentry_environment" {
  default = "production"
}

# Emergency, component-specific Sentry release overrides for the target
# processes. Normally EMPTY: the worker/supervisor binaries stamp their own
# `<component>@<version>+<sha>` from their compile-time build stamp. A value
# must canonically name its own component or the server refuses it. The prior
# shared `cloud_target_sentry_release` was removed because one value could not
# distinguish worker from supervisor events (support-system "Release identity").
variable "cloud_worker_sentry_release" {
  default = ""
}

variable "cloud_supervisor_sentry_release" {
  default = ""
}

variable "cloud_target_sentry_traces_sample_rate" {
  default = "1.0"
}

variable "customerio_site_id" {
  sensitive = true
  default   = ""
}

variable "customerio_api_key" {
  sensitive = true
  default   = ""
}

variable "customerio_app_api_key" {
  sensitive = true
  default   = ""
}

variable "customerio_from_email" {
  default = "hello@proliferate.com"
}

variable "customerio_welcome_transactional_message_id" {
  default = ""
}

variable "support_report_s3_bucket" {
  default = ""
}

variable "support_report_s3_prefix" {
  default = "support/reports"
}

variable "support_report_s3_region" {
  default = ""
}

variable "support_report_upload_url_expires_seconds" {
  default = "900"
}

variable "support_report_diagnostics_max_bytes" {
  default = "26214400"
}

variable "support_report_attachment_max_bytes" {
  default = "26214400"
}

variable "support_report_total_attachment_max_bytes" {
  default = "104857600"
}

variable "support_report_retention_days" {
  default = 30
}

variable "support_report_internal_base_url" {
  default = ""
}

variable "support_tracker_enabled" {
  default = "false"
}

variable "support_tracker_reconciler_interval_seconds" {
  default = "30.0"
}

variable "support_tracker_reconciler_batch_size" {
  default = "10"
}

variable "support_tracker_max_attempts" {
  default = "8"
}

variable "support_tracker_retry_base_seconds" {
  default = "60.0"
}

variable "support_github_app_id" {
  default = ""
}

variable "support_github_app_private_key" {
  sensitive = true
  default   = ""
}

variable "support_github_app_private_key_parameter_name" {
  default = ""
}

variable "support_github_app_installation_id" {
  default = ""
}

variable "support_github_owner" {
  default = ""
}

variable "support_github_repo" {
  default = ""
}

variable "support_github_label_support" {
  default = "support"
}

variable "support_github_label_private" {
  default = "private-details"
}

variable "support_linear_api_key" {
  sensitive = true
  default   = ""
}

variable "support_linear_api_key_parameter_name" {
  default = ""
}

variable "support_linear_team_id" {
  default = ""
}

variable "support_linear_project_id" {
  default = ""
}

variable "support_linear_label_ids" {
  default = ""
}

variable "support_linear_private_details_label_id" {
  default = ""
}

# ── VPC (use default for now, swap for dedicated VPC later) ──

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ── Security Groups ──

resource "aws_security_group" "rds" {
  name_prefix = "proliferate-rds-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 5432
    to_port         = 5432
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
    Name = "proliferate-rds-${var.environment}"
  }
}

resource "aws_security_group" "ecs" {
  name_prefix = "proliferate-ecs-"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "proliferate-ecs-${var.environment}"
  }
}

# ── RDS PostgreSQL ──

resource "aws_db_subnet_group" "main" {
  name       = "proliferate-${var.environment}"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "postgres" {
  identifier     = "proliferate-${var.environment}"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "proliferate"
  username = "proliferate"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period   = 7
  skip_final_snapshot       = false
  final_snapshot_identifier = "proliferate-${var.environment}-final"
  deletion_protection       = true

  tags = {
    Name        = "proliferate-${var.environment}"
    Environment = var.environment
  }
}

# ── ECR ──

resource "aws_ecr_repository" "server" {
  name                 = "proliferate-server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# ── ECS Cluster ──

resource "aws_ecs_cluster" "main" {
  name = "proliferate-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ── IAM for ECS task execution ──

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "proliferate-ecs-execution-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "support_tracker_secret_parameters" {
  count = length(local.support_tracker_secret_parameter_arns) == 0 ? 0 : 1

  statement {
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = local.support_tracker_secret_parameter_arns
  }
}

resource "aws_iam_role_policy" "support_tracker_secret_parameters" {
  count  = length(local.support_tracker_secret_parameter_arns) == 0 ? 0 : 1
  name   = "support-tracker-secret-parameters"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.support_tracker_secret_parameters[0].json
}

resource "aws_iam_role" "ecs_task" {
  name               = "proliferate-ecs-task-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ── Support Reports ──

locals {
  support_report_s3_prefix = trim(var.support_report_s3_prefix, "/")
  support_github_app_private_key_parameter_name = (
    var.support_github_app_private_key_parameter_name != ""
    ? var.support_github_app_private_key_parameter_name
    : (
      var.support_tracker_enabled == "true"
      ? "/proliferate/${var.environment}/support/github-app-private-key"
      : ""
    )
  )
  support_linear_api_key_parameter_name = (
    var.support_linear_api_key_parameter_name != ""
    ? var.support_linear_api_key_parameter_name
    : (
      var.support_linear_team_id != ""
      ? "/proliferate/${var.environment}/support/linear-api-key"
      : ""
    )
  )
  support_tracker_secret_parameter_names = compact([
    local.support_github_app_private_key_parameter_name,
    local.support_linear_api_key_parameter_name,
  ])
  support_tracker_secret_parameter_arns = [
    for name in local.support_tracker_secret_parameter_names :
    startswith(name, "arn:")
    ? name
    : "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${name}"
  ]
}

resource "aws_s3_bucket" "support_reports" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  bucket = var.support_report_s3_bucket

  tags = {
    Name        = var.support_report_s3_bucket
    Environment = var.environment
    Purpose     = "support-reports"
  }
}

resource "aws_s3_bucket_public_access_block" "support_reports" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  bucket = aws_s3_bucket.support_reports[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "support_reports" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  bucket = aws_s3_bucket.support_reports[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "support_reports" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  bucket = aws_s3_bucket.support_reports[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "support_reports" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  bucket = aws_s3_bucket.support_reports[0].id

  rule {
    id     = "expire-support-reports"
    status = "Enabled"

    filter {
      prefix = "${local.support_report_s3_prefix}/"
    }

    expiration {
      days = var.support_report_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.support_report_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "support_reports" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  bucket = aws_s3_bucket.support_reports[0].id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "support_reports_bucket" {
  count = var.support_report_s3_bucket == "" ? 0 : 1

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.support_reports[0].arn,
      "${aws_s3_bucket.support_reports[0].arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid     = "DenyUnencryptedObjectUploads"
    effect  = "Deny"
    actions = ["s3:PutObject"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = ["${aws_s3_bucket.support_reports[0].arn}/*"]

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["AES256"]
    }
  }
}

resource "aws_s3_bucket_policy" "support_reports" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  bucket = aws_s3_bucket.support_reports[0].id
  policy = data.aws_iam_policy_document.support_reports_bucket[0].json
}

data "aws_iam_policy_document" "support_reports_ecs" {
  count = var.support_report_s3_bucket == "" ? 0 : 1

  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]

    resources = [
      "${aws_s3_bucket.support_reports[0].arn}/${local.support_report_s3_prefix}/*",
    ]
  }
}

resource "aws_iam_role_policy" "support_reports_ecs" {
  count  = var.support_report_s3_bucket == "" ? 0 : 1
  name   = "support-reports-s3"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.support_reports_ecs[0].json
}

# ── CloudWatch Logs ──

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/proliferate-server-${var.environment}"
  retention_in_days = 30
}

# ── ECS Task Definition ──

resource "aws_ecs_task_definition" "server" {
  family                   = "proliferate-server-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "server"
      image     = "${aws_ecr_repository.server.repository_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "DATABASE_URL", value = "postgresql+asyncpg://proliferate:${var.db_password}@${aws_db_instance.postgres.endpoint}/proliferate" },
        { name = "JWT_SECRET", value = var.jwt_secret },
        { name = "E2B_API_KEY", value = var.e2b_api_key },
        { name = "E2B_TEMPLATE_NAME", value = var.e2b_template_name },
        # Billing enforcement in production: pause/deny over-limit + spend-hold
        # sandboxes (reconciler + live resume gate). config.py defaults to "off".
        { name = "CLOUD_BILLING_MODE", value = "enforce" },
        { name = "PROLIFERATE_TELEMETRY_MODE", value = var.telemetry_mode },
        { name = "SENTRY_DSN", value = var.sentry_dsn },
        { name = "SENTRY_ENVIRONMENT", value = var.sentry_environment },
        { name = "SENTRY_RELEASE", value = var.sentry_release },
        { name = "SENTRY_TRACES_SAMPLE_RATE", value = var.sentry_traces_sample_rate },
        { name = "CLOUD_RUNTIME_SENTRY_DSN", value = var.cloud_runtime_sentry_dsn },
        { name = "CLOUD_RUNTIME_SENTRY_ENVIRONMENT", value = var.cloud_runtime_sentry_environment },
        { name = "CLOUD_RUNTIME_SENTRY_RELEASE", value = var.cloud_runtime_sentry_release },
        { name = "CLOUD_RUNTIME_SENTRY_TRACES_SAMPLE_RATE", value = var.cloud_runtime_sentry_traces_sample_rate },
        { name = "CLOUD_TARGET_SENTRY_DSN", value = var.cloud_target_sentry_dsn },
        { name = "CLOUD_TARGET_SENTRY_ENVIRONMENT", value = var.cloud_target_sentry_environment },
        { name = "CLOUD_WORKER_SENTRY_RELEASE", value = var.cloud_worker_sentry_release },
        { name = "CLOUD_SUPERVISOR_SENTRY_RELEASE", value = var.cloud_supervisor_sentry_release },
        { name = "CLOUD_TARGET_SENTRY_TRACES_SAMPLE_RATE", value = var.cloud_target_sentry_traces_sample_rate },
        { name = "CUSTOMERIO_SITE_ID", value = var.customerio_site_id },
        { name = "CUSTOMERIO_API_KEY", value = var.customerio_api_key },
        { name = "CUSTOMERIO_APP_API_KEY", value = var.customerio_app_api_key },
        { name = "CUSTOMERIO_FROM_EMAIL", value = var.customerio_from_email },
        { name = "CUSTOMERIO_WELCOME_TRANSACTIONAL_MESSAGE_ID", value = var.customerio_welcome_transactional_message_id },
        { name = "SUPPORT_REPORT_S3_BUCKET", value = var.support_report_s3_bucket },
        { name = "SUPPORT_REPORT_S3_PREFIX", value = var.support_report_s3_prefix },
        { name = "SUPPORT_REPORT_S3_REGION", value = var.support_report_s3_region },
        { name = "SUPPORT_REPORT_UPLOAD_URL_EXPIRES_SECONDS", value = var.support_report_upload_url_expires_seconds },
        { name = "SUPPORT_REPORT_DIAGNOSTICS_MAX_BYTES", value = var.support_report_diagnostics_max_bytes },
        { name = "SUPPORT_REPORT_ATTACHMENT_MAX_BYTES", value = var.support_report_attachment_max_bytes },
        { name = "SUPPORT_REPORT_TOTAL_ATTACHMENT_MAX_BYTES", value = var.support_report_total_attachment_max_bytes },
        { name = "SUPPORT_REPORT_INTERNAL_BASE_URL", value = var.support_report_internal_base_url },
        { name = "SUPPORT_TRACKER_ENABLED", value = var.support_tracker_enabled },
        { name = "SUPPORT_TRACKER_RECONCILER_INTERVAL_SECONDS", value = var.support_tracker_reconciler_interval_seconds },
        { name = "SUPPORT_TRACKER_RECONCILER_BATCH_SIZE", value = var.support_tracker_reconciler_batch_size },
        { name = "SUPPORT_TRACKER_MAX_ATTEMPTS", value = var.support_tracker_max_attempts },
        { name = "SUPPORT_TRACKER_RETRY_BASE_SECONDS", value = var.support_tracker_retry_base_seconds },
        { name = "SUPPORT_GITHUB_APP_ID", value = var.support_github_app_id },
        { name = "SUPPORT_GITHUB_APP_INSTALLATION_ID", value = var.support_github_app_installation_id },
        { name = "SUPPORT_GITHUB_OWNER", value = var.support_github_owner },
        { name = "SUPPORT_GITHUB_REPO", value = var.support_github_repo },
        { name = "SUPPORT_GITHUB_LABEL_SUPPORT", value = var.support_github_label_support },
        { name = "SUPPORT_GITHUB_LABEL_PRIVATE", value = var.support_github_label_private },
        { name = "SUPPORT_LINEAR_TEAM_ID", value = var.support_linear_team_id },
        { name = "SUPPORT_LINEAR_PROJECT_ID", value = var.support_linear_project_id },
        { name = "SUPPORT_LINEAR_LABEL_IDS", value = var.support_linear_label_ids },
        { name = "SUPPORT_LINEAR_PRIVATE_DETAILS_LABEL_ID", value = var.support_linear_private_details_label_id },
      ]

      secrets = concat(
        local.support_github_app_private_key_parameter_name == "" ? [] : [
          {
            name      = "SUPPORT_GITHUB_APP_PRIVATE_KEY"
            valueFrom = local.support_github_app_private_key_parameter_name
          }
        ],
        local.support_linear_api_key_parameter_name == "" ? [] : [
          {
            name      = "SUPPORT_LINEAR_API_KEY"
            valueFrom = local.support_linear_api_key_parameter_name
          }
        ],
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "server"
        }
      }
    }
  ])
}

# ── ECS Service ──

resource "aws_ecs_service" "server" {
  name            = "proliferate-server-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }
}

# ── Outputs ──

output "rds_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "ecr_repository_url" {
  value = aws_ecr_repository.server.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.server.name
}

output "support_report_s3_bucket" {
  value = var.support_report_s3_bucket
}
