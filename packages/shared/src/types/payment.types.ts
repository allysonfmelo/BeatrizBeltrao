export type PaymentMethod = "pix" | "credito" | "debito";
export type PaymentStatus = "pendente" | "confirmado" | "cancelado" | "expirado" | "estornado";

export interface Payment {
  id: string;
  bookingId: string;
  asaasPaymentId: string;
  asaasInvoiceUrl: string | null;
  amount: number;
  method: PaymentMethod | null;
  status: PaymentStatus;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
