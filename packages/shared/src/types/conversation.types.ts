export type ConversationStatus = "ativa" | "aguardando_humano" | "finalizada";
export type ConversationIntent = "agendamento" | "cancelamento" | "remarcacao" | "duvida" | "orcamento" | "outro";
export type MessageRole = "client" | "sophia" | "maquiadora";
export type MessageType = "text" | "image" | "audio" | "document" | "link";

export interface Conversation {
  id: string;
  clientId: string | null;
  phone: string;
  status: ConversationStatus;
  intent: ConversationIntent | null;
  contextSummary: string | null;
  collectedData: Record<string, unknown> | null;
  isHandoff: boolean;
  handoffReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  messageType: MessageType;
  evolutionMessageId: string | null;
  createdAt: Date;
}
