export interface Browser {
  open(url: string): Promise<boolean>;
}
