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

variable "sandbox_provider" {
  default = "e2b"
}

variable "e2b_api_key" {
  sensitive = true
  default   = ""
}

variable "e2b_template_name" {
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

resource "aws_iam_role" "ecs_task" {
  name               = "proliferate-ecs-task-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
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
        { name = "SANDBOX_PROVIDER", value = var.sandbox_provider },
        { name = "E2B_API_KEY", value = var.e2b_api_key },
        { name = "E2B_TEMPLATE_NAME", value = var.e2b_template_name },
      ]

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
