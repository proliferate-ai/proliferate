mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "157466816238"
    }
  }
}

# Configuration-driven deploy-policy imports are exercised by the real-account
# adoption plan. Mock providers cannot execute imports, so override only those
# two instances while retaining their configured policy values for assertions.
override_resource {
  target = aws_iam_role_policy.deploy_secret_read["staging"]
}

override_resource {
  target = aws_iam_role_policy.deploy_secret_read["production"]
}

run "least_privilege_environment_bindings" {
  command = plan

  override_data {
    target = data.aws_secretsmanager_secret.server_app["staging"]
    values = {
      arn  = "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/staging/server-app-Ab12Cd"
      name = "proliferate/staging/server-app"
    }
  }

  override_data {
    target = data.aws_secretsmanager_secret.server_app["production"]
    values = {
      arn  = "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/server-app-Ef34Gh"
      name = "proliferate/prod/server-app"
    }
  }

  assert {
    condition     = toset(keys(local.environments)) == toset(["staging", "production"])
    error_message = "Only the two hosted server environments may be managed."
  }

  assert {
    condition = (
      local.aws_account_id == "157466816238"
      && local.aws_region == "us-east-1"
      && toset(local.environments.staging.workflow_names) == toset(["staging", "Staging"])
      && toset(local.environments.production.workflow_names) == toset(["production", "Production"])
      && local.environments.staging.background_redis_reference_service == "secretsmanager"
      && local.environments.staging.background_redis_reference_name == "proliferate/staging/background/redbeat-redis-url"
      && local.environments.production.background_redis_reference_service == "secretsmanager"
      && local.environments.production.background_redis_reference_name == "proliferate/production/background/redbeat-redis-url"
    )
    error_message = "Terraform must consume the exact workflow account/region/environment aliases."
  }

  assert {
    condition = alltrue([
      for environment in keys(local.environments) :
      length(jsondecode(aws_iam_role_policy.deploy_secret_read[environment].policy).Statement) == 1
    ])
    error_message = "Every deploy policy must contain exactly one statement."
  }

  assert {
    condition = alltrue([
      for environment in keys(local.environments) :
      jsondecode(aws_iam_role_policy.deploy_secret_read[environment].policy).Statement[0].Action == ["secretsmanager:GetSecretValue"]
      && jsondecode(aws_iam_role_policy.deploy_secret_read[environment].policy).Statement[0].Sid == "ReadApiRedisSecret"
    ])
    error_message = "Deploy roles may receive only GetSecretValue."
  }

  assert {
    condition = alltrue([
      for environment in keys(local.environments) :
      jsondecode(aws_iam_role_policy.deploy_secret_read[environment].policy).Statement[0].Resource == [data.aws_secretsmanager_secret.server_app[environment].arn]
    ])
    error_message = "Deploy policies must target exactly their environment secret."
  }

  assert {
    condition = alltrue([
      for environment in keys(local.environments) :
      jsondecode(aws_iam_role_policy.execution_secret_read[environment].policy).Statement[0] == jsondecode(aws_iam_role_policy.deploy_secret_read[environment].policy).Statement[0]
    ])
    error_message = "Execution and deploy roles must receive the same exact-secret read grant."
  }
}

run "wrong_account_fails_closed" {
  command = plan

  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "111122223333"
    }
  }

  override_data {
    target = data.aws_secretsmanager_secret.server_app["staging"]
    values = {
      arn = "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/staging/server-app-Ab12Cd"
    }
  }

  override_data {
    target = data.aws_secretsmanager_secret.server_app["production"]
    values = {
      arn = "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/server-app-Ef34Gh"
    }
  }

  expect_failures = [check.aws_account_binding]
}
