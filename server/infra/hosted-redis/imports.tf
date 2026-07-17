# The two deploy-role policies already exist with the exact desired document.
# Configuration-driven imports make adoption visible in the saved plan instead
# of blind-upserting a same-named inline policy. Execution-role policies are not
# imported: the adoption plan must show those two instances as creates.
import {
  for_each = local.environments

  to = aws_iam_role_policy.deploy_secret_read[each.key]
  id = "${each.value.deploy_role_name}:api-redis-secret-read"
}
