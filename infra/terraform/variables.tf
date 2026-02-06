variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "app_url" {
  description = "Next.js app URL"
  type        = string
  default     = "https://app.withkeystone.com"
}

variable "llm_proxy_certificate_arn" {
  description = "ACM certificate ARN for LLM Proxy HTTPS"
  type        = string
  default     = ""
}
