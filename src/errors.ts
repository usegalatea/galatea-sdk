/** Anything Galatea answered with an error. `status` is the HTTP status; `body` is what it sent. */
export class GalateaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "GalateaError";
  }
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export function errorFrom(response: Response, body: unknown): GalateaError {
  const said = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null;
  return new GalateaError(typeof said === "string" ? said : `Galatea answered ${response.status}`, response.status, body);
}
