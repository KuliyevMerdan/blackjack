// FIXTURE — must be rejected by `no-siblings`: nor by a relative path into ../crash.
import { hmacSha256 } from '../../../../../../crash/packages/fair/src/not-a-real-module';

export const leak = hmacSha256;
