// =============================================================================
// Klygenix Play — shared interfaces
//
// These mirror the Pydantic response models field for field. The contract sweep
// checks both directions against a live API, so a field renamed here and not
// there is caught rather than silently rendering an em-dash forever.
// =============================================================================

// === CORE ====================================================================

export interface UserInfo {
  id: number
  tenant_id: number | null
  email: string
  name: string
  role: "global_admin" | "owner" | "admin" | "user"
  is_active: boolean
  products: string[]
  last_login: string | null
  phone?: string | null
  tenant_name?: string | null
  settings?: UserSettings
  email_verified?: boolean
  totp_enabled?: boolean
  must_enrol_totp?: boolean
  impersonated_by?: ImpersonatedBy | null
}

export interface UserSettings {
  theme?: Record<string, string>
  /** The language the studio is shown in for this user (null: follow the store). */
  language?: "en" | "hi" | "mr" | "bn" | "ta" | "te" | null
}

export interface Tenant {
  id: number
  name: string
  slug: string
  plan: string
  gst_number: string | null
  address: string | null
  city: string | null
  state: string | null
  pin_code: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  primary_color: string | null
  max_users: number
  license_start: string
  license_end: string
  amc_active: boolean
  is_active: boolean
  settings: Record<string, any>
  created_at: string
  products: string[]
  owner_name: string | null
  owner_email: string | null
}

export interface TenantModule {
  id: number
  tenant_id: number
  module_name: string
  is_enabled: boolean
  config: Record<string, any>
}

export interface TenantPayment {
  id: number
  tenant_id: number
  amount: number
  payment_date: string
  payment_type: "license" | "amc"
  period_start: string
  period_end: string
  method: string | null
  reference: string | null
  notes: string | null
  created_at: string
}

export interface CustomField {
  id: number
  tenant_id: number
  module_name: string
  field_name: string
  field_label: string
  field_type: "text" | "number" | "dropdown" | "date" | "checkbox"
  options: string[] | null
  is_required: boolean
  display_order: number
  is_active: boolean
}

export interface AdminStats {
  total_tenants: number
  active_tenants: number
  expired_tenants: number
  total_revenue_minor: number
  currency: string
  recent_onboardings: Tenant[]
}

// === ACCESS CONTROL ==========================================================

export type AccessLevel = "none" | "view" | "full"

export interface RolePermission {
  permission_key: string
  access_level: AccessLevel
}

export type RolePermissionsMap = Record<string, AccessLevel>

export interface FeatureItem {
  key: string
  label: string
}

export interface FeatureGroup {
  label: string
  items: FeatureItem[]
}

export interface PermissionCatalog {
  label: string
  groups: FeatureGroup[]
  roles: { role: string; label: string; hint: string }[]
  levels: AccessLevel[]
  defaults: Record<string, RolePermissionsMap>
}

// === ACTIVITY ================================================================

export interface ActivityEvent {
  id: number
  tenant_id: number | null
  user_id: number | null
  user_name: string | null
  occurred_at: string
  app: string
  kind: "login" | "view" | "create" | "update" | "delete"
  label: string
  method: string
  path: string
  entity_id: string | null
  status_code: number
  duration_ms: number | null
}

// === MONEY ===================================================================

/**
 * Money crosses the wire as an integer in the currency's minor unit, always with
 * its currency beside it. Never a float, never a bare number — see the master plan
 * §08 rule 01. Format it only at the display edge, with @klygenixvideo/client.
 */
export interface Money {
  amount_minor: number
  currency: string
}

// === CONSTANTS ===============================================================

export const USER_ROLES = ["global_admin", "owner", "admin", "user"] as const
export type UserRole = (typeof USER_ROLES)[number]

/** Apps on this platform. A new surface adds its key here and in feature_catalog.py. */
export const PRODUCTS = ["pay"] as const
export type Product = (typeof PRODUCTS)[number]

export const ACCESS_LEVELS = ["none", "view", "full"] as const

// === STORE ===================================================================
// Mirrors app/store/present.py field for field — the one place the backend shapes
// a store, a product card and a page for the wire.

export type ProductKind =
  | "download" | "licence" | "course" | "cohort" | "membership" | "community" | "event"
  | "booking" | "package" | "post" | "bundle" | "payment" | "lead_magnet"

