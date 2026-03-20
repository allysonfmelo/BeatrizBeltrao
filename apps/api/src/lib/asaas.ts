import { env } from "../config/env.js";
import { logger } from "./logger.js";

const BASE_URLS = {
  sandbox: "https://sandbox.asaas.com/api/v3",
  production: "https://api.asaas.com/v3",
} as const;

const baseUrl = BASE_URLS[env.ASAAS_ENVIRONMENT];

/** ASAAS customer creation data */
export interface AsaasCustomerInput {
  name: string;
  cpfCnpj: string;
  email: string;
  phone: string;
}

/** ASAAS customer response */
export interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
}

/** ASAAS charge creation data */
export interface AsaasChargeInput {
  customer: string;
  billingType: "UNDEFINED";
  value: number;
  dueDate: string;
  description: string;
  externalReference?: string;
}

/** ASAAS charge response */
export interface AsaasCharge {
  id: string;
  invoiceUrl: string;
  status: string;
  value: number;
}

/** Makes an authenticated request to ASAAS API */
async function asaasRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: env.ASAAS_API_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("ASAAS API error", { method, path, status: response.status, response: text });
    throw new Error(`ASAAS API error: ${response.status} - ${text}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Creates or finds a customer in ASAAS by CPF.
 */
export async function createCustomer(data: AsaasCustomerInput): Promise<AsaasCustomer> {
  const existing = await asaasRequest<{ data: AsaasCustomer[] }>(
    "GET",
    `/customers?cpfCnpj=${data.cpfCnpj}`
  );

  if (existing.data.length > 0) {
    logger.debug("ASAAS customer already exists", { customerId: existing.data[0].id });
    return existing.data[0];
  }

  const customer = await asaasRequest<AsaasCustomer>("POST", "/customers", {
    name: data.name,
    cpfCnpj: data.cpfCnpj,
    email: data.email,
    mobilePhone: data.phone,
  });

  logger.info("ASAAS customer created", { customerId: customer.id });
  return customer;
}

/**
 * Creates a charge (cobrança) in ASAAS.
 * Uses UNDEFINED billingType to allow Pix, Credit, and Debit.
 */
export async function createCharge(data: AsaasChargeInput): Promise<AsaasCharge> {
  const charge = await asaasRequest<AsaasCharge>("POST", "/payments", {
    customer: data.customer,
    billingType: data.billingType,
    value: data.value,
    dueDate: data.dueDate,
    description: data.description,
    externalReference: data.externalReference,
  });

  logger.info("ASAAS charge created", { chargeId: charge.id, value: data.value });
  return charge;
}

/**
 * Gets the current status of a payment.
 */
export async function getPaymentStatus(paymentId: string): Promise<string> {
  const payment = await asaasRequest<{ status: string }>("GET", `/payments/${paymentId}`);
  return payment.status;
}

/**
 * Cancels/deletes a pending payment.
 */
export async function cancelPayment(paymentId: string): Promise<void> {
  await asaasRequest("DELETE", `/payments/${paymentId}`);
  logger.info("ASAAS payment cancelled", { paymentId });
}
