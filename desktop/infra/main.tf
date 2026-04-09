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
    key    = "desktop/infra/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = "us-east-1"
}

# --------------------------------------------------------------------------
# S3 bucket for updater assets
# --------------------------------------------------------------------------

resource "aws_s3_bucket" "desktop_downloads" {
  bucket = "proliferate-desktop-downloads"
}

resource "aws_s3_bucket_public_access_block" "desktop_downloads" {
  bucket = aws_s3_bucket.desktop_downloads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "desktop_downloads" {
  bucket = aws_s3_bucket.desktop_downloads.id
  versioning_configuration {
    status = "Enabled"
  }
}

# --------------------------------------------------------------------------
# CloudFront distribution
# --------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "desktop_downloads" {
  name                              = "proliferate-desktop-downloads"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "desktop_downloads" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = ""
  aliases             = ["downloads.proliferate.com"]
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.desktop_downloads.bucket_regional_domain_name
    origin_id                = "s3-desktop-downloads"
    origin_access_control_id = aws_cloudfront_origin_access_control.desktop_downloads.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-desktop-downloads"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 300
    max_ttl     = 3600
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.downloads.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# --------------------------------------------------------------------------
# S3 bucket policy for CloudFront OAC
# --------------------------------------------------------------------------

resource "aws_s3_bucket_policy" "desktop_downloads" {
  bucket = aws_s3_bucket.desktop_downloads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.desktop_downloads.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.desktop_downloads.arn
          }
        }
      }
    ]
  })
}

# --------------------------------------------------------------------------
# ACM certificate for downloads.proliferate.com
# DNS is managed in Cloudflare -- after apply, add the validation CNAME
# shown in the "acm_validation_records" output to Cloudflare, then wait
# for validation to complete before the CloudFront distribution can serve
# traffic on the custom domain.
# --------------------------------------------------------------------------

resource "aws_acm_certificate" "downloads" {
  domain_name       = "downloads.proliferate.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "downloads" {
  certificate_arn = aws_acm_certificate.downloads.arn
}

# --------------------------------------------------------------------------
# DNS records to add in Cloudflare (manual)
# --------------------------------------------------------------------------
# After applying, add these records in Cloudflare:
#
# 1. ACM validation CNAME (from "acm_validation_records" output)
# 2. CNAME: downloads.proliferate.com -> <cloudfront_domain_name output>
#    (set Cloudflare proxy to DNS-only / grey cloud)

# --------------------------------------------------------------------------
# GitHub OIDC provider + release role
# --------------------------------------------------------------------------

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "desktop_release" {
  name = "proliferate-desktop-release"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:proliferate-ai/proliferate:*"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "desktop_release" {
  name = "desktop-release-publish"
  role = aws_iam_role.desktop_release.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Upload"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.desktop_downloads.arn,
          "${aws_s3_bucket.desktop_downloads.arn}/*",
        ]
      },
      {
        Sid    = "CloudFrontInvalidation"
        Effect = "Allow"
        Action = "cloudfront:CreateInvalidation"
        Resource = aws_cloudfront_distribution.desktop_downloads.arn
      }
    ]
  })
}

# --------------------------------------------------------------------------
# Outputs
# --------------------------------------------------------------------------

output "s3_bucket_name" {
  value = aws_s3_bucket.desktop_downloads.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.desktop_downloads.id
}

output "cloudfront_domain_name" {
  description = "CNAME downloads.proliferate.com to this in Cloudflare (DNS-only mode)"
  value       = aws_cloudfront_distribution.desktop_downloads.domain_name
}

output "release_role_arn" {
  value = aws_iam_role.desktop_release.arn
}

output "acm_validation_records" {
  description = "Add these CNAME records in Cloudflare to validate the ACM certificate"
  value = {
    for dvo in aws_acm_certificate.downloads.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}
