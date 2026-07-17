terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # This root owns only the hosted server Redis binding. Keeping its state
  # separate prevents the legacy bootstrap root in server/infra/main.tf from
  # claiming or replacing the current staging/production ECS services.
  backend "s3" {
    bucket  = "proliferate-terraform-state"
    key     = "server/hosted-redis/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

locals {
  contract       = jsondecode(file("${path.module}/../../deploy/hosted-redis-contract.json"))
  aws_account_id = local.contract.aws_account_id
  aws_region     = local.contract.aws_region

  # This isolated root consumes the same checked-in environment contract as
  # the deploy workflow and does not claim any other deployment surface.
  environments = local.contract.environments
}

provider "aws" {
  region              = local.aws_region
  allowed_account_ids = [local.aws_account_id]
}

data "aws_caller_identity" "current" {}

check "aws_account_binding" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == local.aws_account_id
    error_message = "The hosted Redis root may run only in its bound AWS account."
  }
}

data "aws_secretsmanager_secret" "server_app" {
  for_each = local.environments
  name     = each.value.secret_name
}

data "aws_iam_role" "deploy" {
  for_each = local.environments
  name     = each.value.deploy_role_name
}

data "aws_iam_role" "execution" {
  for_each = local.environments
  name     = each.value.execution_role_name
}

check "secret_identity_binding" {
  assert {
    condition = alltrue([
      for environment, contract in local.environments :
      can(regex(
        "^arn:aws:secretsmanager:${local.aws_region}:${local.aws_account_id}:secret:${contract.secret_name}-[A-Za-z0-9]{6}$",
        data.aws_secretsmanager_secret.server_app[environment].arn,
      ))
    ])
    error_message = "Each hosted environment must resolve its exact account-, region-, and name-bound server-app secret."
  }
}

# The deploy role reads the JSON record only for the value-safe preflight. The
# policy has one action and one exact secret ARN; it cannot enumerate secrets or
# read the other environment's record.
resource "aws_iam_role_policy" "deploy_secret_read" {
  for_each = local.environments
  name     = "api-redis-secret-read"
  role     = data.aws_iam_role.deploy[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadApiRedisSecret"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [data.aws_secretsmanager_secret.server_app[each.key].arn]
    }]
  })

  # These policies predate this root and are adopted by imports.tf. Never let a
  # destroy or resource removal turn state de-adoption into a live deletion.
  lifecycle {
    prevent_destroy = true
  }
}

# ECS resolves REDBEAT_REDIS_URL from the same record when a task starts. This
# child policy owns only that read grant; the existing role remains data-owned.
resource "aws_iam_role_policy" "execution_secret_read" {
  for_each = local.environments
  name     = "api-redis-secret-read"
  role     = data.aws_iam_role.execution[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadApiRedisSecret"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [data.aws_secretsmanager_secret.server_app[each.key].arn]
    }]
  })

  # Redis is a production dependency. Removal requires a separately reviewed
  # ownership transfer, never an incidental destroy of this isolated root.
  lifecycle {
    prevent_destroy = true
  }
}