export interface StoreTheme {
  accent?: string
  background?: "white" | "warm" | "tint"
  font?: "bricolage" | "manrope"
  button?: "rounded" | "pill" | "square"
  layout?: "bio" | "showcase"
  radius?: "soft" | "sharp"
}

export interface ProductStats {
  rating_average: number | null
  rating_count: number
  /** Distinct buyers, present only from ten upwards. */
  buyers: number | null
}

export interface ReviewHighlight {
  rating: number
  title: string | null
  body: string | null
  name: string
  product: { title: string; slug: string }
}

export interface StoreLink {
  label: string
  url: string
}

export interface StoreProfile {
  refund_window_days?: number
  id: number
  handle: string
  display_name: string
  headline: string | null
  bio: string | null
  avatar_url: string | null
  cover_url: string | null
  theme: StoreTheme
  links: StoreLink[]
  socials: { network: string; url: string }[]
  currency: string
  legal_name: string | null
  address: string | null
  gstin: string | null
  support_email: string | null
  support_phone: string | null
  refund_policy: string | null
  grievance_officer: Record<string, string>
  is_published: boolean
  affiliate_enabled: boolean
  affiliate_cookie_days: number
  buyer_referrals?: boolean
  /** Only the ids a public page may carry — the seller's own pixel and GA4 property. */
  tracking?: StoreTracking
  cover_meta?: ImageMeta | null
  avatar_meta?: ImageMeta | null
}

export interface ImageMeta {
  width: number
  height: number
  placeholder: string
  color: string
}

export interface UploadedImage {
  url: string
  variants: Record<string, string>
  width: number | null
  height: number | null
  placeholder: string | null
  color: string | null
}

export interface ProductCard {
  id: number
  kind: ProductKind
  title: string
  slug: string
  subtitle: string | null
  cover_url: string | null
  pricing: "fixed" | "pwyw" | "free"
  price_minor: number
  compare_at_minor: number | null
  min_price_minor: number
  currency: string
  status: "draft" | "published" | "archived"
  seats_left: number | null
  interval: "month" | "year" | null
  starts_at: string | null
  /** Prices the seller set for buyers abroad, in that currency's minor units, e.g. {USD: 1900}. */
  prices?: Record<string, number>
  /** Set when the price above is shown in the visitor's currency: the store's own price. */
  home_price?: { currency: string; price_minor: number }
  category?: string | null
  featured?: boolean
  stats?: ProductStats
}

export interface ProductPublic extends ProductCard {
  description: string | null
  tax_inclusive: boolean
  access_days: number | null
  settings: Record<string, any>
  cover_meta?: ImageMeta | null
}

export interface PageBlock {
  id: string
  type: string
  props: Record<string, any>
}

export interface StorePage {
  id: number
  title: string
  seo_title: string | null
  seo_description: string | null
  og_image_url: string | null
  blocks: PageBlock[]
  status: "draft" | "published"
  variant?: "A" | "B"
}

export interface OutlineLesson {
  id: number
  title: string
  kind: string
  duration_seconds: number
  is_preview: boolean
  locked: boolean
  unlocks_at: string | null
  completed: boolean
  position_seconds: number
}

export interface OutlineModule {
  id: number
  title: string
  lessons: OutlineLesson[]
}

export interface BumpOffer {
  offer_id: number
  headline: string
  description: string | null
  product: ProductCard
  price_minor: number
  selected?: boolean
}

// === PHASE 2: ABROAD, GIFTS, REVIEWS, CERTIFICATES ===========================

export interface ReviewPublic {
  rating: number
  title: string | null
  body: string | null
  name: string
  created_at: string
}

export interface ReviewSummary {
  count: number
  average: number | null
  items: ReviewPublic[]
}

/** The merchant of record's currency, when the store sells abroad through one. */
export interface AbroadInfo {
  currency: string
}

/** Where the visitor is (Cloudflare's CF-IPCountry) and the currency prices are shown in. */
export interface VisitorInfo {
  country: string | null
  currency: string
}

export interface PayResponse {
  status: "paid" | "pending"
  order_number?: string
  order_id?: number
  rail?: "razorpay" | "sandbox" | "lemonsqueezy" | string
  /** Rail-specific. A merchant of record carries `mor: true` and a hosted `url`. */
  payment?: Record<string, any> & { mor?: boolean; url?: string }
}

