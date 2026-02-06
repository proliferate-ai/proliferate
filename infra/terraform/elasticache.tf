# ElastiCache Subnet Group
resource "aws_elasticache_subnet_group" "main" {
  name       = "proliferate-redis-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "proliferate-redis-subnet"
  }
}

# Security Group for Redis
resource "aws_security_group" "redis" {
  name        = "proliferate-redis"
  description = "Security group for Redis ElastiCache"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from worker"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }

  tags = {
    Name = "proliferate-redis"
  }
}

# Custom Parameter Group for BullMQ
# BullMQ requires noeviction policy - writes should fail when memory is full
# rather than silently evicting jobs
resource "aws_elasticache_parameter_group" "bullmq" {
  name   = "proliferate-redis-bullmq"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

# ElastiCache Redis Cluster
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "proliferate-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = aws_elasticache_parameter_group.bullmq.name
  engine_version       = "7.0"
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  tags = {
    Name = "proliferate-redis"
  }
}

# Output Redis endpoint
output "redis_endpoint" {
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
  description = "Redis endpoint address"
}
