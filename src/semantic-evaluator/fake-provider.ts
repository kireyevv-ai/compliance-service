import type { SemanticModelProvider, SemanticModelRequest } from "./types";

export class FakeSemanticModelProvider implements SemanticModelProvider {
  public requests: SemanticModelRequest[] = [];

  constructor(private readonly response: unknown | ((request: SemanticModelRequest) => unknown | Promise<unknown>)) {}

  async evaluate(request: SemanticModelRequest): Promise<unknown> {
    this.requests.push(request);

    if (typeof this.response === "function") {
      return this.response(request);
    }

    return this.response;
  }
}
