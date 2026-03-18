export interface Client {
  id: string;
  fullName: string;
  phone: string;
  cpf: string;
  email: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateClientInput = Pick<Client, "fullName" | "phone" | "cpf" | "email"> & {
  notes?: string;
};
