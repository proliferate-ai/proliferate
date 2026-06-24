"""Pydantic schemas for organization SSO administration."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.auth.sso.types import DEFAULT_OIDC_SCOPES
from proliferate.db.store.auth_sso import SsoConnectionRecord

SsoProtocolName = Literal["oidc", "saml"]
SsoStatusName = Literal["draft", "enabled", "disabled"]
SsoLoginPolicyName = Literal["optional", "required"]
SsoJitPolicyName = Literal["disabled", "existing_user", "create_member"]
SsoDefaultRoleName = Literal["owner", "admin", "member"]
OidcTokenEndpointAuthMethod = Literal["client_secret_basic", "client_secret_post", "none"]


class OrganizationSsoBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class OrganizationSsoConnectionRequest(OrganizationSsoBaseModel):
    protocol: SsoProtocolName = "oidc"
    display_name: str = Field(
        default="Company SSO",
        serialization_alias="displayName",
        validation_alias="displayName",
    )
    login_policy: SsoLoginPolicyName = Field(
        default="optional",
        serialization_alias="loginPolicy",
        validation_alias="loginPolicy",
    )
    jit_policy: SsoJitPolicyName = Field(
        default="disabled",
        serialization_alias="jitPolicy",
        validation_alias="jitPolicy",
    )
    default_role: SsoDefaultRoleName = Field(
        default="member",
        serialization_alias="defaultRole",
        validation_alias="defaultRole",
    )
    allowed_domains: list[str] = Field(
        default_factory=list,
        serialization_alias="allowedDomains",
        validation_alias="allowedDomains",
    )
    oidc_issuer_url: str | None = Field(
        default=None,
        serialization_alias="oidcIssuerUrl",
        validation_alias="oidcIssuerUrl",
    )
    oidc_discovery_url: str | None = Field(
        default=None,
        serialization_alias="oidcDiscoveryUrl",
        validation_alias="oidcDiscoveryUrl",
    )
    oidc_authorization_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcAuthorizationEndpoint",
        validation_alias="oidcAuthorizationEndpoint",
    )
    oidc_token_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcTokenEndpoint",
        validation_alias="oidcTokenEndpoint",
    )
    oidc_jwks_uri: str | None = Field(
        default=None,
        serialization_alias="oidcJwksUri",
        validation_alias="oidcJwksUri",
    )
    oidc_userinfo_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcUserinfoEndpoint",
        validation_alias="oidcUserinfoEndpoint",
    )
    oidc_client_id: str | None = Field(
        default=None,
        serialization_alias="oidcClientId",
        validation_alias="oidcClientId",
    )
    oidc_client_secret: str | None = Field(
        default=None,
        serialization_alias="oidcClientSecret",
        validation_alias="oidcClientSecret",
    )
    oidc_scopes: list[str] = Field(
        default_factory=lambda: list(DEFAULT_OIDC_SCOPES),
        serialization_alias="oidcScopes",
        validation_alias="oidcScopes",
    )
    oidc_token_endpoint_auth_method: OidcTokenEndpointAuthMethod = Field(
        default="client_secret_basic",
        serialization_alias="oidcTokenEndpointAuthMethod",
        validation_alias="oidcTokenEndpointAuthMethod",
    )
    saml_idp_metadata_url: str | None = Field(
        default=None,
        serialization_alias="samlIdpMetadataUrl",
        validation_alias="samlIdpMetadataUrl",
    )
    saml_idp_metadata_xml: str | None = Field(
        default=None,
        serialization_alias="samlIdpMetadataXml",
        validation_alias="samlIdpMetadataXml",
    )
    saml_idp_entity_id: str | None = Field(
        default=None,
        serialization_alias="samlIdpEntityId",
        validation_alias="samlIdpEntityId",
    )
    saml_sso_url: str | None = Field(
        default=None,
        serialization_alias="samlSsoUrl",
        validation_alias="samlSsoUrl",
    )
    saml_x509_cert: str | None = Field(
        default=None,
        serialization_alias="samlX509Cert",
        validation_alias="samlX509Cert",
    )
    saml_email_attribute: str | None = Field(
        default=None,
        serialization_alias="samlEmailAttribute",
        validation_alias="samlEmailAttribute",
    )


class OrganizationSsoConnectionUpdateRequest(OrganizationSsoBaseModel):
    display_name: str | None = Field(
        default=None,
        serialization_alias="displayName",
        validation_alias="displayName",
    )
    login_policy: SsoLoginPolicyName | None = Field(
        default=None,
        serialization_alias="loginPolicy",
        validation_alias="loginPolicy",
    )
    jit_policy: SsoJitPolicyName | None = Field(
        default=None,
        serialization_alias="jitPolicy",
        validation_alias="jitPolicy",
    )
    default_role: SsoDefaultRoleName | None = Field(
        default=None,
        serialization_alias="defaultRole",
        validation_alias="defaultRole",
    )
    allowed_domains: list[str] | None = Field(
        default=None,
        serialization_alias="allowedDomains",
        validation_alias="allowedDomains",
    )
    oidc_issuer_url: str | None = Field(
        default=None,
        serialization_alias="oidcIssuerUrl",
        validation_alias="oidcIssuerUrl",
    )
    oidc_discovery_url: str | None = Field(
        default=None,
        serialization_alias="oidcDiscoveryUrl",
        validation_alias="oidcDiscoveryUrl",
    )
    oidc_authorization_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcAuthorizationEndpoint",
        validation_alias="oidcAuthorizationEndpoint",
    )
    oidc_token_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcTokenEndpoint",
        validation_alias="oidcTokenEndpoint",
    )
    oidc_jwks_uri: str | None = Field(
        default=None,
        serialization_alias="oidcJwksUri",
        validation_alias="oidcJwksUri",
    )
    oidc_userinfo_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcUserinfoEndpoint",
        validation_alias="oidcUserinfoEndpoint",
    )
    oidc_client_id: str | None = Field(
        default=None,
        serialization_alias="oidcClientId",
        validation_alias="oidcClientId",
    )
    oidc_client_secret: str | None = Field(
        default=None,
        serialization_alias="oidcClientSecret",
        validation_alias="oidcClientSecret",
    )
    oidc_scopes: list[str] | None = Field(
        default=None,
        serialization_alias="oidcScopes",
        validation_alias="oidcScopes",
    )
    oidc_token_endpoint_auth_method: OidcTokenEndpointAuthMethod | None = Field(
        default=None,
        serialization_alias="oidcTokenEndpointAuthMethod",
        validation_alias="oidcTokenEndpointAuthMethod",
    )
    saml_idp_metadata_url: str | None = Field(
        default=None,
        serialization_alias="samlIdpMetadataUrl",
        validation_alias="samlIdpMetadataUrl",
    )
    saml_idp_metadata_xml: str | None = Field(
        default=None,
        serialization_alias="samlIdpMetadataXml",
        validation_alias="samlIdpMetadataXml",
    )
    saml_idp_entity_id: str | None = Field(
        default=None,
        serialization_alias="samlIdpEntityId",
        validation_alias="samlIdpEntityId",
    )
    saml_sso_url: str | None = Field(
        default=None,
        serialization_alias="samlSsoUrl",
        validation_alias="samlSsoUrl",
    )
    saml_x509_cert: str | None = Field(
        default=None,
        serialization_alias="samlX509Cert",
        validation_alias="samlX509Cert",
    )
    saml_email_attribute: str | None = Field(
        default=None,
        serialization_alias="samlEmailAttribute",
        validation_alias="samlEmailAttribute",
    )


class OrganizationSsoConnectionResponse(OrganizationSsoBaseModel):
    id: str
    organization_id: str = Field(serialization_alias="organizationId")
    scope: Literal["organization"]
    protocol: SsoProtocolName
    status: SsoStatusName
    display_name: str = Field(serialization_alias="displayName")
    login_policy: SsoLoginPolicyName = Field(serialization_alias="loginPolicy")
    jit_policy: SsoJitPolicyName = Field(serialization_alias="jitPolicy")
    default_role: SsoDefaultRoleName = Field(serialization_alias="defaultRole")
    allowed_domains: list[str] = Field(serialization_alias="allowedDomains")
    oidc_issuer_url: str | None = Field(default=None, serialization_alias="oidcIssuerUrl")
    oidc_discovery_url: str | None = Field(default=None, serialization_alias="oidcDiscoveryUrl")
    oidc_authorization_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcAuthorizationEndpoint",
    )
    oidc_token_endpoint: str | None = Field(default=None, serialization_alias="oidcTokenEndpoint")
    oidc_jwks_uri: str | None = Field(default=None, serialization_alias="oidcJwksUri")
    oidc_userinfo_endpoint: str | None = Field(
        default=None,
        serialization_alias="oidcUserinfoEndpoint",
    )
    oidc_client_id: str | None = Field(default=None, serialization_alias="oidcClientId")
    oidc_client_secret_configured: bool = Field(
        serialization_alias="oidcClientSecretConfigured",
    )
    oidc_scopes: list[str] = Field(serialization_alias="oidcScopes")
    oidc_token_endpoint_auth_method: OidcTokenEndpointAuthMethod = Field(
        serialization_alias="oidcTokenEndpointAuthMethod",
    )
    oidc_redirect_uri: str = Field(serialization_alias="oidcRedirectUri")
    saml_idp_metadata_url: str | None = Field(
        default=None,
        serialization_alias="samlIdpMetadataUrl",
    )
    saml_idp_metadata_xml_configured: bool = Field(
        serialization_alias="samlIdpMetadataXmlConfigured",
    )
    saml_idp_entity_id: str | None = Field(default=None, serialization_alias="samlIdpEntityId")
    saml_sso_url: str | None = Field(default=None, serialization_alias="samlSsoUrl")
    saml_x509_cert_configured: bool = Field(serialization_alias="samlX509CertConfigured")
    saml_email_attribute: str | None = Field(
        default=None,
        serialization_alias="samlEmailAttribute",
    )
    saml_acs_url: str = Field(serialization_alias="samlAcsUrl")
    saml_entity_id: str = Field(serialization_alias="samlEntityId")
    saml_metadata_url: str = Field(serialization_alias="samlMetadataUrl")
    tested_at: str | None = Field(default=None, serialization_alias="testedAt")
    last_error: str | None = Field(default=None, serialization_alias="lastError")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class OrganizationSsoConnectionsResponse(OrganizationSsoBaseModel):
    connections: list[OrganizationSsoConnectionResponse]


class OrganizationSsoConnectionTestResponse(OrganizationSsoBaseModel):
    ok: bool
    connection: OrganizationSsoConnectionResponse


def connection_response(
    record: SsoConnectionRecord,
    *,
    oidc_redirect_uri: str,
    saml_acs_url: str,
    saml_entity_id: str,
    saml_metadata_url: str,
) -> OrganizationSsoConnectionResponse:
    return OrganizationSsoConnectionResponse(
        id=str(record.id),
        organization_id=str(record.organization_id),
        scope="organization",
        protocol=record.protocol,  # type: ignore[arg-type]
        status=record.status,  # type: ignore[arg-type]
        display_name=record.display_name,
        login_policy=record.login_policy,  # type: ignore[arg-type]
        jit_policy=record.jit_policy,  # type: ignore[arg-type]
        default_role=record.default_role,  # type: ignore[arg-type]
        allowed_domains=list(record.allowed_domains),
        oidc_issuer_url=record.oidc_issuer_url,
        oidc_discovery_url=record.oidc_discovery_url,
        oidc_authorization_endpoint=record.oidc_authorization_endpoint,
        oidc_token_endpoint=record.oidc_token_endpoint,
        oidc_jwks_uri=record.oidc_jwks_uri,
        oidc_userinfo_endpoint=record.oidc_userinfo_endpoint,
        oidc_client_id=record.oidc_client_id,
        oidc_client_secret_configured=record.oidc_client_secret_configured,
        oidc_scopes=list(record.oidc_scopes),
        oidc_token_endpoint_auth_method=record.oidc_token_endpoint_auth_method,  # type: ignore[arg-type]
        oidc_redirect_uri=oidc_redirect_uri,
        saml_idp_metadata_url=record.saml_idp_metadata_url,
        saml_idp_metadata_xml_configured=record.saml_idp_metadata_xml_configured,
        saml_idp_entity_id=record.saml_idp_entity_id,
        saml_sso_url=record.saml_sso_url,
        saml_x509_cert_configured=record.saml_x509_cert_configured,
        saml_email_attribute=record.saml_email_attribute,
        saml_acs_url=saml_acs_url,
        saml_entity_id=saml_entity_id,
        saml_metadata_url=saml_metadata_url,
        tested_at=record.tested_at.isoformat() if record.tested_at else None,
        last_error=record.last_error,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )
