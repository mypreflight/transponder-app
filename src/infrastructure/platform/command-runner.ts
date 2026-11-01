import { execFile } from 'node:child_process';

export type CommandResult = {
  stdout: string;
  status: 'ok' | 'failed';
};

export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<CommandResult>;

function runner(windowsHide: boolean): CommandRunner {
  return (file, args) =>
    new Promise((resolve) => {
      execFile(file, args, { windowsHide }, (error, stdout) => {
        resolve({
          stdout: stdout.toString().trim(),
          status: error === null ? 'ok' : 'failed',
        });
      });
    });
}

export const runCommand: CommandRunner = runner(true);

export const runVisibleCommand: CommandRunner = runner(false);
