export function jsonError(error: unknown, status = 500) {
  if (error instanceof Response) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  return Response.json({ ok: false, error: message, status }, { status });
}

export async function readJson<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