export interface CheckoutStatus {
  status: string
  public_id: string
  order_number?: string
  email?: string
  library_link?: string
  next_step?: { funnel: string; step: string; kind: string } | null
}

export interface CertificatePublic {
  code: string
  name: string
  product: string
  store: string
  issued_at: string
}

export interface BuyerReview {
  rating: number
  title: string | null
  body: string | null
  status: "pending" | "approved" | "hidden"
}

export interface BuyerCertificate {
  code: string
  issued_at: string
}

export interface GiftClaimResponse {
  token: string
  buyer: { id: number; email: string; name: string | null; phone: string | null; whatsapp_opt_in: boolean; email_marketing: boolean }
  store: StoreProfile
  entitlement_id: number
}

// ── studio, Phase 2 (routers/studio_growth.py) ────────────────────────────────

/** An email to buyers who opted in. `product_ids` empty = every opted-in buyer. */
export interface Broadcast {
  id: number
  subject: string
  body: string
  product_ids: number[]
  status: "draft" | "sending" | "sent"
  recipients: number
  sent_at: string | null
  created_at: string
}

export interface BroadcastAudience {
  recipients: number
  buyers: number
}

export type ReviewStatus = "pending" | "approved" | "hidden"

export interface StudioReview {
  id: number
  product_id: number
  product_title: string | null
  rating: number
  title: string | null
  body: string | null
  display_name: string | null
  status: ReviewStatus
  created_at: string
}

/** GET /settings/mor — the merchant of record that sells to buyers outside India. */
export interface MorSettings {
  provider: "lemonsqueezy"
  connected: boolean
  store_id: string | null
  config: { variant_id?: string; currency?: string; mor_name?: string; mor_address?: string | null }
  has_api_key: boolean
  has_signing_secret: boolean
  webhook_url: string
}

export interface ExportSummaryLine {
  title: string
  currency: string
  orders: number
  gross_minor: number
  refunded_minor: number
  net_minor: number
}

export interface ExportSummary {
  period_start: string
  period_end: string
  orders: number
  net_by_currency: Record<string, number>
  lines: ExportSummaryLine[]
}

/** A monthly export-of-services invoice to the merchant of record. `total_minor` is INR. */
export interface ExportInvoice {
  id: number
  number: string
  invoice_date: string
  period_start: string | null
  period_end: string | null
  total_minor: number
  fira_reference: string | null
  buyer: string | null
  has_pdf: boolean
}

/** Public tracking ids on the store; the server-side secrets are the `meta` and `ga4` channels. */
export interface StoreTracking {
  meta_pixel_id?: string | null
  ga4_measurement_id?: string | null
}

// ── payouts, Phase 3 (routers/studio_payouts.py, routers/admin_money.py) ──────
export type PayoutAccountStatus =
  | "draft" | "submitted" | "under_review" | "needs_clarification" | "activated" | "suspended" | "rejected"

export type BusinessType =
  | "individual" | "proprietorship" | "partnership" | "private_limited" | "public_limited" | "llp" | "trust" | "society" | "ngo"

export interface PayoutAddress {
  street1?: string
  street2?: string
  city?: string
  state?: string
  postal_code?: string
}

export interface PayoutAccount {
  status: PayoutAccountStatus
  business_type: BusinessType | null
  legal_name: string
  contact_name: string
  email: string
  phone: string
  pan: string | null
  gstin: string | null
  address: PayoutAddress
  beneficiary_name: string | null
  ifsc: string | null
  account_last4: string | null
  requirements: { field: string; reason: string }[]
  gateway_account_id: string | null
  submitted_at: string | null
  activated_at: string | null
  editable: boolean
}

export interface PayoutBalances {
  held_minor: number
  reserve_minor: number
  pending_minor: number
  owed_back_minor: number
  released_minor: number
  next_release_at: string | null
}

export interface PayoutSummary extends PayoutBalances {
  selling_mode: "own" | "marketplace"
  review_status: string
  selling_problem: string | null
  plan: { key: string; name: string; commission_bps: number }
  refund_window_days: number
  reserve_bps: number
  reserve_days: number
  account: PayoutAccount | null
}

export type TransferKind = "sale" | "reserve" | "recovery"
export type TransferStatus = "pending" | "held" | "released" | "reversed" | "recovered" | "failed"

