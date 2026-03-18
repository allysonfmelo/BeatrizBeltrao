export type ServiceType = "maquiagem" | "penteado" | "combo";
export type ServiceCategory = "estudio" | "externo";

export interface Service {
  id: string;
  name: string;
  type: ServiceType;
  category: ServiceCategory;
  description: string | null;
  price: number;
  durationMinutes: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
