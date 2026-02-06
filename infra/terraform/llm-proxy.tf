# LLM Proxy - LiteLLM on ECS with ALB
#
# Provides a secure LLM API proxy for sandboxed environments.
# Sandboxes get short-lived virtual keys instead of real API keys.

# ECR Repository
resource "aws_ecr_repository" "llm_proxy" {
  name                 = "proliferate-llm-proxy"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "llm_proxy" {
  repository = aws_ecr_repository.llm_proxy.name

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

# Secrets Manager for LLM Proxy
resource "aws_secretsmanager_secret" "llm_proxy" {
  name        = "proliferate-llm-proxy"
  description = "Secrets for LLM Proxy service"
}

# Allow ECS to read LLM proxy secrets
resource "aws_iam_role_policy" "ecs_execution_llm_proxy_secrets" {
  name = "llm-proxy-secrets-access"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue"
      ]
      Resource = [
        aws_secretsmanager_secret.llm_proxy.arn
      ]
    }]
  })
}

# CloudWatch Log Group for LLM Proxy
resource "aws_cloudwatch_log_group" "llm_proxy" {
  name              = "/ecs/proliferate-llm-proxy"
  retention_in_days = 30
}

# Security Group for ALB
resource "aws_security_group" "llm_proxy_alb" {
  name        = "proliferate-llm-proxy-alb"
  description = "Security group for LLM Proxy ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP (redirects to HTTPS)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "proliferate-llm-proxy-alb"
  }
}

# Security Group for LLM Proxy ECS Tasks
resource "aws_security_group" "llm_proxy" {
  name        = "proliferate-llm-proxy"
  description = "Security group for LLM Proxy ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.llm_proxy_alb.id]
    description     = "Allow traffic from ALB"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "proliferate-llm-proxy"
  }
}

# Application Load Balancer
resource "aws_lb" "llm_proxy" {
  name               = "proliferate-llm-proxy"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.llm_proxy_alb.id]
  subnets            = aws_subnet.public[*].id

  tags = {
    Name = "proliferate-llm-proxy"
  }
}

# ALB Target Group
resource "aws_lb_target_group" "llm_proxy" {
  name        = "proliferate-llm-proxy"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health/liveliness"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }
}

# HTTP Listener
# When certificate is provided, redirects to HTTPS
# When no certificate, forwards directly to target group
resource "aws_lb_listener" "llm_proxy_http" {
  load_balancer_arn = aws_lb.llm_proxy.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = var.llm_proxy_certificate_arn != "" ? "redirect" : "forward"
    target_group_arn = var.llm_proxy_certificate_arn != "" ? null : aws_lb_target_group.llm_proxy.arn

    dynamic "redirect" {
      for_each = var.llm_proxy_certificate_arn != "" ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

# HTTPS Listener (only created when certificate is provided)
resource "aws_lb_listener" "llm_proxy_https" {
  count             = var.llm_proxy_certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.llm_proxy.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.llm_proxy_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.llm_proxy.arn
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "llm_proxy" {
  family                   = "proliferate-llm-proxy"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "llm-proxy"
    image = "${aws_ecr_repository.llm_proxy.repository_url}:latest"

    secrets = [
      { name = "LITELLM_MASTER_KEY", valueFrom = "${aws_secretsmanager_secret.llm_proxy.arn}:LITELLM_MASTER_KEY::" },
      { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.llm_proxy.arn}:ANTHROPIC_API_KEY::" },
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.llm_proxy.arn}:DATABASE_URL::" },
    ]

    portMappings = [{ containerPort = 4000, protocol = "tcp" }]

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:4000/health/liveliness || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 120
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.llm_proxy.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "llm-proxy"
      }
    }
  }])
}

# ECS Service
resource "aws_ecs_service" "llm_proxy" {
  name            = "proliferate-llm-proxy"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.llm_proxy.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.llm_proxy.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.llm_proxy.arn
    container_name   = "llm-proxy"
    container_port   = 4000
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.llm_proxy_http]
}

# Outputs
output "llm_proxy_ecr_repository_url" {
  value       = aws_ecr_repository.llm_proxy.repository_url
  description = "ECR repository URL for the LLM Proxy image"
}

output "llm_proxy_alb_dns_name" {
  value       = aws_lb.llm_proxy.dns_name
  description = "ALB DNS name for the LLM Proxy"
}

output "llm_proxy_url" {
  value       = "https://${aws_lb.llm_proxy.dns_name}"
  description = "LLM Proxy URL"
}
