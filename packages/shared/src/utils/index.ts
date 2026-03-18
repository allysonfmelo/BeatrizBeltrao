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
