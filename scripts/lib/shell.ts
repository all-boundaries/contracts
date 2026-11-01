export type RunOptions = { cwd?: string; env?: Record<string, string | undefined> };

export class CommandFailed extends Error {
  constructor(
    readonly command: string[],
    readonly exitCode: number,
  ) {
    super(`${command.join(" ")} exited with ${exitCode}`);
  }
}

// An undefined value in options.env removes the variable for the child.
function childEnv(extra: RunOptions["env"] = {}): Record<string, string> {
  const merged = { ...process.env, ...extra };
  return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export function capture(command: string[], options: RunOptions = {}): string {
  const result = Bun.spawnSync(command, { cwd: options.cwd, env: childEnv(options.env), stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

export async function run(command: string[], options: RunOptions = {}): Promise<void> {
  const process_ = Bun.spawn(command, {
    cwd: options.cwd,
    env: childEnv(options.env),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process_.exited;
  if (exitCode !== 0) throw new CommandFailed(command, exitCode);
}
