# ECR Repository
resource "aws_ecr_repository" "worker" {
  name                 = "proliferate-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# ECR Lifecycle Policy
resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# IAM Role for ECS Task Execution
resource "aws_iam_role" "ecs_execution" {
  name = "proliferate-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow ECS to read secrets from Secrets Manager
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue"
      ]
      Resource = [
        aws_secretsmanager_secret.worker.arn
      ]
    }]
  })
}

# IAM Role for ECS Task
resource "aws_iam_role" "ecs_task" {
  name = "proliferate-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

# Secrets Manager for worker secrets
resource "aws_secretsmanager_secret" "worker" {
  name        = "proliferate-worker"
  description = "Secrets for Proliferate worker service"
}

# Security Group for Worker
resource "aws_security_group" "worker" {
  name        = "proliferate-worker"
  description = "Security group for worker ECS tasks"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "proliferate-worker"
  }
}

# ECS Task Definition for Worker
resource "aws_ecs_task_definition" "worker" {
  family                   = "proliferate-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "worker"
    image = "${aws_ecr_repository.worker.repository_url}:latest"

    environment = [
      { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379" },
      { name = "NEXT_PUBLIC_APP_URL", value = var.app_url },
    ]

    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.worker.arn}:DATABASE_URL::" },
      { name = "SERVICE_TO_SERVICE_AUTH_TOKEN", valueFrom = "${aws_secretsmanager_secret.worker.arn}:SERVICE_TO_SERVICE_AUTH_TOKEN::" },
      { name = "NANGO_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.worker.arn}:NANGO_SECRET_KEY::" },
    ]

    portMappings = [{ containerPort = 8080, protocol = "tcp" }]

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.worker.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])
}

# ECS Service
resource "aws_ecs_service" "worker" {
  name            = "proliferate-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  # Allow service to be updated without destroying
  lifecycle {
    ignore_changes = [task_definition]
  }
}

# Outputs
output "ecr_repository_url" {
  value       = aws_ecr_repository.worker.repository_url
  description = "ECR repository URL for the worker image"
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "ECS cluster name"
}

output "ecs_service_name" {
  value       = aws_ecs_service.worker.name
  description = "ECS service name"
}