export interface PayoutTransfer {
  id: number
  kind: TransferKind
  status: TransferStatus
  amount_minor: number
  reversed_minor: number
  open_minor: number
  order_id: number | null
  order_number: string | null
  hold_until: string | null
  released_at: string | null
  note: string | null
  error: string | null
  created_at: string
}

export interface StatementFigures {
  gross_minor: number
  refunded_minor: number
  commission_minor: number
  commission_tax_minor: number
  tcs_minor: number
  tds_minor: number
  net_minor: number
}

export interface StatementRow extends StatementFigures {
  order_number: string
  paid_at: string
  commission_bps: number
}

export interface PayoutStatement {
  month: string
  rows: StatementRow[]
  totals: StatementFigures
}

export interface CommissionInvoice {
  id: number
  number: string
  invoice_date: string
  period_start: string | null
  period_end: string | null
  taxable_minor: number
  tax_minor: number
  total_minor: number
  has_pdf: boolean
}

export interface CreatorMoneyRow extends PayoutBalances {
  tenant_id: number
  handle: string
  name: string
  review_status: string
  plan: string
  payout_status: PayoutAccountStatus | null
  ledger_owed_minor: number
  identity_ok: boolean
}

export interface AdminTransfer {
  id: number
  tenant_id: number
  handle: string
  kind: TransferKind
  status: TransferStatus
  amount_minor: number
  reversed_minor: number
  order_number: string | null
  gateway_transfer_id: string | null
  hold_until: string | null
  released_at: string | null
  error: string | null
  created_at: string
}

export interface AdminPayoutAccount extends PayoutAccount {
  tenant_id: number
  handle: string
}

export interface AdminCommissionInvoice {
  id: number
  number: string
  invoice_date: string
  tenant_id: number | null
  buyer: string | null
  gstin: string | null
  taxable_minor: number
  tax_minor: number
  total_minor: number
  period_start: string | null
  period_end: string | null
  has_pdf: boolean
}

export interface Gstr8Row {
  gstin: string
  handle: string
  tenant_id: number
  sales: number
  gross_taxable: number
  returns_taxable: number
  net_taxable: number
  tcs_igst: number
  tcs_cgst: number
  tcs_sgst: number
}

export interface Gstr8Extract {
  month: string
  rows: Gstr8Row[]
  totals: { net_taxable: number; tcs_igst: number; tcs_cgst: number; tcs_sgst: number }
}

export interface Tds194oRow {
  pan: string
  handle: string
  tenant_id: number
  sales: number
  gross: number
  tds: number
  rate_bps: number
}

export interface Tds194oExtract {
  month: string
  rows: Tds194oRow[]
  totals: { gross: number; tds: number }
}

// ── trust and safety, Phase 3 (routers/admin_platform.py, routers/admin_plans.py) ──

export type StoreReviewStatus = "pending" | "approved" | "suspended"
export type ContentReportStatus = "open" | "actioned" | "dismissed"

export interface PlatformStoreRow {
  tenant_id: number
  store_id: number
  is_platform?: boolean
  handle: string
  display_name: string
  tenant_name: string
  owner_email: string | null
  owner_name: string | null
  created_at: string | null
  selling_mode: "own" | "marketplace"
  review_status: StoreReviewStatus
  review_note: string | null
  reviewed_at: string | null
  is_published: boolean
  payout_status: string | null
  plan_key: string | null
  plan_status: string | null
  open_reports: number
  products: { total?: number; published?: number; taken_down?: number }
}

export interface PlatformProduct {
  id: number
  title: string
  slug: string
  kind: ProductKind
  status: "draft" | "published" | "archived"
  moderation: "ok" | "taken_down"
  moderation_reason: string | null
  pricing: "fixed" | "pwyw" | "free"
  price_minor: number
  currency: string
  cover_url: string | null
}

export interface ModerationEntry {
  id: number
  target_type: "store" | "product"
  target_id: number
  action: string
  reason: string | null
  report_id: number | null
  actor_user_id: number | null
  actor: string | null
  created_at: string | null
}

export interface ContentReport {
  id: number
  tenant_id: number
  handle: string | null
  store_name: string | null
  product_id: number | null
  product_title: string | null
  reason: string
  details: string | null
  reporter_email: string | null
  reporter_ip: string | null
  status: ContentReportStatus
  resolution: string | null
  resolved_by_user_id: number | null
  resolved_at: string | null
  created_at: string | null
}

