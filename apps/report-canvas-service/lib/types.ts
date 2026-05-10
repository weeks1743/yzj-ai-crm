export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  generatedCode: string | null;
  reportTitle: string | null;
}

export interface CanvasStreamState {
  mode: "idle" | "streaming" | "complete";
  streamingCode: string;
  finalCode: string | null;
}
