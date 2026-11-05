import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
}

export type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  count: number,
) => void | Promise<void>;

export class FakeServer {
  readonly requests: RecordedRequest[] = [];
  private readonly server: Server;
  private readonly handlers = new Map<string, Handler>();
  private readonly counts = new Map<string, number>();

  private constructor() {
    this.server = createServer((request, response) => {
      const key = `${request.method} ${(request.url ?? "").split("?")[0]}`;
      this.requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
      });
      const count = (this.counts.get(key) ?? 0) + 1;
      this.counts.set(key, count);
      const handler = this.handlers.get(key);
      if (!handler) {
        response.statusCode = 404;
        response.end();
        return;
      }
      void Promise.resolve(handler(request, response, count));
    });
  }

  static async start(): Promise<FakeServer> {
    const fake = new FakeServer();
    await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
    return fake;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  on(method: string, path: string, handler: Handler): this {
    this.handlers.set(`${method} ${path}`, handler);
    return this;
  }

  json(method: string, path: string, status: number, body: unknown): this {
    return this.on(method, path, (_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}