export interface PlatformStoreDetail extends PlatformStoreRow {
  product_list: PlatformProduct[]
  history: ModerationEntry[]
  reports: ContentReport[]
  legal_name: string | null
  gstin: string | null
  pan: string | null
  address: string | null
  state_code: string | null
  support_email: string | null
  bio: string | null
  headline: string | null
  avatar_url: string | null
  refund_policy: string | null
  tenant_verified: boolean
  storefront_url: string
}

export interface SupportSession {
  id: number
  tenant_id: number
  handle?: string | null
  staff_user_id: number
  staff: string | null
  target_user_id: number
  target: string | null
  reason: string
  started_at: string | null
  expires_at: string | null
  ended_at: string | null
  active: boolean
}

export interface SupportSessionStart {
  access_token: string
  token_type: string
  user: UserInfo
  session: SupportSession
  studio_url: string
}

export interface PlanLimits {
  products: number | null
  team_seats: number | null
  storage_mb: number | null
  funnels: number | null
  custom_domain: boolean
  affiliates: boolean
  broadcasts: boolean
}

export interface PlatformPlan {
  id: number
  key: string
  name: string
  description: string | null
  price_minor: number
  commission_bps: number
  limits: Partial<PlanLimits>
  is_active: boolean
  sort: number
  subscribers: number
}

// ── opening to creators, the studio's side (routers/studio_billing.py, studio_domains.py) ──

export interface ImpersonatedBy {
  session_id: number
  staff_user_id: number
  staff_email: string | null
  staff_name: string | null
  reason: string
  expires_at: string
}

export type OnboardingStepKey = "profile" | "product" | "payouts" | "review" | "published"

export interface Onboarding {
  steps: { key: OnboardingStepKey; label: string; done: boolean }[]
  complete: boolean
  selling_problem: string | null
  selling_mode: "own" | "marketplace"
  review_status: StoreReviewStatus
  review_note: string | null
  payout_status: PayoutAccountStatus | null
}

export interface CreatorPlan {
  key: string
  name: string
  description: string | null
  price_minor: number
  gst_rate_bps: number
  price_with_gst_minor: number
  commission_bps: number
  limits: Partial<PlanLimits>
  sort: number
}

export interface PlanSubscription {
  plan_key: string
  status: "active" | "past_due" | "cancelled"
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  pending_plan_key: string | null
  grace_until: string | null
}

export interface PlanUsage {
  products: { used: number; limit: number | null }
  team_seats: { used: number; limit: number | null }
  funnels: { used: number; limit: number | null }
  custom_domain: { used: number; allowed: boolean }
  affiliates: { allowed: boolean }
  broadcasts: { allowed: boolean }
  storage_mb: { limit: number | null }
}

export interface BillingOverview {
  selling_mode: "own" | "marketplace"
  limits_apply: boolean
  plan: CreatorPlan
  subscription: PlanSubscription | null
  usage: PlanUsage
  plans: CreatorPlan[]
}

export interface BillingCheckout {
  public_id: string
  rail: "sandbox" | "razorpay" | string
  amount: number
  currency: string
  plan: CreatorPlan
  taxable_minor: number
  tax_minor: number
  key_id?: string
  order_id?: string
  prefill?: Record<string, string>
  name?: string
  description?: string
}

export interface BillingPayment {
  id: number
  public_id: string
  plan_key: string
  taxable_minor: number
  tax_minor: number
  total_minor: number
  status: string
  rail: string
  period_start: string | null
  period_end: string | null
  has_invoice: boolean
  created_at: string
  paid_at: string | null
}

export interface DnsRecord {
  type: string
  name: string
  value: string
}

export interface StoreDomain {
  id: number
  hostname: string
  status: "pending" | "active" | "failed"
  dns_records: DnsRecord[]
  ssl_status: string | null
  error: string | null
  last_checked_at: string | null
  verified_at: string | null
  created_at: string | null
  provider: "cloudflare" | "dns"
}

export interface StoreDomains {
  domains: StoreDomain[]
  target: string
  provider: "cloudflare" | "dns"
}

export type ReportReason = "copyright" | "prohibited" | "misleading" | "fraud" | "adult" | "other"

export interface BuyerReferral {
  available: boolean
  joined: boolean
  status: string | null
  commission_rate_bps: number
  cookie_days: number
  code: string | null
  link: string | null
  portal_url: string
}

