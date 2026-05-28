// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `hebbs dev <module>` — boot a headless host against the module and
// keep it alive until Ctrl+C. Prints the URL the user hits with
// `curl` (or pairs with a separately-running Shell SPA) plus the
// callback JWT so they can dispatch tools by hand.
//
// MDK T6.1. T6.2 layers hot-reload on top via a file watcher.

import { createDevHost, type DevHost } from "@boringos/dev-host";

export interface DevOptions {
  modulePath: string;
  /** Optional smoke tool the dev command dispatches once at boot
   *  to confirm wiring before holding the host open. */
  smokeToolName?: string;
  smokeToolInputs?: unknown;
}

export interface DevHandle {
  host: DevHost;
  /** Tear the host down. Wired to SIGINT in CLI invocations. */
  shutdown: () => Promise<void>;
}

/**
 * Boot a dev-host and return a handle. The host stays alive until
 * `shutdown()` is called. The CLI wires shutdown to SIGINT/SIGTERM;
 * programmatic callers (e.g. tests) call it explicitly.
 */
export async function startDev(opts: DevOptions): Promise<DevHandle> {
  const host = await createDevHost({ modulePath: opts.modulePath });

  if (opts.smokeToolName) {
    await host.dispatch(opts.smokeToolName, opts.smokeToolInputs ?? {});
  }

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await host.close().catch(() => {
      /* best-effort */
    });
  };

  return { host, shutdown };
}
