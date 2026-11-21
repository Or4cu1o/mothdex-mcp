import { unlinkSync } from "node:fs";
import type { DownloadState } from "./state";

const SIGNAL_EXIT: Readonly<Record<string, number>> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

export interface ShutdownOptions {
  readonly stdin?: NodeJS.EventEmitter;
  readonly proc?: Pick<NodeJS.Process, "on" | "off" | "once">;
  readonly exit?: (code: number) => void;
}

/**
 * Stops an in-flight download when the process is going away (tools.md §3.5, MT-14): a closed stdin
 * aborts the transfer so `finally` cleans up; a signal (SIGTERM, SIGINT, SIGHUP, which do not emit
 * `exit`) aborts, removes the staging files synchronously and exits with the usual 128+n code; the
 * `exit` hook is the last resort. Returns the function that removes the listeners.
 */
export function installShutdownHandlers(
  state: DownloadState,
  options: ShutdownOptions = {},
): () => void {
  const proc = options.proc ?? process;
  const stdin = options.stdin ?? process.stdin;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const removeParts = (): void => {
    for (const part of state.activeParts) {
      try {
        unlinkSync(part);
      } catch {
        // already gone
      }
    }
  };
  const stop = (): void => state.shutdown.abort();
  const onExit = (): void => removeParts();
  const listeners = Object.entries(SIGNAL_EXIT).map(([signal, code]) => {
    const handler = (): void => {
      stop();
      removeParts();
      exit(code);
    };
    proc.on(signal as NodeJS.Signals, handler);
    return [signal as NodeJS.Signals, handler] as const;
  });
  stdin.once("end", stop);
  stdin.once("close", stop);
  proc.once("exit", onExit);
  return () => {
    for (const [signal, handler] of listeners) proc.off(signal, handler);
    stdin.off("end", stop);
    stdin.off("close", stop);
    proc.off("exit", onExit);
  };
}