export interface PlanSubscription {
  auto_renew: boolean
  next_charge_at: string | null
}

export interface AutoRenewStart extends BillingCheckout {
  subscription_id: string
  first_charge_at: string
  deferred: boolean
}

export type GstSectionKey =
  | "b2b" | "b2cl" | "b2cs" | "cdnr" | "cdnur" | "exp" | "nil" | "hsn_b2b" | "hsn_b2c" | "docs" | "eco"

export interface GstItem {
  rate_bps: number
  taxable_minor: number
  igst_minor: number
  cgst_minor: number
  sgst_minor: number
}

export interface GstSection {
  label: string
  rows: Record<string, any>[]
  totals: Record<string, number>
}

export interface Gst3bHead {
  taxable_minor: number
  igst_minor: number
  cgst_minor: number
  sgst_minor: number
  cess_minor: number
}

export interface GstTaxSplit {
  igst_minor: number
  cgst_minor: number
  sgst_minor: number
  total_minor: number
}

export interface Gstr3b {
  "3_1_a": Gst3bHead
  "3_1_b": Gst3bHead
  "3_1_c": Gst3bHead
  "3_1_d": Gst3bHead
  "3_1_e": Gst3bHead
  "3_2": { unregistered: { pos: string; pos_name: string; taxable_minor: number; igst_minor: number }[] }
  "4": { available_minor: number; on_commission: GstTaxSplit; other_minor: number; reversed_minor: number; net_minor: number }
  "6_1": { liability: GstTaxSplit; itc_minor: number; tcs_credit_minor: number; estimated_cash_minor: number }
  tcs_credit: (GstTaxSplit & { sales: number }) | null
  notes: string[]
}

export interface GstWarning {
  code: string
  message: string
  document: string | null
}

export interface GstReturnFiled {
  month: string
  fp: string
  period_start: string
  period_end: string
  registered: true
  gstin: string
  legal_name: string
  state_code: string | null
  selling_mode: string
  eco: { gstin: string | null; name: string } | null
  b2cl_threshold_minor: number
  disclaimer: string
  gstr1: {
    sections: Record<GstSectionKey, GstSection>
    order: GstSectionKey[]
    totals: { documents: number; taxable_minor: number; igst_minor: number; cgst_minor: number; sgst_minor: number; tax_minor: number }
  }
  gstr3b: Gstr3b
  warnings: GstWarning[]
}

export interface GstReturnUnregistered {
  month: string
  fp: string
  period_start: string
  period_end: string
  registered: false
  gstin: null
  message: string
  disclaimer: string
}

export type GstReturn = GstReturnFiled | GstReturnUnregistered

/** A language the store's pages and emails can be shown in (app/store/i18n.py SUPPORTED). */
export type StoreLanguage = "en" | "hi" | "mr" | "bn" | "ta" | "te"

export const STORE_LANGUAGES: { code: StoreLanguage; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
]

/** GET /api/store/public/languages — every language a store's pages can offer. */
export interface LanguageInfo {
  code: StoreLanguage
  name: string
  english_name: string
  locale: string
  script: string
  dir: "ltr" | "rtl"
}

export interface LanguagesResponse {
  default: StoreLanguage
  languages: LanguageInfo[]
}

/** The seller's own words for a product in another language — product.settings.i18n[lang]. */
export interface ProductTranslation {
  title?: string
  subtitle?: string
  description?: string
}

export interface StoreProfile {
  /** The default language of the store's pages and buyer emails. */
  language?: StoreLanguage
  /** The languages buyers can switch between; always includes "en". */
  languages?: StoreLanguage[]
}

export interface ProductCard {
  /** The language title/subtitle/description came back in — "en" when no translation exists. */
  lang?: StoreLanguage
  /** The seller's own text in other languages, e.g. {hi: {title, subtitle}}; product pages add the description. */
  translations?: Partial<Record<StoreLanguage, ProductTranslation>>
}

// ── launch readiness (core/routers/readiness.py) ──

export type ReadinessSeverity = "block" | "warn"

export interface ReadinessCheck {
  key: string
  title: string
  group: string
  severity: ReadinessSeverity
  ok: boolean
  detail: string
  fix: string
}

export interface ReadinessReport {
  ready: boolean
  blocking_failed: number
  warnings: number
  checked_at: string
  checks: ReadinessCheck[]
}
