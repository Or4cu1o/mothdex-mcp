import type { McpServer, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type * as z from "zod/v4";
import { InvalidRequest, toToolError } from "./errors";
import type { Env } from "./operations";

/**
 * The SDK answers an argument that fails the input schema with a text-only error. The contract
 * wants `structuredContent.error.code = "invalid_request"`, so the SDK is given the schema for
 * `tools/list` only (same JSON Schema) and always accepts; the tool parses the arguments itself.
 */
export function advertiseOnly(schema: z.ZodType): StandardSchemaWithJSON {
  const standard = schema["~standard"];
  return {
    "~standard": { ...standard, validate: (value: unknown) => ({ value }) },
  } as unknown as StandardSchemaWithJSON;
}

export interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  /** false only for tools whose repeat call can return something else (random_entry). */
  readonly idempotent: boolean;
  readonly run: (env: Env, args: z.output<I>) => Promise<z.input<O>>;
}

export type Json = Record<string, unknown>;

export const success = (structuredContent: Json) => ({
  content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
  structuredContent,
});

export function failure(error: unknown) {
  const { code, message, retryable, retryAfterS } = toToolError(error);
  const body = {
    error: {
      code,
      message,
      retryable,
      ...(retryAfterS === undefined ? {} : { retry_after_s: retryAfterS }),
    },
  };
  return { ...success(body), isError: true as const };
}

/** Registers one read tool: compact JSON in `text` and `structuredContent`, errors per tools.md. */
export function registerReadTool<I extends z.ZodObject, O extends z.ZodObject>(
  server: McpServer,
  makeEnv: (signal: AbortSignal) => Env,
  spec: ToolSpec<I, O>,
): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: advertiseOnly(spec.input),
      outputSchema: spec.output,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: spec.idempotent,
      },
    },
    async (rawArgs, ctx) => {
      const parsed = spec.input.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return failure(new InvalidRequest(`invalid arguments: ${describeIssues(parsed.error)}`));
      }
      try {
        return success((await spec.run(makeEnv(ctx.mcpReq.signal), parsed.data)) as Json);
      } catch (error) {
        return failure(error);
      }
    },
  );
}

/** Zod issues reduced to "path: message" lines; never echoes the rejected values. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
    .join("; ");
}
