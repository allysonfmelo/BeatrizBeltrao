/**
 * Formats an ISO date (`YYYY-MM-DD`) into pt-BR.
 */
export function formatDate(date: string | null): string {
  if (!date) return "—";

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

/**
 * Formats `HH:mm:ss` or `HH:mm` values.
 */
export function formatTime(time: string): string {
  const parts = time.split(":");
  if (parts.length < 2) return time;
  return `${parts[0]}:${parts[1]}`;
}

/**
 * Formats decimal-string values as BRL.
 */
export function formatCurrency(value: string | null): string {
  if (!value) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(numeric);
}

/**
 * Formats E.164-like phones (`5511999990000`) to a readable string.
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 12) return phone;

  const country = digits.slice(0, 2);
  const ddd = digits.slice(2, 4);
  const prefix = digits.slice(4, 9);
  const suffix = digits.slice(9, 13);
  return `+${country} (${ddd}) ${prefix}-${suffix}`;
}

