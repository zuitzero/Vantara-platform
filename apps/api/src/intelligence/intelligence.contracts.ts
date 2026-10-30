/** AI-01 design contracts only. Not registered with Nest; no operational capability. */
export type Language = 'es' | 'en';
export type DraftCategory = 'HOUSEKEEPING' | 'MAINTENANCE' | 'FRONT_DESK';
export interface GuestMessage { language: Language; text: string }
export interface GuestConfirmation { draftId: string; draftRevision: string; confirmed: true; idempotencyKey: string }

/** Server-only projection of freshly resolved Connect access, never accepted from HTTP/model. */
export interface LiveStay {
  tenantType: 'HOTEL'; tenantId: string; propertyId: string; reservationId: string;
  accessId: string; accessBinding: string; expiresAt: number; revoked: boolean;
  reservation: { id: string; tenantId: string; propertyId: string; propertyTenantId: string; status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELED' | 'NO_SHOW'; checkOut: number };
}
export interface ApprovedKnowledge {
  id: string; revision: string; tenantId: string; propertyId: string;
  approved: true; validUntil: number; text: Partial<Record<Language, string>>;
}
/** Intent fields carry no resource identifiers, permissions, executable tools or answer prose. */
export type Intent =
  | { kind: 'knowledge'; factIds: string[] }
  | { kind: 'request_draft'; category: DraftCategory; title: string; message: string }
  | { kind: 'handoff' }
  | { kind: 'unsupported' };
export interface RequestDraft {
  id: string; revision: string; scope: Pick<LiveStay, 'tenantId' | 'propertyId' | 'reservationId' | 'accessId' | 'accessBinding'>;
  expiresAt: number; state: 'PENDING_CONFIRMATION' | 'CONSUMED' | 'CANCELED';
  payload: Extract<Intent, { kind: 'request_draft' }>;
}
export type FallbackReason = 'UNSUPPORTED' | 'NO_APPROVED_KNOWLEDGE' | 'PROVIDER_UNAVAILABLE';
export type AssistantReply =
  | { kind: 'answer'; language: Language; facts: { id: string; revision: string; text: string }[] }
  | { kind: 'fallback'; language: Language; reason: FallbackReason; message: string; next: 'CONTACT_FRONT_DESK' }
  | { kind: 'draft'; language: Language; draftId: string; draftRevision: string; expiresAt: number; requiresConfirmation: true; preview: RequestDraft['payload'] };

// Proposed adapters, not implementations or Nest providers. Unknown outputs must be validated.
export interface ConnectAccessResolver { resolvePrivateToken(token: string): Promise<LiveStay> }
export interface HotelKnowledgeSource { approvedForStay(scope: LiveStay): Promise<unknown> }
declare const privacyReviewed: unique symbol;
/** Only a reviewed privacy adapter may construct this; a TS brand is not runtime security. */
export type RedactedText = string & { readonly [privacyReviewed]: true };
export interface GuestPrivacyBoundary { minimize(message: GuestMessage): Promise<{ safe: true; text: RedactedText } | { safe: false }> }
export interface ProviderInput { language: Language; text: RedactedText; facts: { reference: string; text: string }[] }
export interface IntentProvider { interpret(input: ProviderInput): Promise<unknown> }
export interface DraftStore {
  // Future implementation must scope ALL operations and verify ownership, not just IDs.
  savePending(scope: LiveStay, draft: RequestDraft): Promise<void>;
  findPending(scope: LiveStay, draftId: string): Promise<RequestDraft | null>;
}
export interface DraftPolicy { allowedCategories(scope: LiveStay): Promise<readonly DraftCategory[]> }
export interface AssistantTelemetry {
  record(event: { outcome: 'ANSWER' | 'DRAFT' | 'FALLBACK' | 'REJECTED'; language: Language; durationBucket: 'FAST' | 'SLOW' }): void;
}
// Deliberately no request executor, provider client, prompt builder, controller or module.
