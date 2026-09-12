type StartupHook = () => Promise<void>;
type ShutdownHook = () => Promise<void>;

const startupHooks: StartupHook[] = [];
const shutdownHooks: ShutdownHook[] = [];

export function onStartup(hook: StartupHook): void {
  startupHooks.push(hook);
}

export function onShutdown(hook: ShutdownHook): void {
  shutdownHooks.push(hook);
}

export async function runStartupHooks(): Promise<void> {
  for (const hook of startupHooks) {
    try {
      await hook();
    } catch (error) {
      console.error('[Startup hook failed]', error);
    }
  }
}

export async function runShutdownHooks(): Promise<void> {
  for (const hook of shutdownHooks) {
    try {
      await hook();
    } catch (error) {
      console.error('[Shutdown hook failed]', error);
    }
  }
}

export function clearHooks(): void {
  startupHooks.length = 0;
  shutdownHooks.length = 0;
}