import type { EvidenceType } from "@/evidence/types";

export type StaticFactType =
  | "scan_coverage"
  | "form_found"
  | "form_fields"
  | "personal_data_collection_found"
  | "consent_control_found"
  | "pd_consent_control_found"
  | "control_prechecked_static"
  | "consent_text"
  | "marketing_consent_control_found"
  | "marketing_subscription_detected"
  | "advertising_signal"
  | "ad_candidate_detected"
  | "ad_label_text_found"
  | "advertiser_identity_or_link_found"
  | "erid_token_candidate"
  | "privacy_policy_link_found"
  | "privacy_policy_url"
  | "privacy_policy_text"
  | "consumer_page_text"
  | "foreign_only_consumer_info_signal"
  | "public_non_ad_consumer_info_foreign_only"
  | "recommendation_technology_signal"
  | "recommendation_technology_suspected"
  | "recommendation_technology_confirmed"
  | "recommendation_notice_candidate"
  | "recommendation_rules_document_link"
  | "recommendation_rules_text"
  | "policy_access_from_collection_page"
  | "offer_link_found"
  | "offer_url"
  | "document_links"
  | "seller_legal_name_candidate"
  | "ogrn_candidate"
  | "ogrnip_candidate"
  | "seller_fio_candidate"
  | "seller_address_candidate"
  | "seller_email_found"
  | "seller_phone_found"
  | "working_hours_candidate"
  | "price_occurrence"
  | "ruble_price_found"
  | "form_action_target";

export type BrowserFactType =
  | "browser_audit_coverage"
  | "rendered_form_found"
  | "rendered_personal_data_collection_found"
  | "rendered_consent_control_found"
  | "rendered_consent_checked"
  | "rendered_consent_text"
  | "rendered_marketing_consent_found"
  | "rendered_marketing_consent_checked"
  | "rendered_form_action_target"
  | "network_request_hosts"
  | "script_sources_rendered"
  | "iframe_sources_rendered"
  | "cookie_metadata"
  | "local_storage_keys"
  | "session_storage_keys"
  | "auth_provider_candidates_rendered"
  | "paid_addon_control_found"
  | "paid_addon_preselected"
  | "external_service_matches"
  | "external_service_detected"
  | "foreign_provider_signal_found"
  | "external_service_hosts_unmatched"
  | "policy_url_accessible"
  | "offer_accessible"
  | "remote_sale_detected"
  | "seller_kind"
  | "legal_name_found"
  | "ogrn_found"
  | "ogrnip_found"
  | "seller_address_found"
  | "seller_fio_found"
  | "price_found"
  | "consumer_offer_detected"
  | "ip_registration_info_found"
  | "legal_name_or_address_or_working_hours_missing";

export type ExtractedFactType = StaticFactType | BrowserFactType;

export interface ExtractedEvidence {
  evidenceType: EvidenceType;
  pageUrl: string;
  payload: Record<string, unknown>;
  storageRef?: string;
}

export interface ExtractedFact {
  pageUrl?: string;
  factType: ExtractedFactType;
  value: Record<string, unknown>;
  evidence: ExtractedEvidence[];
}

export interface StaticExtractionOptions {
  crawlCompleted: boolean;
  startUrl?: string;
  maxPagesReached?: boolean;
}

export interface StaticExtractionResult {
  facts: ExtractedFact[];
}
