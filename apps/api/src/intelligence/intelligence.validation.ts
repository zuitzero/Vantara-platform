import type { ApprovedKnowledge, AssistantReply, DraftCategory, FallbackReason, GuestConfirmation, GuestMessage, Intent, Language, LiveStay, RequestDraft } from './intelligence.contracts';

export class IntelligenceContractError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'ACCESS_DENIED' | 'KNOWLEDGE_DENIED' | 'CONFIRMATION_DENIED' | 'AI01_DISABLED') { super(code); this.name = 'IntelligenceContractError'; }
}
const deny = (code: IntelligenceContractError['code']): never => { throw new IntelligenceContractError(code); };
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return deny('INVALID_INPUT');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !keys.includes(key))) return deny('INVALID_INPUT');
  return result;
}
function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value) || value.trim().length < min) return deny('INVALID_INPUT');
  return value.trim();
}
function reference(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) return deny('INVALID_INPUT');
  return value;
}
function language(value: unknown): Language { if (value !== 'es' && value !== 'en') return deny('INVALID_INPUT'); return value; }
function time(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return deny('INVALID_INPUT'); return value; }
export function parseGuestMessage(input: unknown): GuestMessage {
  const row = object(input, ['language', 'text']); return { language: language(row.language), text: text(row.text, 1000) };
}
export function parseConfirmation(input: unknown): GuestConfirmation {
  const row = object(input, ['draftId', 'draftRevision', 'confirmed', 'idempotencyKey']);
  if (row.confirmed !== true) return deny('CONFIRMATION_DENIED');
  if (reference(row.idempotencyKey).length < 16) return deny('INVALID_INPUT');
  return { draftId: reference(row.draftId), draftRevision: reference(row.draftRevision), confirmed: true, idempotencyKey: reference(row.idempotencyKey) };
}
export function parseIntent(input: unknown): Intent {
  if (!input || typeof input !== 'object') return deny('INVALID_INPUT');
  const kind = (input as Record<string, unknown>).kind;
  if (kind === 'knowledge') {
    const row = object(input, ['kind', 'factIds']);
    if (!Array.isArray(row.factIds) || row.factIds.length < 1 || row.factIds.length > 8) return deny('INVALID_INPUT');
    const factIds = row.factIds.map(reference); if (new Set(factIds).size !== factIds.length) return deny('INVALID_INPUT');
    return { kind, factIds };
  }
  if (kind === 'request_draft') {
    const row = object(input, ['kind', 'category', 'title', 'message']);
    if (!['HOUSEKEEPING', 'MAINTENANCE', 'FRONT_DESK'].includes(row.category as string)) return deny('INVALID_INPUT');
    return { kind, category: row.category as DraftCategory, title: text(row.title, 120, 2), message: text(row.message, 1000, 2) };
  }
  if (kind === 'handoff' || kind === 'unsupported') { object(input, ['kind']); return { kind }; }
  return deny('INVALID_INPUT');
}
export function parseKnowledge(input: unknown): ApprovedKnowledge {
  const row = object(input, ['id', 'revision', 'tenantId', 'propertyId', 'approved', 'validUntil', 'text']);
  if (row.approved !== true || !row.text || typeof row.text !== 'object' || Array.isArray(row.text)) return deny('INVALID_INPUT');
  const localizations = row.text as Record<string, unknown>; const keys = Object.keys(localizations);
  if (!keys.length || keys.length > 2 || keys.some(key => key !== 'es' && key !== 'en')) return deny('INVALID_INPUT');
  const localized: ApprovedKnowledge['text'] = {};
  for (const key of keys) localized[language(key)] = text(localizations[key], 2000);
  return { id: reference(row.id), revision: reference(row.revision), tenantId: reference(row.tenantId), propertyId: reference(row.propertyId), approved: true, validUntil: time(row.validUntil), text: localized };
}
/** Pure preflight over a SERVER-authenticated projection. It does not authenticate callers. */
export function assertLiveStay(scope: LiveStay, now: number): void {
  if (!Number.isSafeInteger(now) || now <= 0 || scope.tenantType !== 'HOTEL' || !scope.accessId || !scope.accessBinding || !scope.tenantId || !scope.propertyId || !scope.reservationId || scope.revoked || !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt <= now || !Number.isSafeInteger(scope.reservation.checkOut) || scope.reservation.checkOut <= now || !['CONFIRMED', 'CHECKED_IN'].includes(scope.reservation.status) || scope.reservationId !== scope.reservation.id || scope.tenantId !== scope.reservation.tenantId || scope.tenantId !== scope.reservation.propertyTenantId || scope.propertyId !== scope.reservation.propertyId) return deny('ACCESS_DENIED');
}
export function groundAnswer(scope: LiveStay, intentInput: unknown, knowledgeInput: readonly unknown[], locale: Language, now: number): AssistantReply {
  assertLiveStay(scope, now); const lang = language(locale); const intent = parseIntent(intentInput);
  if (intent.kind !== 'knowledge' || knowledgeInput.length > 32) return deny('KNOWLEDGE_DENIED');
  // Validate the WHOLE result set; foreign records cannot enter a shared retrieval cache.
  const facts = knowledgeInput.map(parseKnowledge);
  if (new Set(facts.map(fact => fact.id)).size !== facts.length || facts.some(fact => fact.tenantId !== scope.tenantId || fact.propertyId !== scope.propertyId)) return deny('KNOWLEDGE_DENIED');
  const selected = intent.factIds.map(id => facts.find(fact => fact.id === id));
  if (selected.some(fact => !fact || fact.validUntil <= now || !fact.text[lang])) return fallback(lang, 'NO_APPROVED_KNOWLEDGE');
  return { kind: 'answer', language: lang, facts: selected.map(fact => ({ id: fact!.id, revision: fact!.revision, text: fact!.text[lang]! })) };
}
export function assertDraftAllowed(input: unknown, approvedCategories: readonly DraftCategory[]): Extract<Intent, { kind: 'request_draft' }> {
  const intent = parseIntent(input);
  if (intent.kind !== 'request_draft' || !approvedCategories.includes(intent.category)) return deny('CONFIRMATION_DENIED');
  return intent; // Untrusted preview only: no promise of availability, delivery or price.
}
/** Future AI-03 preflight only. Never returns an executable command or consumes a draft. */
export function assertConfirmation(scope: LiveStay, draft: RequestDraft, input: unknown, now: number): void {
  assertLiveStay(scope, now); const confirmation = parseConfirmation(input);
  if (draft.state !== 'PENDING_CONFIRMATION' || !Number.isSafeInteger(draft.expiresAt) || draft.expiresAt <= now || confirmation.draftId !== draft.id || confirmation.draftRevision !== draft.revision || (['tenantId', 'propertyId', 'reservationId', 'accessId', 'accessBinding'] as const).some(key => draft.scope[key] !== scope[key])) return deny('CONFIRMATION_DENIED');
  if (parseIntent(draft.payload).kind !== 'request_draft') return deny('CONFIRMATION_DENIED');
}
const fallbackMessages: Record<Language, string> = {
  es: 'No puedo confirmar esa información ni realizar acciones. Contacta con recepción o utiliza el formulario de solicitudes de Connect.',
  en: 'I cannot confirm that information or perform actions. Contact the front desk or use the Connect request form.',
};
export function fallback(locale: Language, reason: FallbackReason): AssistantReply {
  const lang = language(locale); if (!['UNSUPPORTED', 'NO_APPROVED_KNOWLEDGE', 'PROVIDER_UNAVAILABLE'].includes(reason)) return deny('INVALID_INPUT');
  return { kind: 'fallback', language: lang, reason, message: fallbackMessages[lang], next: 'CONTACT_FRONT_DESK' };
}
/** All operational execution is forbidden in AI-01, including confirmed drafts. */
export function rejectAi01Execution(): never { return deny('AI01_DISABLED'); }
