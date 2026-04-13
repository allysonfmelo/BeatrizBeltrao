/**
 * Masks a CPF for display: 123.456.789-00 -> 123.***.***-00
 */
export function maskCpf(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, "");
  if (cleaned.length !== 11) return "***.***.***-**";
  return `${cleaned.slice(0, 3)}.***.***-${cleaned.slice(9)}`;
}

/**
 * Formats a price in BRL: 15000 -> "R$ 150,00"
 */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

/**
 * Calculates deposit amount (30% of total)
 */
export function calculateDeposit(totalPrice: number, percentage = 30): number {
  return Math.round((totalPrice * percentage) / 100);
}

/**
 * Formats a Brazilian phone number for display: 5581999998888 -> "+55 (81) 99999-8888"
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const match = digits.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (!match) return phone;
  const [, country, area, prefix, suffix] = match;
  return `+${country} (${area}) ${prefix}-${suffix}`;
}

/**
 * Returns the first token of a full name (collapses inner whitespace).
 */
export function extractFirstName(fullName: string): string {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  return normalized.split(" ")[0] ?? normalized;
}
