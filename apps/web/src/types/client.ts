export type BookingStatus =
  | "pendente"
  | "confirmado"
  | "cancelado"
  | "concluido"
  | "expirado";

export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiEnvelope<TData> {
  data: TData;
  meta?: ApiMeta;
  error?: string;
}

export interface ClientListItem {
  id: string;
  fullName: string;
  phone: string;
  cpf: string;
  email: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  totalBookings: number;
  lastBookingDate: string | null;
}

export interface ClientServiceSummary {
  name: string | null;
  type: string | null;
  price: string | null;
}

export interface ClientBookingHistoryItem {
  id: string;
  clientId: string;
  serviceId: string;
  scheduledDate: string;
  scheduledTime: string;
  endTime: string;
  status: BookingStatus;
  totalPrice: string;
  depositAmount: string;
  paymentDeadline: string;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  service?: ClientServiceSummary | null;
  serviceName?: string | null;
  serviceType?: string | null;
  servicePrice?: string | null;
}

export interface ClientListViewData {
  data: ClientListItem[];
  meta: ApiMeta;
  error: string | null;
}

export interface ClientBookingHistoryViewData {
  data: ClientBookingHistoryItem[];
  meta: ApiMeta;
  error: string | null;
}

