// FIXTURE — must be rejected by `no-react`: there is no React in this repository.
import { useState } from 'react';

export const leak = useState;
