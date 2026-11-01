export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export type SignInCode = Pick<DeviceCode, 'userCode' | 'verificationUri'>;

export type DeviceApproval = 'pending' | 'approved' | 'declined' | 'expired';

export interface DeviceSignIn {
  startDeviceSignIn(
    deviceName: string,
    signal?: AbortSignal,
  ): Promise<DeviceCode>;
  pollDeviceSignIn(
    deviceCode: string,
    signal?: AbortSignal,
  ): Promise<DeviceApproval>;
}
