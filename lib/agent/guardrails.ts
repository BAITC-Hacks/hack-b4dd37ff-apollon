import type { InputGuardrail, OutputGuardrail } from "@openai/agents";

export function requestsPrivateCustomerData(text: string): boolean {
  return /(?:de[ -]?anonym|re[ -]?identif|real\s+(?:customer|client)\s+(?:name|identit)|customer\s+(?:phone|email|address)|raw\s+customer|деаноним|реальн\S*\s+(?:имя|имен|клиент)|(?:имя|имена|телефон|почт|адрес|фио|личност)\S*\s+(?:покупател|клиент)|персональн\S*\s+данн)/iu.test(text);
}

export function claimsUnauthorizedAction(text: string): boolean {
  const sentences = text.split(/[.!?\n]/u);
  return sentences.some(sentence => {
    // A statement explaining the boundary must remain possible.
    if (/\b(?:not|never|cannot|can't|unable|only\s+(?:a\s+)?manager)\b|\bне\s|не\s+(?:отправ|утвержд|могу)|только\s+менеджер/iu.test(sentence)) return false;
    return /\b(?:i|we)\s+(?:have\s+)?(?:sent|submitted|approved|dispatched)\b|\b(?:order|purchase)\s+(?:has\s+been\s+|was\s+|is\s+)?(?:sent|approved|dispatched)\b|(?:я|мы)\s+(?:отправил|отправили|утвердил|утвердили)|заказ\S*\s+(?:успешно\s+)?(?:отправлен|утвержд[её]н)|(?:отправил|утвердил)\S*\s+заказ/iu.test(sentence);
  });
}

export const customerPrivacyGuardrail: InputGuardrail = {
  name: "No customer re-identification or raw personal data",
  runInParallel: false,
  async execute({ input }) {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    const blocked = requestsPrivateCustomerData(text);
    return { tripwireTriggered: blocked, outputInfo: { blocked, rule: "customer_privacy" } };
  },
};

export const applicationApprovalGuardrail: OutputGuardrail = {
  name: "Application owns approval; no supplier dispatch",
  async execute({ agentOutput }) {
    const blocked = claimsUnauthorizedAction(typeof agentOutput === "string" ? agentOutput : JSON.stringify(agentOutput));
    return { tripwireTriggered: blocked, outputInfo: { blocked, rule: "application_approval" } };
  },
};
