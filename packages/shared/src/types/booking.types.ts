export type BookingStatus = "pendente" | "confirmado" | "cancelado" | "concluido" | "expirado";

export interface Booking {
  id: string;
  clientId: string;
  serviceId: string;
  scheduledDate: string;
  scheduledTime: string;
  endTime: string;
  status: BookingStatus;
  totalPrice: number;
  depositAmount: number;
  googleCalendarEventId: string | null;
  paymentDeadline: Date;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
