import type { Browser } from '../../application/ports/browser';
import { type CommandRunner, runVisibleCommand } from './command-runner';

const WEB_PROTOCOLS = ['https:', 'http:'];

type Command = {
  file: string;
  args: string[];
};

export class SystemBrowser implements Browser {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: CommandRunner = runVisibleCommand,
  ) {}

  async open(url: string): Promise<boolean> {
    const address = webAddress(url);
    const command =
      address === null ? null : commandFor(this.platform, address);

    if (command === null) {
      return false;
    }

    return (await this.run(command.file, command.args)).status === 'ok';
  }
}

function commandFor(
  platform: NodeJS.Platform,
  address: string,
): Command | null {
  if (platform === 'win32') {
    return {
      file: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', address],
    };
  }

  if (platform === 'darwin') {
    return { file: 'open', args: [address] };
  }

  return null;
}

function webAddress(url: string): string | null {
  try {
    const parsed = new URL(url);

    return WEB_PROTOCOLS.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
